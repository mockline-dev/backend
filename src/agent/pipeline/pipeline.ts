import { QueueEvents } from 'bullmq'
import { ObjectId } from 'mongodb'

import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { redisConnection } from '../../services/redis/queues/queue.client'
import { agentQueue, type AgentJobData } from '../../services/redis/queues/queues'
import { r2Client } from '../../storage/r2.client'
import type { AgentStepName, GeneratedFile, PipelineContext, PipelineStepMetric } from '../types'

interface PipelineRunInput {
  projectId: string
  prompt: string
  userId: string
  framework?: 'fast-api' | 'feathers'
  language?: 'python' | 'typescript'
  model?: string
  jobId?: string
  onProgress: (stage: string, percentage: number, currentFile?: string) => Promise<void>
}

interface PipelineRunResult {
  files: GeneratedFile[]
  fileCount: number
  warnings: string[]
  stepMetrics: PipelineStepMetric[]
}

const PIPELINE_STEPS: Array<{ step: AgentStepName; label: string; progress: number }> = [
  { step: 'analyze_requirements', label: 'Analyzing requirements', progress: 10 },
  { step: 'generate_architecture', label: 'Planning architecture', progress: 20 },
  { step: 'decompose_tasks', label: 'Decomposing tasks', progress: 30 },
  { step: 'create_db_schema', label: 'Generating DB schema', progress: 40 },
  { step: 'generate_services', label: 'Generating services', progress: 55 },
  { step: 'generate_routes', label: 'Generating routes', progress: 68 },
  { step: 'generate_validation', label: 'Generating validation', progress: 80 },
  { step: 'generate_tests', label: 'Generating tests', progress: 90 },
  { step: 'assemble_project', label: 'Assembling project', progress: 96 }
]

const STEP_TIMEOUTS_MS: Record<AgentStepName, number> = {
  analyze_requirements: 90_000,
  generate_architecture: 180_000,
  decompose_tasks: 120_000,
  create_db_schema: 90_000,
  generate_services: 120_000,
  generate_routes: 90_000,
  generate_validation: 90_000,
  generate_tests: 90_000,
  assemble_project: 45_000
}

export class GenerationPipeline {
  constructor(private readonly app: Application) {}

  private deriveActiveSteps(prompt: string): Array<{ step: AgentStepName; label: string; progress: number }> {
    const content = prompt.toLowerCase()
    const hasPreplannedArchitecture =
      content.includes('existing architecture') ||
      content.includes('already have architecture') ||
      content.includes('use this architecture')

    if (!hasPreplannedArchitecture) {
      return PIPELINE_STEPS
    }

    return PIPELINE_STEPS.filter(
      step => !['analyze_requirements', 'generate_architecture'].includes(step.step)
    )
  }

