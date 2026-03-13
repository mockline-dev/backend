import 'reflect-metadata'
import { app } from '../../../app'
import { closeRedisClient, getRedisClient } from '../client'

async function flushRedis() {
  console.log('🧹 Starting Redis database flush...')

  try {
    const redisConfig = app.get('redisConfig')
    console.log('🔴 Redis config:', {
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
    console.log(`⚠️ Running in ${isProduction ? 'PRODUCTION' : 'NON-PRODUCTION'} mode`)

    if (isProduction) {
      console.log('⚠️⚠️ WARNING: You are about to flush a PRODUCTION Redis database!')
      console.log('⚠️⚠️ This will delete ALL data in the current Redis DB!')
      console.log('⚠️⚠️ This action is IRREVERSIBLE!')

      if (process.env.CONFIRM_FLUSH !== 'YES_I_AM_SURE') {
        console.error(
          '❌ Aborting: Set environment variable CONFIRM_FLUSH=YES_I_AM_SURE to confirm production flush'
        )
        process.exit(1)
      }
    }

    const info = await redis.info('KEYSPACE')
    console.log('📊 Current Redis keyspace info:', info)

    console.log('🔥 Flushing Redis database...')
    const result = await redis.flushdb()
    console.log('✅ Flush result:', result)

    const postInfo = await redis.info('KEYSPACE')
    console.log('📊 Redis keyspace after flush:', postInfo)

    await closeRedisClient()
    console.log('✅ Redis connection closed')
    console.log('🎉 Redis database flush completed successfully!')
    process.exit(0)
  } catch (error) {
    console.error('❌ Failed to flush Redis database:', error)
    process.exit(1)
  }
}

flushRedis().catch(err => {
  console.error('❌ Error during Redis flush:', err)
  process.exit(1)
})
