import { Job, Worker } from 'bullmq'
import { app } from '../../app'
import { ollamaClient } from '../../llm/ollama.client'
import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { logger } from '../../logger'
import { r2Client } from '../../storage/r2.client'
import type { GenerationJobData } from '../generation.queue'
import { redisConnection } from '../queue.client'

function parseJson(text: string): any {
  const match = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  return JSON.parse((match?.[1] || text).trim())
}

function parseJsonOrThrow(text: string, context: string): any {
  try {
    return parseJson(text)
  } catch (error) {
    const snippet = text.slice(0, 600)
    logger.error('Failed to parse %s JSON. Raw response snippet: %s', context, snippet)
    throw new Error(
      `Failed to parse ${context} JSON: ${error instanceof Error ? error.message : 'unknown error'}`
    )
  }
}

function normalizeFilePlan(input: unknown): { path: string; description: string }[] {
  if (!Array.isArray(input)) {
    throw new Error('File plan is not an array')
  }

  const normalized = input
    .filter(item => typeof item === 'object' && item !== null)
    .map(item => {
      const itemRecord = item as Record<string, unknown>
      const path: string = typeof itemRecord.path === 'string' ? itemRecord.path : ''
      const description: string =
        typeof itemRecord.description === 'string' ? itemRecord.description : 'Generated project file'

      return {
        path: path.trim(),
        description: description.trim()
      }
    })
    .filter(item => item.path.length > 0)

  if (normalized.length === 0) {
    throw new Error('File plan is empty')
  }

  return normalized
}

function ensureRequiredFiles(
  filePlan: { path: string; description: string }[]
): { path: string; description: string }[] {
  const requiredFiles: { path: string; description: string }[] = [
    { path: 'requirements.txt', description: 'Python dependencies for the generated backend' },
    { path: 'main.py', description: 'FastAPI app entrypoint' }
  ]

  const existing = new Set(filePlan.map(file => file.path))
  const nextPlan = [...filePlan]

  for (const required of requiredFiles) {
    if (!existing.has(required.path)) {
      logger.warn('Required file missing from generated plan. Injecting: %s', required.path)
      nextPlan.unshift(required)
    }
  }

  return nextPlan
}

function stripFences(text: string): string {
  return text
    .replace(/^```[\w]*\n/, '')
    .replace(/\n```$/, '')
    .trim()
}

export const generationWorker = new Worker<GenerationJobData>(
  'code-generation',
  async (job: Job<GenerationJobData>) => {
    const { projectId, prompt, userId } = job.data

    const updateProgress = async (stage: string, percentage: number, currentFile?: string) => {
      const generationProgress: Record<string, unknown> = {
        currentStage: stage,
        percentage
      }

      if (currentFile) {
        generationProgress.currentFile = currentFile
      }

      await app.service('projects').patch(projectId, {
        generationProgress
      } as any)
      app.channel(`projects/${projectId}`).send({
        type: 'generation:progress',
        payload: { stage, percentage, currentFile }
      })
    }

    try {
      await updateProgress('Analyzing prompt', 5)

      // Phase 1 — Extract project schema
      let schemaText = ''
      for await (const chunk of ollamaClient.chatStream(
        [{ role: 'user', content: buildGenerationPrompts.extractSchema(prompt) }],
        undefined,
        { temperature: 0.1 }
      )) {
        schemaText += chunk.message.content
      }
      const schema = parseJsonOrThrow(schemaText, 'schema')

      await updateProgress('Planning files', 15)

      // Phase 2 — Generate file plan
      let planText = ''
      for await (const chunk of ollamaClient.chatStream(
        [{ role: 'user', content: buildGenerationPrompts.filePlan(prompt, schema) }],
        undefined,
        { temperature: 0.1 }
      )) {
        planText += chunk.message.content
      }
      const rawFilePlan = parseJsonOrThrow(planText, 'file plan')
      const filePlan = ensureRequiredFiles(normalizeFilePlan(rawFilePlan))

      await app.service('projects').patch(projectId, {
        generationProgress: {
          totalFiles: filePlan.length,
          currentStage: 'planning_files',
          percentage: 15,
          filesGenerated: 0
        }
      } as any)

      // Phase 3 — Generate each file
      const generatedFiles: { path: string; content: string }[] = []

      for (let i = 0; i < filePlan.length; i++) {
        const file = filePlan[i]
        const percentage = 20 + Math.round((i / filePlan.length) * 70)
        await updateProgress('Generating files', percentage, file.path)

        const contextFiles = generatedFiles.slice(-3)
        let clean = ''

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            let fileContent = ''
            for await (const chunk of ollamaClient.chatStream(
              [
                {
                  role: 'user',
                  content: buildGenerationPrompts.generateFile(prompt, schema, file, contextFiles)
                }
              ],
              undefined,
              { temperature: 0.1 }
            )) {
              fileContent += chunk.message.content
            }

            clean = stripFences(fileContent)

            if (!clean) {
              throw new Error('Generated file content is empty')
            }

            break
          } catch (error) {
            logger.warn(
              'Failed generating file %s for project %s (attempt %s/2): %s',
              file.path,
              projectId,
              attempt,
              error instanceof Error ? error.message : 'unknown error'
            )

            if (attempt === 2) {
              throw new Error(
                `Failed generating file ${file.path}: ${error instanceof Error ? error.message : 'unknown error'}`
              )
            }
          }
        }

        generatedFiles.push({ path: file.path, content: clean })

        await r2Client.putObject(`projects/${projectId}/${file.path}`, clean)
        await app.service('files').create({
          projectId,
          name: file.path,
          key: `projects/${projectId}/${file.path}`,
          fileType: file.path.split('.').pop() || 'text',
          size: Buffer.byteLength(clean)
        })

        await app.service('projects').patch(projectId, {
          generationProgress: {
            filesGenerated: i + 1,
            totalFiles: filePlan.length,
            currentStage: 'generating_files',
            percentage: 20 + Math.round((i / filePlan.length) * 70)
          }
        } as any)
      }

      await updateProgress('Complete', 100)

      await app.service('snapshots').create({
        projectId,
        trigger: 'auto-generation',
        label: `Initial generation: ${prompt.slice(0, 100)}`,
        r2Prefix: `snapshots/${projectId}/initial/`,
        files: [],
        totalSize: 0,
        fileCount: generatedFiles.length,
        version: 1,
        createdAt: Date.now()
      })

      await app.service('projects').patch(projectId, {
        status: 'ready',
        generationProgress: {
          percentage: 100,
          currentStage: 'complete',
          filesGenerated: filePlan.length,
          totalFiles: filePlan.length,
          completedAt: Date.now()
        }
      } as any)
    } catch (err: any) {
      logger.error('Generation job %s failed: %s', job.id, err.message)
      await app.service('projects').patch(projectId, {
        status: 'error',
        generationProgress: {
          errorMessage: err.message,
          currentStage: 'error',
          percentage: 0,
          filesGenerated: 0,
          totalFiles: 0
        }
      } as any)
      throw err
    }
  },
  { connection: redisConnection as any, concurrency: 3 }
)

generationWorker.on('failed', (job, err) => {
  logger.error('Generation job %s permanently failed: %s', job?.id, err.message)
})
