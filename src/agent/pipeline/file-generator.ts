import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'
import type { ContextRetriever } from '../rag/retriever'
import type { IntentSchema } from './intent-analyzer'
import type { Relationship } from './schema-validator'
import type { TaskPlan } from './task-planner'

export interface GeneratedFile {
  path: string
  content: string
}

export interface FileGeneratorOptions {
  /** Project ID used to retrieve existing files from the RAG store. */
  projectId?: string
  /**
   * If provided, each file task retrieves up to 3 semantically relevant existing
   * project files before generation, giving the model cross-file context.
   */
  retriever?: ContextRetriever
  /** Optional project memory block injected into every generation prompt. */
  memoryBlock?: string
  /** Validated relationships between entities for proper foreign key implementation */
  relationships?: Relationship[]
}

export class FileGenerator {
  /**
   * Generates all files sequentially.
   * - Rolling context: last 3 files generated in this session.
   * - RAG context: up to 3 existing project files relevant to the current task (when retriever provided).
   * - Memory block: project stack/style/history injected into every prompt.
   */
  async generateAll(
    prompt: string,
    schema: IntentSchema,
    plan: TaskPlan[],
    onProgress: (index: number, total: number, path: string) => Promise<void>,
    options: FileGeneratorOptions = {}
  ): Promise<GeneratedFile[]> {
    const indexedPlan = plan.map((task, index) => ({ task, index, stage: classifyTaskStage(task.path) }))
    const totalStages = Math.max(0, ...indexedPlan.map(item => item.stage)) + 1
    const generatedByIndex = new Map<number, GeneratedFile>()
    let startedCount = 0

    for (let stage = 0; stage < totalStages; stage++) {
      const stageTasks = indexedPlan.filter(item => item.stage === stage).sort((a, b) => a.index - b.index)

      if (stageTasks.length === 0) continue

      logger.info(
        'FileGenerator: starting stage %d with %d files (parallelism=%d)',
        stage,
        stageTasks.length,
        parallelismForStage(stage)
      )

      const stableContext = [...generatedByIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, file]) => file)
        .slice(-3)
      const compactStableContext = compactGeneratedContext(stableContext)

      let nextTaskCursor = 0
      const workerCount = Math.min(parallelismForStage(stage), stageTasks.length)
      const stageWorkers = Array.from({ length: workerCount }, async () => {
        while (true) {
          const cursor = nextTaskCursor
          nextTaskCursor += 1

          if (cursor >= stageTasks.length) {
            break
          }

          const { task, index } = stageTasks[cursor]
          const progressIndex = startedCount
          startedCount += 1
          const fileStartedAt = Date.now()

          await onProgress(progressIndex, plan.length, task.path)

          // Fetch semantically relevant existing project files (RAG)
          let existingFiles: { path: string; content: string }[] = []
          if (options.retriever && options.projectId) {
            try {
              existingFiles = await options.retriever.getRelevantFiles(
                options.projectId,
                `${task.path}: ${task.description}`,
                3
              )
            } catch (err: any) {
              logger.warn('FileGenerator: RAG retrieval failed for %s: %s', task.path, err.message)
            }
          }

          const compactExistingFiles = compactExternalContext(existingFiles)
          const generatedSoFar = [...generatedByIndex.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, file]) => file)
          const compactStableContext = compactGeneratedContext(
            selectTaskRelevantContext(task.path, generatedSoFar)
          )

          const content = await this.generateOne(
            prompt,
            schema,
            task,
            compactStableContext,
            compactExistingFiles,
            compactMemoryBlock(options.memoryBlock),
            options.relationships,
            plan.map(item => item.path)
          )

          generatedByIndex.set(index, { path: task.path, content })

          logger.info(
            'FileGenerator: generated %s in %dms (%d/%d)',
            task.path,
            Date.now() - fileStartedAt,
            progressIndex + 1,
            plan.length
          )
        }
      })

      await Promise.all(stageWorkers)
      logger.info('FileGenerator: completed stage %d', stage)
    }

    return [...generatedByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, file]) => file)
  }

  private async generateOne(
    prompt: string,
    schema: IntentSchema,
    task: TaskPlan,
    context: GeneratedFile[],
    existingFiles: { path: string; content: string }[] = [],
    memoryBlock?: string,
    relationships?: Relationship[],
    plannedFilePaths: string[] = []
  ): Promise<string> {
    const provider = getProvider()
    const maxAttempts = 4
    const retryDelays = [1000, 2000, 4000] // Progressive delay: 1s, 2s, 4s

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartedAt = Date.now()
      try {
        let raw = ''
        for await (const chunk of provider.chatStream(
          [
            {
              role: 'system',
              content: buildGenerationPrompts.generateFileSystemPrompt(task.path)
            },
            {
              role: 'user',
              content: buildGenerationPrompts.generateFileUserPrompt(
                prompt,
                schema,
                task,
                context,
                existingFiles,
                memoryBlock,
                relationships,
                plannedFilePaths
              )
            }
          ],
          undefined,
          {
            temperature: 0.1,
            num_ctx: contextWindowForPath(task.path),
            num_predict: tokenBudgetForPath(task.path)
          }
        )) {
          raw += chunk.message.content
        }

        const clean = stripFences(raw)
        if (!clean) throw new Error('Generated file content is empty')
        logger.debug(
          'FileGenerator: attempt %d/%d succeeded for %s in %dms',
          attempt,
          maxAttempts,
          task.path,
          Date.now() - attemptStartedAt
        )
        return clean
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn(
          'FileGenerator: attempt %d/%d failed for %s after %dms: %s',
          attempt,
          maxAttempts,
          task.path,
          Date.now() - attemptStartedAt,
          msg
        )

        if (attempt < maxAttempts) {
          // Add progressive delay before retry
          const delay = retryDelays[attempt - 1] || 1000
          logger.debug('FileGenerator: waiting %dms before retry', delay)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          throw new Error(
            `FileGenerator: failed to generate ${task.path} after ${maxAttempts} attempts: ${msg}`
          )
        }
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error('FileGenerator: unexpected exit')
  }
}

