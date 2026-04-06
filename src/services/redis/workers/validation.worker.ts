import { Worker } from 'bullmq'
import { createModuleLogger } from '../../../logging'
import { runSandbox } from '../../../orchestration/sandbox/sandbox'
import { OpenSandboxProvider } from '../../../orchestration/sandbox/providers/opensandbox.provider'
import { getRedisClient } from '../client'
import type { ValidationJobData } from '../queues/queues'
import type { SandboxFile } from '../../../orchestration/sandbox/types'

const log = createModuleLogger('validation-worker')

let validationWorker: Worker | null = null

export function startValidationWorker(app: any): Worker {
  if (validationWorker) return validationWorker

  const connection = getRedisClient()

  validationWorker = new Worker<ValidationJobData>(
    'validation',
    async job => {
      const { projectId, files } = job.data

      log.info('Validation job started', { jobId: job.id, projectId, fileCount: files.length })

      const sandboxConfig = app.get('sandbox')
      const provider = new OpenSandboxProvider(sandboxConfig.opensandbox)

      const emit = (event: string, pid: string, payload: unknown) => {
        try {
          app.service('projects').emit(event, { projectId: pid, ...(payload as object) })
        } catch {
          /* non-fatal */
        }
      }

      const sandboxFiles: SandboxFile[] = files.map(f => ({
        path: f.path,
        content: f.content
      }))

      try {
        const { result } = await runSandbox(
          // Wrap files in markdown fences so the extractor can parse them
          sandboxFiles.map(f => `\`\`\`\n// ${f.path}\n${f.content}\n\`\`\``).join('\n'),
          provider,
          emit,
          projectId,
          {
            timeoutMs: sandboxConfig.timeoutMs,
            language: 'typescript',
            runTests: false
          }
        )

        emit('sandbox:result', projectId, {
          success: result.success,
          syntaxValid: result.syntaxValid,
          compilationOutput: result.compilationOutput,
          testOutput: result.testOutput,
          durationMs: result.durationMs
        })

        log.info('Validation job complete', { jobId: job.id, projectId, success: result.success })
        return result
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        log.error('Validation job failed', { jobId: job.id, projectId, error: error.message })
        throw err
      }
    },
    {
      connection: connection as any,
      concurrency: 2
    }
  )

  validationWorker.on('completed', job => {
    log.info('Job completed', { jobId: job.id })
  })

  validationWorker.on('failed', (job, err) => {
    log.error('Job failed', { jobId: job?.id, error: err.message })
  })

  log.info('Validation worker started')
  return validationWorker
}

export async function stopValidationWorker(): Promise<void> {
  if (validationWorker) {
    await validationWorker.close()
    validationWorker = null
    log.info('Validation worker stopped')
  }
}
