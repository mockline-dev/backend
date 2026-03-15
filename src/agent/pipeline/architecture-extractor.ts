import type { GeneratedFile } from './file-generator'
import type { IntentSchema } from './intent-analyzer'
import type { Relationship } from './schema-validator'

export interface ArchService {
  name: string
  description: string
  routes: string[]
  methods?: Array<{
    name: string
    httpMethod?: string
    path?: string
    params?: string[]
    returnType?: string
  }>
  dependencies?: string[]
}

export interface ArchModel {
  name: string
  fields: Array<{
    name: string
    type: string
    required: boolean
    indexed?: boolean
    unique?: boolean
  }>
}

export interface ArchRelation {
  from: string
  to: string
  type: 'one-to-many' | 'many-to-one' | 'many-to-many' | 'one-to-one'
  // Note: foreignKey and bidirectional are not included as they're not in the main schema
  // They are used internally for validation but not persisted
}

export interface ArchRoute {
  method: string
  path: string
  service: string
}

export interface ArchitectureData {
  services: ArchService[]
  models: ArchModel[]
  relations: ArchRelation[]
  routes: ArchRoute[]
  serviceDependencies?: Array<{ from: string; to: string }>
}

export class ArchitectureExtractor {
  extract(
    schema: IntentSchema,
    files: GeneratedFile[],
    relationships: Relationship[] = []
  ): ArchitectureData {
    const routes = this.extractRoutes(files, schema)
    const routeByService = new Map<string, ArchRoute[]>()
    for (const route of routes) {
      if (!routeByService.has(route.service)) {
        routeByService.set(route.service, [])
      }
      routeByService.get(route.service)?.push(route)
    }

    const models: ArchModel[] = schema.entities.map(entity => ({
      name: entity.name,
      fields: entity.fields.map(f => ({
        name: f.name,
        type: f.type,
        required: f.required,
        indexed: /id$|_id$/.test(f.name.toLowerCase()),
        unique: /email|username|slug|id$/.test(f.name.toLowerCase())
      }))
    }))

    // Use pre-validated relationships if available, otherwise infer them
    const relations =
      relationships.length > 0 ? this.convertRelationships(relationships) : this.inferRelations(schema)

    const serviceDependencies = this.buildServiceDependencies(relations)
    const dependencyMap = new Map<string, Set<string>>()
    for (const dep of serviceDependencies) {
      if (!dependencyMap.has(dep.from)) {
        dependencyMap.set(dep.from, new Set())
      }
      dependencyMap.get(dep.from)?.add(dep.to)
    }

    const services: ArchService[] = schema.entities.map(entity => {
      const entityRoutes = routeByService.get(entity.name) ?? []
      return {
        name: entity.name,
        description: `${entity.name} service`,
        routes: entityRoutes.map(route => `${route.method} ${route.path}`),
        methods: entityRoutes.map(route => ({
          name: `${route.method.toLowerCase()}_${entity.name.toLowerCase()}`,
          httpMethod: route.method,
          path: route.path,
          params: [],
          returnType: 'JSONResponse'
        })),
        dependencies: Array.from(dependencyMap.get(entity.name) ?? [])
      }
    })

    return { services, models, relations, routes, serviceDependencies }
  }

  private inferRelations(schema: IntentSchema): ArchRelation[] {
    const entityNames = new Map(schema.entities.map(e => [e.name.toLowerCase(), e.name]))
    const relations: ArchRelation[] = []
    const seen = new Set<string>()

    for (const entity of schema.entities) {
      for (const field of entity.fields) {
        const fieldLower = field.name.toLowerCase()

        for (const [targetLower, targetName] of entityNames) {
          if (targetLower === entity.name.toLowerCase()) continue

          const isRef =
            fieldLower === targetLower ||
            fieldLower === `${targetLower}id` ||
            fieldLower === `${targetLower}_id` ||
            fieldLower.startsWith(`${targetLower}_`)

          if (isRef) {
            const key = `${entity.name}:${targetName}`
            if (!seen.has(key)) {
              seen.add(key)
              const isList =
                field.type.toLowerCase().includes('list') ||
                field.type.toLowerCase().includes('array') ||
                field.type.toLowerCase().includes('[]')

              relations.push({
                from: entity.name,
                to: targetName,
                type: isList ? 'one-to-many' : 'one-to-one'
              })
            }
          }
        }
      }
    }

    return relations
  }

  private convertRelationships(relationships: Relationship[]): ArchRelation[] {
    return relationships.map(rel => ({
      from: rel.from,
      to: rel.to,
      type: rel.type
      // Note: foreignKey and bidirectional are not included in the main schema
      // They are used internally for validation but not persisted
    }))
  }

  private extractRoutes(files: GeneratedFile[], schema: IntentSchema): ArchRoute[] {
    const routes: ArchRoute[] = []
    const seen = new Set<string>()

    // Match FastAPI route decorators: @router.get("/path") or @app.post("/path")
    const routerPattern = /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi

    for (const file of files) {
      if (!file.path.endsWith('.py')) continue

      let match: RegExpExecArray | null
      const pattern = new RegExp(routerPattern.source, 'gi')

      while ((match = pattern.exec(file.content)) !== null) {
        const method = match[1].toUpperCase()
        const path = match[2]
        const key = `${method}:${path}`

        if (!seen.has(key)) {
          seen.add(key)
          routes.push({ method, path, service: this.matchService(path, schema) })
        }
      }
    }

    // Fall back to schema endpoints when no routes could be extracted from files
    if (routes.length === 0) {
      for (const entity of schema.entities) {
        for (const ep of entity.endpoints) {
          const key = `GET:${ep}`
          if (!seen.has(key)) {
            seen.add(key)
            routes.push({ method: 'GET', path: ep, service: entity.name })
          }
        }
      }
    }

    return routes
  }

  private matchService(path: string, schema: IntentSchema): string {
    const pathLower = path.toLowerCase()
    for (const entity of schema.entities) {
      if (pathLower.includes(entity.name.toLowerCase())) {
        return entity.name
      }
    }
    return 'unknown'
  }

  private buildServiceDependencies(relations: ArchRelation[]): Array<{ from: string; to: string }> {
    const seen = new Set<string>()
    const dependencies: Array<{ from: string; to: string }> = []

    for (const relation of relations) {
      const key = `${relation.from}:${relation.to}`
      if (seen.has(key)) continue
      seen.add(key)
      dependencies.push({ from: relation.from, to: relation.to })
    }

    return dependencies
  }
}