function classifyTaskStage(path: string): number {
  const normalized = path.toLowerCase()

  if (
    normalized === 'requirements.txt' ||
    normalized === '.env' ||
    normalized === '.env.example' ||
    normalized === 'alembic.ini' ||
    normalized.startsWith('app/core/')
  ) {
    return 0
  }

  if (normalized.startsWith('app/models/')) {
    return 1
  }

  if (normalized.startsWith('app/schemas/')) {
    return 2
  }

  if (normalized.startsWith('app/services/') || normalized.startsWith('app/utils/')) {
    return 3
  }

  if (normalized.startsWith('app/api/')) {
    return 4
  }

  if (normalized === 'main.py' || normalized.startsWith('app/__')) {
    return 5
  }

  if (normalized.startsWith('tests/') || normalized.startsWith('docs/') || normalized === 'readme.md') {
    return 6
  }

  return 5
}

function compactGeneratedContext(files: GeneratedFile[]): GeneratedFile[] {
  const MAX_FILES = 6
  const MAX_CHARS_PER_FILE = 2500

  return files.slice(-MAX_FILES).map(file => ({
    path: file.path,
    content: truncateForContext(file.content, MAX_CHARS_PER_FILE)
  }))
}

function selectTaskRelevantContext(taskPath: string, generatedFiles: GeneratedFile[]): GeneratedFile[] {
  const normalizedTaskPath = taskPath.toLowerCase()
  const basename = normalizedTaskPath.split('/').pop() || ''
  const entityToken = basename.replace(/\.(py|ts|tsx|js|jsx|md|txt)$/i, '')

  const scored = generatedFiles.map((file, index) => {
    const normalizedFilePath = file.path.toLowerCase()
    let score = index

    if (normalizedFilePath.includes('/core/')) {
      score += 40
    }

    if (entityToken && normalizedFilePath.includes(`/${entityToken}.`)) {
      score += 120
    }

    if (normalizedTaskPath.startsWith('app/api/')) {
      if (normalizedFilePath.startsWith('app/services/')) score += 90
      if (normalizedFilePath.startsWith('app/schemas/')) score += 80
      if (normalizedFilePath.startsWith('app/models/')) score += 70
    }

    if (normalizedTaskPath.startsWith('app/services/')) {
      if (normalizedFilePath.startsWith('app/schemas/')) score += 80
      if (normalizedFilePath.startsWith('app/models/')) score += 70
      if (normalizedFilePath.startsWith('app/core/')) score += 60
    }

    if (normalizedTaskPath === 'main.py') {
      if (normalizedFilePath.startsWith('app/api/')) score += 90
      if (normalizedFilePath.startsWith('app/core/')) score += 70
    }

    return { file, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(item => item.file)
}

function compactMemoryBlock(memoryBlock?: string): string | undefined {
  if (!memoryBlock) {
    return undefined
  }

  return truncateForContext(memoryBlock, 1800)
}

function compactExternalContext(
  files: { path: string; content: string }[]
): { path: string; content: string }[] {
  const MAX_FILES = 2
  const MAX_CHARS_PER_FILE = 2500

  return files.slice(0, MAX_FILES).map(file => ({
    path: file.path,
    content: truncateForContext(file.content, MAX_CHARS_PER_FILE)
  }))
}

function truncateForContext(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content
  }

  const head = Math.floor(maxChars * 0.7)
  const tail = Math.floor(maxChars * 0.3)

  return `${content.slice(0, head)}\n\n... [truncated for context budget] ...\n\n${content.slice(
    Math.max(0, content.length - tail)
  )}`
}

function parallelismForStage(stage: number): number {
  if (stage <= 4) {
    return 2
  }

  return 3
}

function tokenBudgetForPath(path: string): number {
  const normalized = path.toLowerCase()

  if (normalized.startsWith('app/models/') || normalized.startsWith('app/services/')) {
    return 3200
  }

  if (normalized.startsWith('app/api/') || normalized.startsWith('app/schemas/')) {
    return 2600
  }

  if (normalized === 'requirements.txt' || normalized === 'readme.md' || normalized.startsWith('docs/')) {
    return 1800
  }

  if (normalized.startsWith('tests/')) {
    return 2200
  }

  return 2400
}

function contextWindowForPath(path: string): number {
  const normalized = path.toLowerCase()

  if (normalized.startsWith('app/models/') || normalized.startsWith('app/services/')) {
    return 12288
  }

  if (normalized.startsWith('app/api/') || normalized.startsWith('app/schemas/')) {
    return 10240
  }

  return 8192
}

function stripFences(text: string): string {
  return text
    .replace(/^```[\w]*\n/, '')
    .replace(/\n```$/, '')
    .trim()
}
