import { logger } from '../../logger'
import type { IntentSchema } from './intent-analyzer'
import type { TaskPlan } from './task-planner'

export interface FileDependency {
  path: string
  dependencies: string[] // List of file paths this file depends on
  dependents: string[] // List of files that depend on this file
  critical: boolean // Whether this is a critical dependency
  stage: number // Generation stage (0-6)
}

export interface DependencyGraph {
  nodes: Map<string, FileDependency>
  edges: Map<string, Set<string>> // from -> to
  reverseEdges: Map<string, Set<string>> // to -> from
}

/**
 * Analyzes file dependencies from task plans and schema.
 * Builds a dependency graph and determines optimal generation order.
 */
export class DependencyAnalyzer {
  /**
   * Analyzes dependencies for all files in the task plan.
   * Returns a dependency graph with topological sort order.
   */
  analyzeDependencies(plan: TaskPlan[], schema: IntentSchema): DependencyGraph {
    logger.debug('DependencyAnalyzer: analyzing dependencies for %d files', plan.length)

    const nodes = new Map<string, FileDependency>()
    const edges = new Map<string, Set<string>>()
    const reverseEdges = new Map<string, Set<string>>()

    // Initialize nodes
    for (const task of plan) {
      const stage = this.classifyTaskStage(task.path)
      nodes.set(task.path, {
        path: task.path,
        dependencies: [],
        dependents: [],
        critical: this.isCriticalFile(task.path),
        stage
      })
      edges.set(task.path, new Set())
      reverseEdges.set(task.path, new Set())
    }

    // Analyze dependencies based on file paths and schema
    for (const task of plan) {
      const dependencies = this.extractDependencies(task, plan, schema)
      const node = nodes.get(task.path)!

      for (const dep of dependencies) {
        if (nodes.has(dep)) {
          node.dependencies.push(dep)
          edges.get(task.path)!.add(dep)
          reverseEdges.get(dep)!.add(task.path)

          // Update dependents for the dependency
          const depNode = nodes.get(dep)!
          depNode.dependents.push(task.path)
        }
      }
    }

    logger.debug(
      'DependencyAnalyzer: built dependency graph with %d nodes and %d edges',
      nodes.size,
      Array.from(edges.values()).reduce((sum, set) => sum + set.size, 0)
    )

    return { nodes, edges, reverseEdges }
  }

  /**
   * Extracts dependencies for a specific file based on its path and schema.
   */
  private extractDependencies(task: TaskPlan, plan: TaskPlan[], schema: IntentSchema): string[] {
    const dependencies: string[] = []
    const path = task.path.toLowerCase()

    // Config files (stage 0) have no dependencies
    if (path.startsWith('requirements.txt') || path.startsWith('.env') || path.includes('alembic.ini')) {
      return []
    }

    // Core files (stage 0) depend on config files
    if (path.startsWith('app/core/')) {
      if (path.includes('config.py')) {
        return ['requirements.txt', '.env.example']
      }
      if (path.includes('database.py')) {
        return ['app/core/config.py']
      }
      if (path.includes('security.py')) {
        return ['app/core/config.py', 'requirements.txt']
      }
      return ['app/core/config.py', 'requirements.txt']
    }

    // Models (stage 1) depend on core files
    if (path.startsWith('app/models/')) {
      const entityName = this.extractEntityName(path)
      const deps = ['app/core/database.py', 'app/core/config.py']

      // Add model dependencies based on relationships
      for (const entity of schema.entities) {
        if (entity.name.toLowerCase() === entityName) {
          for (const field of entity.fields) {
            const fieldLower = field.name.toLowerCase()
            for (const otherEntity of schema.entities) {
              if (otherEntity.name.toLowerCase() === entityName) continue

              const otherEntityLower = otherEntity.name.toLowerCase()
              if (
                fieldLower === `${otherEntityLower}id` ||
                fieldLower === `${otherEntityLower}_id` ||
                fieldLower.startsWith(`${otherEntityLower}_`)
              ) {
                const depPath = `app/models/${otherEntity.name.toLowerCase()}.py`
                if (!deps.includes(depPath)) {
                  deps.push(depPath)
                }
              }
            }
          }
          break
        }
      }

      return deps
    }

    // Schemas (stage 2) depend on models
    if (path.startsWith('app/schemas/')) {
      const entityName = this.extractEntityName(path)
      return [`app/models/${entityName}.py`]
    }

    // Services (stage 3) depend on models and schemas
    if (path.startsWith('app/services/')) {
      const entityName = this.extractEntityName(path)
      const deps = [`app/models/${entityName}.py`, `app/schemas/${entityName}.py`]

      // Add service dependencies based on relationships
      for (const entity of schema.entities) {
        if (entity.name.toLowerCase() === entityName) {
          for (const field of entity.fields) {
            const fieldLower = field.name.toLowerCase()
            for (const otherEntity of schema.entities) {
              if (otherEntity.name.toLowerCase() === entityName) continue

              const otherEntityLower = otherEntity.name.toLowerCase()
              if (
                fieldLower === `${otherEntityLower}id` ||
                fieldLower === `${otherEntityLower}_id` ||
                fieldLower.startsWith(`${otherEntityLower}_`)
              ) {
                const depPath = `app/services/${otherEntity.name.toLowerCase()}.py`
                if (!deps.includes(depPath)) {
                  deps.push(depPath)
                }
              }
            }
          }
          break
        }
      }

      return deps
    }

    // API routers (stage 4) depend on services and schemas
    if (path.startsWith('app/api/')) {
      const entityName = this.extractEntityName(path)
      const deps = [`app/services/${entityName}.py`, `app/schemas/${entityName}.py`, 'app/core/deps.py']

      // Auth API depends on security
      if (path.includes('auth.py')) {
        deps.push('app/core/security.py')
      }

      return deps
    }

    // Main app (stage 5) depends on all APIs and core
    if (path === 'main.py' || path.startsWith('app/__init__.py')) {
      const apiFiles = plan.filter(t => t.path.startsWith('app/api/')).map(t => t.path)
      return [...apiFiles, 'app/core/config.py', 'app/core/database.py']
    }

    // Tests (stage 6) depend on what they test
    if (path.startsWith('tests/')) {
      if (path.includes('test_api/')) {
        const entityName = this.extractEntityName(path)
        return [`app/api/${entityName}.py`]
      }
      if (path.includes('test_services/')) {
        const entityName = this.extractEntityName(path)
        return [`app/services/${entityName}.py`]
      }
      if (path.includes('test_models/')) {
        const entityName = this.extractEntityName(path)
        return [`app/models/${entityName}.py`]
      }
      if (path.includes('test_core/')) {
        return ['app/core/config.py', 'app/core/security.py', 'app/core/database.py']
      }
      return ['app/core/config.py']
    }

    return []
  }

