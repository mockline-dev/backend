/**
 * Weaviate Monitoring and Metrics Tracking
 *
 * Provides comprehensive monitoring, metrics tracking, and health checks
 * for the Weaviate vector database integration.
 */

import type { WeaviateClient } from 'weaviate-ts-client'
import { logger } from '../../../logger'

/**
 * Metrics for indexing operations
 */
export interface MonitoringIndexingMetrics {
  totalIndexed: number
  totalFailed: number
  indexingTime: number
  averageTimePerItem: number
  timestamp: number
}

/**
 * Metrics for search operations
 */
export interface MonitoringSearchMetrics {
  searchTime: number
  resultsCount: number
  averageScore: number
  timestamp: number
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  isHealthy: boolean
  latency: number
  error?: string
  timestamp: number
}

/**
 * Aggregated metrics
 */
export interface AggregatedMetrics {
  totalIndexingOperations: number
  totalSearchOperations: number
  averageIndexingTime: number
  averageSearchTime: number
  successRate: number
  uptime: number
  lastHealthCheck: HealthCheckResult | null
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  enabled: boolean
  healthCheckInterval: number
  metricsRetentionDays: number
  alertThresholds: {
    maxLatency: number
    minSuccessRate: number
    maxFailureRate: number
  }
}

/**
 * Weaviate monitoring and metrics tracker
 */
export class WeaviateMonitor {
  private client: WeaviateClient
  private config: MonitoringConfig
  private indexingMetrics: MonitoringIndexingMetrics[] = []
  private searchMetrics: MonitoringSearchMetrics[] = []
  private healthCheckResults: HealthCheckResult[] = []
  private healthCheckInterval: NodeJS.Timeout | null = null
  private startTime: number = Date.now()

  constructor(client: WeaviateClient, config: MonitoringConfig) {
    this.client = client
    this.config = config
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Weaviate monitoring is disabled')
      return
    }

    logger.info(
      'Starting Weaviate monitoring with %dms health check interval',
      this.config.healthCheckInterval
    )

