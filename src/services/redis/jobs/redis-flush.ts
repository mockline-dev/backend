import 'reflect-metadata'
import { app } from '../../../app'
import { closeRedisClient, getRedisClient } from '../client'
import { logger } from '../../../logger'

async function flushRedis() {
  logger.info('🧹 Starting Redis database flush...')

  try {
    const redisConfig = app.get('redisConfig')
    logger.info('🔴 Redis config:', {
      host: redisConfig.host,
      port: redisConfig.port,
      db: redisConfig.db
    })

    const redis = await getRedisClient({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username || undefined,
      password: redisConfig.password || undefined,
      db: redisConfig.db
    })

    const isProduction = process.env.NODE_ENV === 'production'
    logger.info(`⚠️ Running in ${isProduction ? 'PRODUCTION' : 'NON-PRODUCTION'} mode`)

    if (isProduction) {
      logger.info('⚠️⚠️ WARNING: You are about to flush a PRODUCTION Redis database!')
      logger.info('⚠️⚠️ This will delete ALL data in the current Redis DB!')
      logger.info('⚠️⚠️ This action is IRREVERSIBLE!')

      if (process.env.CONFIRM_FLUSH !== 'YES_I_AM_SURE') {
        logger.error(
          '❌ Aborting: Set environment variable CONFIRM_FLUSH=YES_I_AM_SURE to confirm production flush'
        )
        process.exit(1)
      }
    }

    const info = await redis.info('KEYSPACE')
    logger.info('📊 Current Redis keyspace info:', info)

    logger.info('🔥 Flushing Redis database...')
    const result = await redis.flushdb()
    logger.info('✅ Flush result:', result)

    const postInfo = await redis.info('KEYSPACE')
    logger.info('📊 Redis keyspace after flush:', postInfo)

    await closeRedisClient()
    logger.info('✅ Redis connection closed')
    logger.info('🎉 Redis database flush completed successfully!')
    process.exit(0)
  } catch (error) {
    logger.error('❌ Failed to flush Redis database:', error)
    process.exit(1)
  }
}

flushRedis().catch(err => {
  logger.error('❌ Error during Redis flush:', err)
  process.exit(1)
})
