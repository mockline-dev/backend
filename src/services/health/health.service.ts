import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { llmClient, getModelConfig } from '../../llm/client'
import { r2Client } from '../../storage/r2.client'

interface HealthStatus {
  ollama: 'ok' | 'degraded' | 'down'
  models: Record<string, boolean>
  r2: 'ok' | 'down'
  redis: 'ok' | 'down'
  staleProjects: number
  timestamp: number
}

export default function (app: Application) {
  ;(app as unknown as { use: (name: string, service: unknown) => void }).use('health', {
    async find(): Promise<HealthStatus> {
      const [ollamaStatus, r2Status, redisStatus, staleCount] = await Promise.allSettled([
        checkOllamaHealth(),
        checkR2Health(),
        checkRedisHealth(),
        countStaleProjects(app)
      ])

      const ollama = ollamaStatus.status === 'fulfilled' ? ollamaStatus.value : { status: 'down' as const, models: {} }
      const r2 = r2Status.status === 'fulfilled' && r2Status.value ? 'ok' as const : 'down' as const
      const redis = redisStatus.status === 'fulfilled' && redisStatus.value ? 'ok' as const : 'down' as const
      const staleProjects = staleCount.status === 'fulfilled' ? staleCount.value : -1

      return {
        ollama: ollama.status,
        models: ollama.models,
        r2,
        redis,
        staleProjects,
        timestamp: Date.now()
      }
    }
  })
}

async function checkOllamaHealth(): Promise<{ status: 'ok' | 'degraded' | 'down'; models: Record<string, boolean> }> {
  try {
    const modelsList = await llmClient.listModels()
    const names = modelsList.map((m: { name: string }) => m.name)
    const generationModel = getModelConfig('generation').name
    const planningModel = getModelConfig('planning').name
    const models: Record<string, boolean> = {
      [generationModel]: names.some((n: string) => n.includes(generationModel.split(':')[0])),
      [planningModel]: names.some((n: string) => n.includes(planningModel.split(':')[0]))
    }
    const allPresent = Object.values(models).every(Boolean)
    return { status: allPresent ? 'ok' : 'degraded', models }
  } catch {
    return { status: 'down', models: {} }
  }
}

async function checkR2Health(): Promise<boolean> {
  try {
    await r2Client.listObjects('_health_probe_/')
    return true
  } catch {
    return false
  }
}

async function checkRedisHealth(): Promise<boolean> {
  try {
    const { getRedisClient } = await import('../redis/client')
    const redis = await getRedisClient()
    return await redis.ping() === 'PONG'
  } catch {
    return false
  }
}

async function countStaleProjects(app: Application): Promise<number> {
  const STALE_THRESHOLD_MS = 5 * 60 * 1000
  const cutoff = Date.now() - STALE_THRESHOLD_MS
  try {
    const result = await app.service('projects').find({
      query: {
        status: { $in: ['planning', 'scaffolding', 'generating', 'validating'] },
        updatedAt: { $lt: cutoff },
        $limit: 0
      }
    }) as { total: number }
    return result.total
  } catch {
    return -1
  }
}
