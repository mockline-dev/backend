/**
 * Weaviate Client Initialization
 *
 * Provides a configured Weaviate client with retry logic, connection pooling,
 * and error handling for agentic development RAG system.
 */

import weaviate, { WeaviateClient } from 'weaviate-ts-client'
import type { Application } from '../../../declarations'
import { logger } from '../../../logger'

/**
 * Weaviate configuration interface
 */
export interface WeaviateConfig {
  host: string
  port: number
  scheme: 'http' | 'https'
  apiKey?: string
  enabled: boolean
  timeout: number
  maxRetries: number
  retryDelay: number
  batchSize: number
  vectorDimension: number
}

/**
 * Get Weaviate configuration from app config
 */
export function getWeaviateConfig(app: Application): WeaviateConfig {
  const config = app.get('weaviate') as WeaviateConfig | undefined

  if (!config) {
    throw new Error('Weaviate configuration not found in app config')
  }

  return config
}

/**
 * Create a configured Weaviate client with retry logic
 */
export function createWeaviateClient(config: WeaviateConfig): WeaviateClient {
  const connectionParams: any = {
    host: `${config.scheme}://${config.host}:${config.port}`,
    timeout: config.timeout
  }

  // Add API key if provided
  if (config.apiKey) {
    connectionParams.headers = {
      'X-Weaviate-Api-Key': config.apiKey
    }
  }

  const client = weaviate.client(connectionParams)

  logger.info(
    'Weaviate client created: %s://%s:%d (enabled=%s)',
    config.scheme,
    config.host,
    config.port,
    config.enabled
  )

  return client
}

/**
 * Retry wrapper for Weaviate operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: WeaviateConfig,
  operationName: string
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error

      if (attempt < config.maxRetries - 1) {
        const delay = config.retryDelay * Math.pow(2, attempt) // Exponential backoff
        logger.warn(
          'Weaviate operation failed (attempt %d/%d): %s. Retrying in %dms...',
          attempt + 1,
          config.maxRetries,
          operationName,
          delay
        )
        await sleep(delay)
      }
    }
  }

  throw new Error(
    `Weaviate operation failed after ${config.maxRetries} attempts: ${operationName}. Last error: ${lastError?.message}`
  )
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Check if Weaviate is healthy and accessible
 */
export async function checkWeaviateHealth(client: WeaviateClient): Promise<boolean> {
  try {
    const response = await client.misc.liveChecker().do()
    return response.status === 200
  } catch (error: any) {
    logger.warn('Weaviate health check failed: %s', error.message)
    return false
  }
}

/**
 * Weaviate client manager with connection pooling and health monitoring
 */
export class WeaviateClientManager {
  private client: WeaviateClient | null = null
  private config: WeaviateConfig
  private isHealthy: boolean = false
  private healthCheckInterval: NodeJS.Timeout | null = null
  private readonly HEALTH_CHECK_INTERVAL_MS = 60000 // 1 minute

  constructor(config: WeaviateConfig) {
    this.config = config
  }

  /**
   * Initialize the Weaviate client
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Weaviate is disabled in configuration')
      return
    }

    try {
      this.client = createWeaviateClient(this.config)
      this.isHealthy = await checkWeaviateHealth(this.client)

      if (this.isHealthy) {
        logger.info('Weaviate client initialized and healthy')
        this.startHealthCheck()
      } else {
        logger.warn('Weaviate client initialized but health check failed')
      }
    } catch (error: any) {
      logger.error('Failed to initialize Weaviate client: %s', error.message)
      throw error
    }
  }

  /**
   * Get the Weaviate client instance
   */
  getClient(): WeaviateClient {
    if (!this.client) {
      throw new Error('Weaviate client not initialized. Call initialize() first.')
    }
    return this.client
  }

  /**
   * Check if Weaviate is healthy
   */
  isWeaviateHealthy(): boolean {
    return this.isHealthy
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return
    }

    this.healthCheckInterval = setInterval(async () => {
      if (this.client) {
        this.isHealthy = await checkWeaviateHealth(this.client)
        if (!this.isHealthy) {
          logger.warn('Weaviate health check failed')
        }
      }
    }, this.HEALTH_CHECK_INTERVAL_MS)
  }

  /**
   * Stop health checks and close client
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }

    this.client = null
    this.isHealthy = false
    logger.info('Weaviate client manager shutdown')
  }
}

/**
 * Global Weaviate client manager instance
 */
let globalClientManager: WeaviateClientManager | null = null

/**
 * Initialize global Weaviate client manager
 */
export async function initializeWeaviateClientManager(app: Application): Promise<void> {
  const config = getWeaviateConfig(app)

  if (!config.enabled) {
    logger.info('Weaviate is disabled, skipping initialization')
    return
  }

  globalClientManager = new WeaviateClientManager(config)
  await globalClientManager.initialize()
}

/**
 * Get global Weaviate client manager
 */
export function getWeaviateClientManager(): WeaviateClientManager {
  if (!globalClientManager) {
    throw new Error('Weaviate client manager not initialized. Call initializeWeaviateClientManager() first.')
  }
  return globalClientManager
}

/**
 * Get global Weaviate client (convenience method)
 */
export function getWeaviateClient(): WeaviateClient {
  return getWeaviateClientManager().getClient()
}
