// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#custom-services
import type { Params } from '@feathersjs/feathers'

import type { StackConfig } from '../../agent/stacks'
import { createInitializedRegistry } from '../../agent/stacks'
import type { Application } from '../../declarations'
import type { Stack, StackQuery } from './stacks.schema'

export type { Stack, StackQuery }

/**
 * Custom service for managing stack configurations
 * Stacks are read-only and served from in-memory registry
 */
export class StackService<ServiceParams extends Params = Params<StackQuery>> {
  private registry: ReturnType<typeof createInitializedRegistry>

  constructor(app: Application) {
    this.registry = createInitializedRegistry()
  }

  /**
   * Get all available stacks
   * Supports pagination through Feathers standard params
   */
  async find(
    params?: ServiceParams
  ): Promise<Stack[] | { data: Stack[]; total: number; limit: number; skip: number }> {
    const allStacks = this.registry.getAll()

    // Transform StackConfig to Stack API response format
    const stacks = allStacks.map(stackConfig => this.transformStackConfig(stackConfig))

    // Handle pagination if requested
    if (params?.query?.$limit || params?.query?.$skip) {
      const $limit = params.query.$limit ?? 10
      const $skip = params.query.$skip ?? 0
      const total = stacks.length
      const paginatedStacks = stacks.slice($skip, $skip + $limit)

      return {
        data: paginatedStacks,
        total,
        limit: $limit,
        skip: $skip
      }
    }

    // Return all stacks without pagination
    return stacks
  }

  /**
   * Get a specific stack by ID
   */
  async get(id: string, params?: ServiceParams): Promise<Stack> {
    const stackConfig = this.registry.get(id)

    if (!stackConfig) {
      throw new Error(`Stack with ID '${id}' not found`)
    }

    return this.transformStackConfig(stackConfig)
  }

  /**
   * Transform StackConfig to Stack API response format
   * Extracts only fields needed by frontend
   */
  private transformStackConfig(config: StackConfig): Stack {
    return {
      id: config.id,
      name: config.name,
      language: config.language,
      framework: config.framework,
      description: config.description,
      features: this.extractFeatures(config),
      icon: this.getIconForStack(config.id),
      color: this.getColorForStack(config.id)
    }
  }

  /**
   * Extract key features from stack configuration
   * Features are derived from stack's capabilities and dependencies
   */
  private extractFeatures(config: StackConfig): string[] {
    const features: string[] = []

    // Add language/framework features
    features.push(`${config.language} ${config.framework}`)

    // Add type system features
    if (config.typeSystem.primitiveTypes) {
      features.push('Strong typing')
    }

    // Add testing features
    if (config.testing.framework) {
      features.push(`Testing: ${config.testing.framework}`)
    }

    // Add validation features
    if (config.validation.linter) {
      features.push(`Linting: ${config.validation.linter}`)
    }

    // Add dependency management features
    if (config.dependencies.packageManager) {
      features.push(`Package Manager: ${config.dependencies.packageManager}`)
    }

    // Add ORM/database features from dependencies
    const dbPackages = config.dependencies.corePackages.filter(pkg => pkg.category === 'database')
    if (dbPackages.length > 0) {
      features.push(`Database: ${dbPackages.map(pkg => pkg.name).join(', ')}`)
    }

    // Add security features from dependencies
    const securityPackages = config.dependencies.corePackages.filter(pkg => pkg.category === 'security')
    if (securityPackages.length > 0) {
      features.push(`Security: ${securityPackages.map(pkg => pkg.name).join(', ')}`)
    }

    return features
  }

  /**
   * Get icon URL for a stack
   * Returns a placeholder icon URL based on stack ID
   */
  private getIconForStack(stackId: string): string | undefined {
    const iconMap: Record<string, string> = {
      'python-fastapi': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',
      'nodejs-nestjs': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg',
      'go-gin': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original.svg',
      'rust-actix': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-plain.svg',
      'java-springboot': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg'
    }

    return iconMap[stackId]
  }

  /**
   * Get color theme for a stack
   * Returns a color code based on stack ID
   */
  private getColorForStack(stackId: string): string | undefined {
    const colorMap: Record<string, string> = {
      'python-fastapi': '#3776AB',
      'nodejs-nestjs': '#339933',
      'go-gin': '#00ADD8',
      'rust-actix': '#DEA584',
      'java-springboot': '#6DB33F'
    }

    return colorMap[stackId]
  }
}

/**
 * Get service options
 * Since this is a custom service not backed by a database, we return minimal options
 */
export const getOptions = (app: Application) => {
  return {
    paginate: app.get('paginate')
  }
}
