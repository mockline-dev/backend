import { Queue } from 'bullmq'
import 'reflect-metadata'
import { closeRedisClient, getRedisClient } from '../client'

const QUEUE_NAMES = ['code-generation', 'code-validation']

async function cleanupQueue() {
  console.log('🧹 Starting queue cleanup...')

  try {
    const connection = await getRedisClient()
    for (const queueName of QUEUE_NAMES) {
      const queue = new Queue(queueName, { connection: connection as any })
      console.log(`📊 Checking current queue status: ${queueName}`)

      const waiting = await queue.getWaiting()
      const active = await queue.getActive()
      const completed = await queue.getCompleted()
      const failed = await queue.getFailed()
      const delayed = await queue.getDelayed()

      console.log(`📈 Current queue status for ${queueName}:
    - Waiting: ${waiting.length}
    - Active: ${active.length}
    - Completed: ${completed.length}
    - Failed: ${failed.length}
    - Delayed: ${delayed.length}`)

      console.log(`🔄 Removing repeatable jobs for ${queueName}...`)
      const repeatableJobs = await queue.getRepeatableJobs()
      console.log(`Found ${repeatableJobs.length} repeatable jobs`)

      for (const job of repeatableJobs) {
        await queue.removeRepeatableByKey(job.key)
        console.log(`✅ Removed repeatable job: ${job.name}`)
      }

      console.log(`🧹 Cleaning all jobs for ${queueName}...`)

      const cleanCompleted = await queue.clean(0, 'completed' as any)
      console.log(`✅ Cleaned ${cleanCompleted.length} completed jobs`)

      const cleanFailed = await queue.clean(0, 'failed' as any)
      console.log(`✅ Cleaned ${cleanFailed.length} failed jobs`)

      const cleanActive = await queue.clean(0, 'active' as any)
      console.log(`✅ Cleaned ${cleanActive.length} active jobs`)

      const cleanWaiting = await queue.clean(0, 'waiting' as any)
      console.log(`✅ Cleaned ${cleanWaiting.length} waiting jobs`)

      const cleanDelayed = await queue.clean(0, 'delayed' as any)
      console.log(`✅ Cleaned ${cleanDelayed.length} delayed jobs`)

      const drainedJobs = await queue.drain()
      console.log(`✅ Drained ${drainedJobs} jobs from queue`)

      console.log(`🔍 Verifying cleanup for ${queueName}...`)
      const finalWaiting = await queue.getWaiting()
      const finalActive = await queue.getActive()
      const finalCompleted = await queue.getCompleted()
      const finalFailed = await queue.getFailed()
      const finalDelayed = await queue.getDelayed()
      const finalRepeatable = await queue.getRepeatableJobs()

      console.log(`✅ Final queue status for ${queueName}:
    - Waiting: ${finalWaiting.length}
    - Active: ${finalActive.length}
    - Completed: ${finalCompleted.length}
    - Failed: ${finalFailed.length}
    - Delayed: ${finalDelayed.length}
    - Repeatable: ${finalRepeatable.length}`)

      if (
        finalWaiting.length === 0 &&
        finalActive.length === 0 &&
        finalCompleted.length === 0 &&
        finalFailed.length === 0 &&
        finalDelayed.length === 0 &&
        finalRepeatable.length === 0
      ) {
        console.log(`🎉 Queue ${queueName} completely cleaned!`)
      } else {
        console.log(`⚠️  Queue ${queueName} still has remaining jobs`)
      }

      await queue.close()
    }

    await closeRedisClient()
    console.log('✅ Cleanup completed successfully')
    process.exit(0)
  } catch (error) {
    console.error('❌ Cleanup failed:', error)
    process.exit(1)
  }
}

cleanupQueue().catch(err => {
  console.error('❌ Failed to cleanup queue:', err)
  process.exit(1)
})
