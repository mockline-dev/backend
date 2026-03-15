import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { createUniversalPromptBuilder } from '../../llm/prompts/universal-prompts'
import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'
import { createInitializedRegistry } from '../stacks'
import type { StackConfig } from '../stacks/stack-config.types'
import type { ContextRetriever } from '../rag/retriever'
import type { RetrievedContext } from '../rag/weaviate'
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
  /** Stack ID for language/framework-specific code generation */
  stackId?: string
  /** Optional RAG context for file generation */
  ragContext?: RetrievedContext | null
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

    // Pre-fetch all RAG context before starting file generation
    const ragCache = new Map<string, { path: string; content: string }[]>()
    if (options.retriever && options.projectId) {
      logger.info('FileGenerator: pre-fetching RAG context for %d files', plan.length)
      const ragPrefetchStartedAt = Date.now()

      const ragPrefetchPromises = plan.map(async task => {
        try {
          const existingFiles = await options.retriever!.getRelevantFiles(
            options.projectId!,
            `${task.path}: ${task.description}`,
            3
          )
          ragCache.set(task.path, existingFiles)
        } catch (err: any) {
          logger.warn('FileGenerator: RAG pre-fetch failed for %s: %s', task.path, err.message)
          ragCache.set(task.path, [])
        }
      })

      await Promise.allSettled(ragPrefetchPromises)
      logger.info('FileGenerator: RAG pre-fetch completed in %dms', Date.now() - ragPrefetchStartedAt)
    }

    for (let stage = 0; stage < totalStages; stage++) {
      const stageTasks = indexedPlan.filter(item => item.stage === stage).sort((a, b) => a.index - b.index)

      if (stageTasks.length === 0) continue

      logger.info(
        'FileGenerator: starting stage %d with %d files (parallelism=%d)',
        stage,
        stageTasks.length,
        parallelismForStage(stage, stageTasks.length)
      )

      const stableContext = [...generatedByIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, file]) => file)
        .slice(-3)
      const compactStableContext = compactGeneratedContext(stableContext)

      let nextTaskCursor = 0
      const workerCount = Math.min(parallelismForStage(stage, stageTasks.length), stageTasks.length)
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

          // Use pre-fetched RAG context from cache
          let existingFiles: { path: string; content: string }[] = []
          if (ragCache.has(task.path)) {
            existingFiles = ragCache.get(task.path)!
          }

          const compactExistingFiles = compactExternalContext(existingFiles)

          const content = await this.generateOne(
            prompt,
            schema,
            task,
            compactStableContext,
            compactExistingFiles,
            compactMemoryBlock(options.memoryBlock),
            options.relationships,
            options.stackId,
            options.ragContext
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
    stackId?: string,
    ragContext?: RetrievedContext | null
  ): Promise<string> {
    const provider = getProvider()
    const maxAttempts = 4
    const retryDelays = [1000, 2000, 4000] // Progressive delay: 1s, 2s, 4s

    // Use universal prompt builder if stackId is provided, otherwise use old prompts for backward compatibility
    const useUniversalPrompts = !!stackId

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartedAt = Date.now()
      try {
        let raw = ''
        let systemPrompt: string
        let userPrompt: string

        if (useUniversalPrompts) {
          // Use universal prompt builder with stack-specific templates
          const promptBuilder = createUniversalPromptBuilder()
          userPrompt = await promptBuilder.buildFileGenerationPrompt(
            task.path,
            schema,
            stackId || 'python-fastapi',
            {
              existingFiles,
              memoryBlock,
              relationships,
              ragContext
            }
          )
          // For universal prompts, we use a minimal system prompt
          systemPrompt = 'You are a senior backend engineer generating production-ready code.'
        } else {
          // Use old prompts for backward compatibility
          systemPrompt = buildGenerationPrompts.generateFileSystemPrompt(task.path)
          userPrompt = buildGenerationPrompts.generateFileUserPrompt(
            prompt,
            schema,
            task,
            context,
            existingFiles,
            memoryBlock,
            relationships
          )
        }

        for await (const chunk of provider.chatStream(
          [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          undefined,
          {
            temperature: 0.35,
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
    normalized.includes('requirements.txt') ||
    normalized.includes('package.json') ||
    normalized.includes('go.mod') ||
    normalized === '.env' ||
    normalized === '.env.example' ||
    normalized.includes('config') ||
    normalized.includes('core')
  ) {
    return 0
  }

  if (normalized.includes('model') || normalized.includes('entity') || normalized.includes('schema')) {
    return 1
  }

  if (normalized.includes('dto') || normalized.includes('type') || normalized.includes('interface')) {
    return 2
  }

  if (normalized.includes('service') || normalized.includes('util') || normalized.includes('helper')) {
    return 3
  }

  if (normalized.includes('controller') || normalized.includes('route') || normalized.includes('api')) {
    return 4
  }

  if (normalized.includes('main') || normalized.includes('index') || normalized.includes('app')) {
    return 5
  }

  if (normalized.includes('test') || normalized.includes('doc') || normalized.includes('readme')) {
    return 6
  }

  return 5
}

function compactGeneratedContext(files: GeneratedFile[]): GeneratedFile[] {
  const MAX_FILES = 2
  const MAX_CHARS_PER_FILE = 2500

  return files.slice(-MAX_FILES).map(file => ({
    path: file.path,
    content: truncateForContext(file.content, MAX_CHARS_PER_FILE)
  }))
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

function parallelismForStage(stage: number, fileCount: number): number {
  // Dynamic parallelism based on number of files in stage
  // More files = more parallelism (up to limit)
  const baseParallelism = stage <= 4 ? 2 : 3
  const dynamicParallelism = Math.min(baseParallelism + Math.floor(fileCount / 3), 5)

  return dynamicParallelism
}

function tokenBudgetForPath(path: string): number {
  const normalized = path.toLowerCase()

  if (normalized.includes('model') || normalized.includes('service') || normalized.includes('controller')) {
    return 3200
  }

  if (normalized.includes('api') || normalized.includes('schema') || normalized.includes('route')) {
    return 2600
  }

  if (normalized.includes('.md') || normalized.includes('.json') || normalized.includes('.txt')) {
    return 1800
  }

  if (normalized.includes('test')) {
    return 2200
  }

  return 2400
}

function contextWindowForPath(path: string): number {
  const normalized = path.toLowerCase()

  if (normalized.includes('model') || normalized.includes('service') || normalized.includes('controller')) {
    return 12288
  }

  if (normalized.includes('api') || normalized.includes('schema') || normalized.includes('route')) {
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
