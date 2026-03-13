import { Queue } from 'bullmq'
import 'reflect-metadata'
import { closeRedisClient, getRedisClient } from '../client'

const QUEUE_NAMES = ['code-generation', 'code-validation']
const CLEAN_BATCH_SIZE = 10_000

async function cleanByType(queue: Queue, type: 'completed' | 'failed' | 'active' | 'waiting' | 'delayed') {
  let totalCleaned = 0

  while (true) {
    const cleaned = await queue.clean(0, CLEAN_BATCH_SIZE, type)
    totalCleaned += cleaned.length

    if (cleaned.length < CLEAN_BATCH_SIZE) {
      break
    }
  }

  return totalCleaned
}

async function cleanupQueue() {
  console.log('🧹 Starting queue cleanup...')

  try {
    const connection = await getRedisClient()
    for (const queueName of QUEUE_NAMES) {
      const queue = new Queue(queueName, { connection: connection as any })
      console.log(`📊 Checking current queue status: ${queueName}`)

      await queue.pause()
      console.log(`⏸️  Paused queue ${queueName}`)

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

      const cleanCompleted = await cleanByType(queue, 'completed')
      console.log(`✅ Cleaned ${cleanCompleted} completed jobs`)

      const cleanFailed = await cleanByType(queue, 'failed')
      console.log(`✅ Cleaned ${cleanFailed} failed jobs`)

      const cleanActive = await cleanByType(queue, 'active')
      console.log(`✅ Cleaned ${cleanActive} active jobs`)

      const cleanWaiting = await cleanByType(queue, 'waiting')
      console.log(`✅ Cleaned ${cleanWaiting} waiting jobs`)

      const cleanDelayed = await cleanByType(queue, 'delayed')
      console.log(`✅ Cleaned ${cleanDelayed} delayed jobs`)

      await queue.drain(true)
      console.log('✅ Drained waiting and delayed jobs from queue')

      // Final hard reset to ensure no stuck/active jobs remain.
      // force=true is required when jobs are active or locked.
      try {
        await queue.obliterate({ force: true, count: CLEAN_BATCH_SIZE })
        console.log(`✅ Obliterated queue ${queueName}`)
      } catch (err: any) {
        console.log(`⚠️  Obliterate skipped for ${queueName}: ${err.message}`)
      }

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

      await queue.resume()

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
