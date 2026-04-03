/**
 * Job cleanup utilities for managing background operations
 * Ensures proper cleanup of resources when jobs fail or are cancelled
 */

import type { Application } from '../../../declarations'
import { logger } from '../../../logger'
import { r2Client } from '../../../storage/r2.client'

export interface JobCleanupContext {
  projectId: string
  jobId?: string | number
  generatedFiles?: Array<{ path: string; content?: string }>
  r2Keys?: string[]
  app?: Application
}

/**
 * Cleanup function to remove partially generated files and resources
 * Called when a generation job fails or is cancelled
 */
export async function cleanupFailedJob(context: JobCleanupContext): Promise<void> {
  const { projectId, jobId, generatedFiles, r2Keys, app } = context

  logger.info('JobTracker: Starting cleanup for job %s, project %s', jobId, projectId)

  const cleanupErrors: string[] = []
  const deletedKeys: string[] = []

  // Cleanup R2 files if keys were provided
  if (r2Keys && r2Keys.length > 0) {
    try {
      logger.info('JobTracker: Cleaning up %d R2 files', r2Keys.length)
      for (const key of r2Keys) {
        try {
          await r2Client.deleteObject(key)
          deletedKeys.push(key)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          cleanupErrors.push(`Failed to delete R2 object ${key}: ${msg}`)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      cleanupErrors.push(`R2 cleanup failed: ${msg}`)
    }
  }

  // Cleanup MongoDB file records for deleted R2 keys
  if (app && deletedKeys.length > 0) {
    try {
      await app.service('files').remove(null, {
        query: { projectId, key: { $in: deletedKeys } }
      })
      logger.info('JobTracker: Removed %d MongoDB file records for project %s', deletedKeys.length, projectId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      cleanupErrors.push(`MongoDB files cleanup failed: ${msg}`)
    }
  }

  // Log generated file references (actual cleanup is via R2 keys above)
  if (generatedFiles && generatedFiles.length > 0) {
    logger.info('JobTracker: %d generated file references tracked for project %s', generatedFiles.length, projectId)
  }

  if (cleanupErrors.length > 0) {
    logger.warn(
      'JobTracker: Cleanup completed with %d errors: %s',
      cleanupErrors.length,
      cleanupErrors.join('; ')
    )
  } else {
    logger.info('JobTracker: Cleanup completed successfully for job %s', jobId)
  }
}

/**
 * Delete all R2 files under a project prefix and remove their MongoDB records.
 * Used for initial-generation failures where the entire project output must be wiped.
 */
export async function cleanupProjectFiles(projectId: string, app?: Application): Promise<void> {
  logger.info('JobTracker: Wiping all R2 files for project %s', projectId)
  try {
    await r2Client.deletePrefix(`projects/${projectId}/`)
    logger.info('JobTracker: Deleted R2 prefix projects/%s/', projectId)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('JobTracker: R2 prefix delete failed for project %s: %s', projectId, msg)
  }

  if (app) {
    try {
      await app.service('files').remove(null, { query: { projectId } })
      logger.info('JobTracker: Removed all MongoDB file records for project %s', projectId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('JobTracker: MongoDB files cleanup failed for project %s: %s', projectId, msg)
    }
  }
}

/**
 * Track active jobs to enable cancellation and timeout handling
 */
class JobTracker {
  private activeJobs = new Map<
    string | number,
    {
      projectId: string
      startTime: number
      timeout?: NodeJS.Timeout
      r2Keys: string[]
      generatedFiles: Array<{ path: string; content?: string }>
    }
  >()

  private app?: Application

  /**
   * Attach the Feathers application (called once at startup).
   */
  setApp(app: Application): void {
    this.app = app
  }

  /**
   * Register a job as active
   */
  registerJob(jobId: string | number, projectId: string, timeoutMs?: number): void {
    const timeout = timeoutMs
      ? setTimeout(() => {
          logger.warn('JobTracker: Job %s timed out after %dms', jobId, timeoutMs)
          this.cancelJob(jobId)
        }, timeoutMs)
      : undefined

    this.activeJobs.set(jobId, {
      projectId,
      startTime: Date.now(),
      timeout,
      r2Keys: [],
      generatedFiles: []
    })

    logger.info('JobTracker: Registered job %s for project %s', jobId, projectId)
  }

  /**
   * Track an R2 key created by a job
   */
  trackR2Key(jobId: string | number, key: string): void {
    const job = this.activeJobs.get(jobId)
    if (job) {
      job.r2Keys.push(key)
    }
  }

  /**
   * Track a generated file
   */
  trackGeneratedFile(jobId: string | number, file: { path: string; content?: string }): void {
    const job = this.activeJobs.get(jobId)
    if (job) {
      job.generatedFiles.push(file)
    }
  }

  /**
   * Mark a job as completed and cleanup tracking
   */
  completeJob(jobId: string | number): void {
    const job = this.activeJobs.get(jobId)
    if (job) {
      if (job.timeout) {
        clearTimeout(job.timeout)
      }
      const duration = Date.now() - job.startTime
      logger.info('JobTracker: Job %s completed in %dms', jobId, duration)
      this.activeJobs.delete(jobId)
    }
  }

  /**
   * Cancel a job and cleanup its resources
   */
  async cancelJob(jobId: string | number): Promise<void> {
    const job = this.activeJobs.get(jobId)
    if (!job) {
      logger.warn('JobTracker: Attempted to cancel unknown job %s', jobId)
      return
    }

    logger.info('JobTracker: Cancelling job %s', jobId)

    // Clear timeout if exists
    if (job.timeout) {
      clearTimeout(job.timeout)
    }

    // Cleanup resources
    await cleanupFailedJob({
      projectId: job.projectId,
      jobId,
      generatedFiles: job.generatedFiles,
      r2Keys: job.r2Keys,
      app: this.app
    })

    // Remove from tracking
    this.activeJobs.delete(jobId)
  }

  /**
   * Get job info
   */
  getJob(jobId: string | number) {
    return this.activeJobs.get(jobId)
  }

  /**
   * Get all active jobs for a project
   */
  getProjectJobs(projectId: string) {
    const jobs: Array<{ jobId: string | number; startTime: number; duration: number }> = []
    for (const [jobId, job] of this.activeJobs.entries()) {
      if (job.projectId === projectId) {
        jobs.push({
          jobId,
          startTime: job.startTime,
          duration: Date.now() - job.startTime
        })
      }
    }
    return jobs
  }

  /**
   * Cancel all jobs for a project
   */
  async cancelProjectJobs(projectId: string): Promise<void> {
    const jobsToCancel: Array<string | number> = []
    for (const [jobId, job] of this.activeJobs.entries()) {
      if (job.projectId === projectId) {
        jobsToCancel.push(jobId)
      }
    }

    logger.info('JobTracker: Cancelling %d jobs for project %s', jobsToCancel.length, projectId)

    for (const jobId of jobsToCancel) {
      await this.cancelJob(jobId)
    }
  }
}

// Export singleton instance
export const jobTracker = new JobTracker()