    // Start periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck()
    }, this.config.healthCheckInterval)

    // Perform initial health check
    this.performHealthCheck()
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
      logger.info('Weaviate monitoring stopped')
    }
  }

  /**
   * Record indexing metrics
   */
  recordIndexingMetrics(metrics: MonitoringIndexingMetrics): void {
    this.indexingMetrics.push(metrics)
    this.cleanupOldMetrics()

    logger.debug(
      'Recorded indexing metrics: indexed=%d, failed=%d, time=%dms',
      metrics.totalIndexed,
      metrics.totalFailed,
      metrics.indexingTime
    )

    // Check for alert conditions
    this.checkAlertConditions(metrics)
  }

  /**
   * Record search metrics
   */
  recordSearchMetrics(metrics: MonitoringSearchMetrics): void {
    this.searchMetrics.push(metrics)
    this.cleanupOldMetrics()

    logger.debug(
      'Recorded search metrics: time=%dms, results=%d, avgScore=%.3f',
      metrics.searchTime,
      metrics.resultsCount,
      metrics.averageScore
    )

    // Check for alert conditions
    this.checkAlertConditions(metrics)
  }

  /**
   * Perform health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now()

    try {
      // Check Weaviate health
      const response = await this.client.misc.liveChecker().do()
      const latency = Date.now() - startTime
      const isHealthy = response.status === 200

      const result: HealthCheckResult = {
        isHealthy,
        latency,
        timestamp: Date.now()
      }

      this.healthCheckResults.push(result)
      this.cleanupOldMetrics()

      if (!isHealthy) {
        logger.warn('Weaviate health check failed: status=%d, latency=%dms', response.status, latency)
      } else {
        logger.debug('Weaviate health check passed: latency=%dms', latency)
      }

      return result
    } catch (error: any) {
      const latency = Date.now() - startTime
      const result: HealthCheckResult = {
        isHealthy: false,
        latency,
        error: error.message,
        timestamp: Date.now()
      }

      this.healthCheckResults.push(result)
      this.cleanupOldMetrics()

      logger.error('Weaviate health check error: %s (latency=%dms)', error.message, latency)

      return result
    }
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(): AggregatedMetrics {
    const totalIndexingOperations = this.indexingMetrics.length
    const totalSearchOperations = this.searchMetrics.length

    const averageIndexingTime =
      totalIndexingOperations > 0
        ? this.indexingMetrics.reduce((sum, m) => sum + m.indexingTime, 0) / totalIndexingOperations
        : 0

    const averageSearchTime =
      totalSearchOperations > 0
        ? this.searchMetrics.reduce((sum, m) => sum + m.searchTime, 0) / totalSearchOperations
        : 0

    const totalIndexed = this.indexingMetrics.reduce((sum, m) => sum + m.totalIndexed, 0)
    const totalFailed = this.indexingMetrics.reduce((sum, m) => sum + m.totalFailed, 0)
    const totalOperations = totalIndexed + totalFailed

    const successRate = totalOperations > 0 ? totalIndexed / totalOperations : 1

    const lastHealthCheck =
      this.healthCheckResults.length > 0 ? this.healthCheckResults[this.healthCheckResults.length - 1] : null

    return {
      totalIndexingOperations,
      totalSearchOperations,
      averageIndexingTime,
      averageSearchTime,
      successRate,
      uptime: Date.now() - this.startTime,
      lastHealthCheck
    }
  }

  /**
   * Get recent indexing metrics
   */
  getRecentIndexingMetrics(count: number = 10): MonitoringIndexingMetrics[] {
    return this.indexingMetrics.slice(-count)
  }

  /**
   * Get recent search metrics
   */
  getRecentSearchMetrics(count: number = 10): MonitoringSearchMetrics[] {
    return this.searchMetrics.slice(-count)
  }

  /**
   * Get recent health check results
   */
  getRecentHealthChecks(count: number = 10): HealthCheckResult[] {
    return this.healthCheckResults.slice(-count)
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.indexingMetrics = []
    this.searchMetrics = []
    this.healthCheckResults = []
    this.startTime = Date.now()
    logger.info('Weaviate metrics reset')
  }

  /**
   * Cleanup old metrics based on retention policy
   */
  private cleanupOldMetrics(): void {
    const retentionTimestamp = Date.now() - this.config.metricsRetentionDays * 24 * 60 * 60 * 1000

    this.indexingMetrics = this.indexingMetrics.filter(m => m.timestamp > retentionTimestamp)
    this.searchMetrics = this.searchMetrics.filter(m => m.timestamp > retentionTimestamp)
    this.healthCheckResults = this.healthCheckResults.filter(h => h.timestamp > retentionTimestamp)
  }

  /**
   * Check alert conditions and log warnings
   */
  private checkAlertConditions(metrics: MonitoringIndexingMetrics | MonitoringSearchMetrics): void {
    const thresholds = this.config.alertThresholds

    if ('searchTime' in metrics) {
      const searchMetrics = metrics as MonitoringSearchMetrics

      // Check for high latency
      if (searchMetrics.searchTime > thresholds.maxLatency) {
        logger.warn(
          'Weaviate search latency exceeded threshold: %dms > %dms',
          searchMetrics.searchTime,
          thresholds.maxLatency
        )
      }

      // Check for low success rate (no results)
      if (searchMetrics.resultsCount === 0) {
        logger.warn('Weaviate search returned no results for query')
      }
    }

    if ('totalFailed' in metrics) {
      const indexingMetrics = metrics as MonitoringIndexingMetrics
      const failureRate =
        indexingMetrics.totalIndexed + indexingMetrics.totalFailed > 0
          ? indexingMetrics.totalFailed / (indexingMetrics.totalIndexed + indexingMetrics.totalFailed)
          : 0

      // Check for high failure rate
      if (failureRate > thresholds.maxFailureRate) {
        logger.warn(
          'Weaviate indexing failure rate exceeded threshold: %.2f > %.2f',
          failureRate,
          thresholds.maxFailureRate
        )
      }

      // Check for low success rate
      const successRate = 1 - failureRate
      if (successRate < thresholds.minSuccessRate) {
        logger.warn(
          'Weaviate indexing success rate below threshold: %.2f < %.2f',
          successRate,
          thresholds.minSuccessRate
        )
      }
    }
  }
}

/**
 * Global monitor instance
 */
let globalMonitor: WeaviateMonitor | null = null

/**
 * Initialize global monitor
 */
export function initializeWeaviateMonitor(client: WeaviateClient, config: MonitoringConfig): WeaviateMonitor {
  if (globalMonitor) {
    logger.info('Weaviate monitor already initialized')
    return globalMonitor
  }

  globalMonitor = new WeaviateMonitor(client, config)
  globalMonitor.start()
  return globalMonitor
}

/**
 * Get global monitor
 */
export function getWeaviateMonitor(): WeaviateMonitor {
  if (!globalMonitor) {
    throw new Error('Weaviate monitor not initialized. Call initializeWeaviateMonitor() first.')
  }
  return globalMonitor
}

/**
 * Default monitoring configuration
 */
export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  enabled: true,
  healthCheckInterval: 60000, // 1 minute
  metricsRetentionDays: 7, // 7 days
  alertThresholds: {
    maxLatency: 5000, // 5 seconds
    minSuccessRate: 0.95, // 95%
    maxFailureRate: 0.05 // 5%
  }
}