  async run(input: PipelineRunInput): Promise<PipelineRunResult> {
    const queueEvents = new QueueEvents('agent-tasks', { connection: redisConnection as any })
    await queueEvents.waitUntilReady()

    const project = await this.app.service('projects').get(input.projectId)
    const framework = (input.framework || project?.framework || 'fast-api') as 'fast-api' | 'feathers'
    const language = (input.language || project?.language || 'python') as 'python' | 'typescript'
    const targetModel = (input.model || project?.model || undefined) as string | undefined

    const context: PipelineContext = {
      generationId: `${input.projectId}-${Date.now()}`,
      projectId: input.projectId,
      userId: input.userId,
      prompt: input.prompt,
      framework,
      language,
      targetModel,
      files: [],
      warnings: [],
      metadata: {
        jobId: input.jobId || null,
        startedAt: Date.now(),
        stepMetrics: []
      }
    }

    let mutableContext = context
    const activeSteps = this.deriveActiveSteps(input.prompt)

    try {
      for (const stepDef of activeSteps) {
        await input.onProgress(stepDef.label, stepDef.progress)

        const stepStartedAt = Date.now()
        const filesBefore = mutableContext.files.length

        const agentJobPayload: AgentJobData = {
          generationId: mutableContext.generationId,
          projectId: input.projectId,
          step: stepDef.step,
          context: mutableContext
        }

        const job = await agentQueue.add(stepDef.step, agentJobPayload, {
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 1000
          }
        })

        const result = await job.waitUntilFinished(
          queueEvents,
          STEP_TIMEOUTS_MS[stepDef.step] || 1000 * 60 * 5
        )
        mutableContext = result.context as PipelineContext

        const filesAfter = mutableContext.files.length
        const stepConfig =
          (mutableContext.metadata?.[stepDef.step] as Record<string, unknown> | undefined) || {}
        const generationStats =
          (mutableContext.metadata?.[`${stepDef.step}_stats`] as Record<string, unknown> | undefined) || {}

        const metric: PipelineStepMetric = {
          step: stepDef.step,
          task: typeof stepConfig.task === 'string' ? stepConfig.task : undefined,
          model: typeof stepConfig.model === 'string' ? stepConfig.model : undefined,
          temperature: typeof stepConfig.temperature === 'number' ? stepConfig.temperature : undefined,
          startedAt: stepStartedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - stepStartedAt,
          filesBefore,
          filesAfter,
          filesAdded: Math.max(0, filesAfter - filesBefore),
          parsedFiles:
            typeof generationStats.parsedFiles === 'number' ? generationStats.parsedFiles : undefined,
          fallbackUsed:
            typeof generationStats.usedFallback === 'boolean' ? generationStats.usedFallback : undefined,
          summary: result.summary
        }

        const existingMetrics = Array.isArray(mutableContext.metadata?.stepMetrics)
          ? (mutableContext.metadata.stepMetrics as PipelineStepMetric[])
          : []

        mutableContext = {
          ...mutableContext,
          metadata: {
            ...mutableContext.metadata,
            stepMetrics: [...existingMetrics, metric]
          }
        }

        logger.info(
          'Pipeline step=%s model=%s filesAdded=%d durationMs=%d fallback=%s',
          stepDef.step,
          metric.model || 'unknown',
          metric.filesAdded || 0,
          metric.durationMs || 0,
          metric.fallbackUsed === true ? 'yes' : 'no'
        )

        this.app.channel(`projects/${input.projectId}`).send({
          type: 'generation.step',
          payload: {
            generationId: mutableContext.generationId,
            step: stepDef.step,
            label: stepDef.label,
            summary: result.summary,
            timestamp: Date.now()
          }
        })
      }

      await this.persistGeneratedFiles(input.projectId, mutableContext.files, input.onProgress)
      await this.createVersionRecord(input.projectId, mutableContext)

      return {
        files: mutableContext.files,
        fileCount: mutableContext.files.length,
        warnings: mutableContext.warnings,
        stepMetrics: (mutableContext.metadata?.stepMetrics || []) as PipelineStepMetric[]
      }
    } catch (error: any) {
      logger.error('Generation pipeline failed for project %s: %s', input.projectId, error.message)
      throw error
    } finally {
      await queueEvents.close()
    }
  }

  private async persistGeneratedFiles(
    projectId: string,
    files: GeneratedFile[],
    onProgress: PipelineRunInput['onProgress']
  ): Promise<void> {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      const key = `projects/${projectId}/workspace/${file.path}`
      await r2Client.putObject(key, file.content)

      await onProgress(
        'Persisting files',
        Math.min(99, 96 + Math.floor(((index + 1) / Math.max(files.length, 1)) * 3)),
        file.path
      )

      const fileName = file.path.split('/').pop() || file.path
      const fileType = fileName.includes('.') ? fileName.split('.').pop() || 'txt' : 'txt'

      await this.upsertFileRecord(projectId, key, fileName, fileType, Buffer.byteLength(file.content))

      this.app.channel(`projects/${projectId}`).send({
        type: 'generation.file',
        payload: {
          path: file.path,
          size: Buffer.byteLength(file.content),
          generatedAt: Date.now()
        }
      })
    }
  }

  private async upsertFileRecord(
    projectId: string,
    key: string,
    name: string,
    fileType: string,
    size: number
  ) {
    const filesService = this.app.service('files')
    const existing = await filesService.find({ query: { projectId, key, $limit: 1 } } as any)
    const existingRow = Array.isArray((existing as any).data) ? (existing as any).data[0] : undefined

    if (existingRow?._id) {
      await filesService.patch(existingRow._id.toString(), {
        name,
        fileType,
        size,
        updatedAt: Date.now()
      } as any)
      return
    }

    await filesService.create({
      projectId: new ObjectId(projectId),
      name,
      key,
      fileType,
      size
    } as any)
  }

  private async createVersionRecord(projectId: string, context: PipelineContext) {
    const timestamp = Date.now()

    await this.app.service('versions').create({
      projectId,
      generationId: context.generationId,
      message: `Automated generation from prompt: ${context.prompt.slice(0, 80)}`,
      files: context.files.map(file => ({ path: file.path, size: Buffer.byteLength(file.content) })),
      diff: context.files.map(file => ({ path: file.path, change: 'created' })),
      createdAt: timestamp,
      updatedAt: timestamp
    } as any)
  }
}
