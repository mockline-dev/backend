/**
 * Job cleanup utilities for managing background operations
 * Ensures proper cleanup of resources when jobs fail or are cancelled
 */

import { logger } from '../../../logger'
import { r2Client } from '../../../storage/r2.client'

export interface JobCleanupContext {
  projectId: string
  jobId?: string | number
  generatedFiles?: Array<{ path: string; content?: string }>
  r2Keys?: string[]
}

/**
 * Cleanup function to remove partially generated files and resources
 * Called when a generation job fails or is cancelled
 */
export async function cleanupFailedJob(context: JobCleanupContext): Promise<void> {
  const { projectId, jobId, generatedFiles, r2Keys } = context

  logger.info('JobTracker: Starting cleanup for job %s, project %s', jobId, projectId)

  const cleanupErrors: string[] = []

  // Cleanup R2 files if keys were provided
  if (r2Keys && r2Keys.length > 0) {
    try {
      logger.info('JobTracker: Cleaning up %d R2 files', r2Keys.length)
      for (const key of r2Keys) {
        try {
          await r2Client.deleteObject(key)
        } catch (err: any) {
          cleanupErrors.push(`Failed to delete R2 object ${key}: ${err.message}`)
        }
      }
    } catch (err: any) {
      cleanupErrors.push(`R2 cleanup failed: ${err.message}`)
    }
  }

  // Cleanup generated files if provided
  if (generatedFiles && generatedFiles.length > 0) {
    try {
      logger.info('JobTracker: Cleaning up %d generated file references', generatedFiles.length)
      // Note: File records in MongoDB are cleaned up by the projects service
      // This is just for tracking purposes
    } catch (err: any) {
      cleanupErrors.push(`Generated files cleanup failed: ${err.message}`)
    }
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
      r2Keys: job.r2Keys
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