  /**
   * Extracts entity name from file path.
   * Example: "app/models/user.py" -> "user"
   */
  private extractEntityName(path: string): string {
    const parts = path.split('/')
    const filename = parts[parts.length - 1] || ''
    return filename.replace('.py', '').toLowerCase()
  }

  /**
   * Determines if a file is critical (should be generated early).
   */
  private isCriticalFile(path: string): boolean {
    const normalized = path.toLowerCase()

    // Config files are critical
    if (normalized === 'requirements.txt' || normalized === '.env.example' || normalized === 'alembic.ini') {
      return true
    }

    // Core files are critical
    if (normalized.startsWith('app/core/')) {
      return true
    }

    // Models are critical (they define the data structure)
    if (normalized.startsWith('app/models/')) {
      return true
    }

    return false
  }

  /**
   * Classifies task stage based on file path.
   * Matches the staging logic in file-generator.ts
   */
  private classifyTaskStage(path: string): number {
    const normalized = path.toLowerCase()

    if (
      normalized === 'requirements.txt' ||
      normalized === '.env' ||
      normalized === '.env.example' ||
      normalized === 'alembic.ini' ||
      normalized.startsWith('app/core/')
    ) {
      return 0
    }

    if (normalized.startsWith('app/models/')) {
      return 1
    }

    if (normalized.startsWith('app/schemas/')) {
      return 2
    }

    if (normalized.startsWith('app/services/') || normalized.startsWith('app/utils/')) {
      return 3
    }

    if (normalized.startsWith('app/api/')) {
      return 4
    }

    if (normalized === 'main.py' || normalized.startsWith('app/__')) {
      return 5
    }

    if (normalized.startsWith('tests/') || normalized.startsWith('docs/') || normalized === 'readme.md') {
      return 6
    }

    return 5
  }

  /**
   * Performs topological sort on the dependency graph.
   * Returns files in order of dependencies (dependencies first).
   */
  topologicalSort(graph: DependencyGraph): string[] {
    const sorted: string[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (node: string): void => {
      if (visiting.has(node)) {
        logger.warn('DependencyAnalyzer: circular dependency detected at %s', node)
        return
      }
      if (visited.has(node)) {
        return
      }

      visiting.add(node)

      const dependencies = graph.edges.get(node) || new Set()
      for (const dep of dependencies) {
        visit(dep)
      }

      visiting.delete(node)
      visited.add(node)
      sorted.push(node)
    }

    // Visit all nodes
    for (const node of graph.nodes.keys()) {
      visit(node)
    }

    logger.debug('DependencyAnalyzer: topological sort produced %d files', sorted.length)
    return sorted
  }

  /**
   * Gets files in generation order, grouped by stage.
   * Maintains stage boundaries while respecting dependencies.
   */
  getOrderedFiles(graph: DependencyGraph, plan: TaskPlan[]): TaskPlan[] {
    const sortedPaths = this.topologicalSort(graph)
    const pathToTask = new Map(plan.map(t => [t.path, t]))

    // Create ordered tasks while maintaining stage grouping
    const orderedTasks: TaskPlan[] = []
    const stages = new Map<number, TaskPlan[]>()

    // Group by stage
    for (const path of sortedPaths) {
      const task = pathToTask.get(path)
      if (task) {
        const stage = graph.nodes.get(path)!.stage
        if (!stages.has(stage)) {
          stages.set(stage, [])
        }
        stages.get(stage)!.push(task)
      }
    }

    // Flatten stages in order
    const maxStage = Math.max(0, ...stages.keys())
    for (let stage = 0; stage <= maxStage; stage++) {
      const stageTasks = stages.get(stage) || []
      orderedTasks.push(...stageTasks)
    }

    return orderedTasks
  }
}
