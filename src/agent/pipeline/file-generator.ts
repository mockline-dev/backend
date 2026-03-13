import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'
import type { ContextRetriever } from '../rag/retriever'
import type { IntentSchema } from './intent-analyzer'
import type { TaskPlan } from './task-planner'
import type { Relationship } from './schema-validator'

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
    const generated: GeneratedFile[] = []

    for (let i = 0; i < plan.length; i++) {
      const task = plan[i]
      await onProgress(i, plan.length, task.path)

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

      const content = await this.generateOne(
        prompt,
        schema,
        task,
        generated.slice(-3),
        existingFiles,
        options.memoryBlock,
        options.relationships
      )
      generated.push({ path: task.path, content })
    }

    return generated
  }

  private async generateOne(
    prompt: string,
    schema: IntentSchema,
    task: TaskPlan,
    context: GeneratedFile[],
    existingFiles: { path: string; content: string }[] = [],
    memoryBlock?: string,
    relationships?: Relationship[]
  ): Promise<string> {
    const provider = getProvider()
    const maxAttempts = 4
    const retryDelays = [1000, 2000, 4000] // Progressive delay: 1s, 2s, 4s

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let raw = ''
        for await (const chunk of provider.chatStream(
          [
            {
              role: 'user',
              content: buildGenerationPrompts.generateFile(
                prompt,
                schema,
                task,
                context,
                existingFiles,
                memoryBlock,
                relationships
              )
            }
          ],
          undefined,
          { temperature: 0.1 }
        )) {
          raw += chunk.message.content
        }

        const clean = stripFences(raw)
        if (!clean) throw new Error('Generated file content is empty')
        return clean
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn('FileGenerator: attempt %d/%d failed for %s: %s', attempt, maxAttempts, task.path, msg)
        
        if (attempt < maxAttempts) {
          // Add progressive delay before retry
          const delay = retryDelays[attempt - 1] || 1000
          logger.debug('FileGenerator: waiting %dms before retry', delay)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          throw new Error(`FileGenerator: failed to generate ${task.path} after ${maxAttempts} attempts: ${msg}`)
        }
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error('FileGenerator: unexpected exit')
  }
}

function stripFences(text: string): string {
  return text
    .replace(/^```[\w]*\n/, '')
    .replace(/\n```$/, '')
    .trim()
}
