import type { GeneratedFile } from './file-generator'
import type { IntentSchema } from './intent-analyzer'
import type { Relationship } from './schema-validator'

export interface ArchService {
  name: string
  description: string
  routes: string[]
  modelName?: string
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
  tableName?: string
  fields: Array<{
    name: string
    type: string
    required: boolean
    indexed?: boolean
    unique?: boolean
    /** Entity name this field references as a foreign key */
    foreignKeyRef?: string
  }>
}

export interface ArchRelation {
  from: string
  to: string
  type: 'one-to-many' | 'many-to-one' | 'many-to-many' | 'one-to-one'
  foreignKey?: string
  label?: string
}

export interface ArchRoute {
  method: string
  path: string
  service: string
  authRequired?: boolean
  description?: string
}

export interface ArchTechStack {
  framework: string
  language: string
  database: string
  auth: string
  orm?: string
}

export interface ArchLayer {
  name: string
  role: string
  description: string
  files: string[]
}

export interface ArchSummary {
  totalEndpoints: number
  totalModels: number
  totalRelations: number
  authEnabled: boolean
}

export interface ArchDataFlowStep {
  layer: string
  component: string
  action: string
}

export interface ArchDataFlow {
  endpoint: string
  method: string
  steps: ArchDataFlowStep[]
}

export interface ArchitectureData {
  services: ArchService[]
  models: ArchModel[]
  relations: ArchRelation[]
  routes: ArchRoute[]
  serviceDependencies?: Array<{ from: string; to: string }>
  techStack?: ArchTechStack
  layers?: ArchLayer[]
  summary?: ArchSummary
  dataFlow?: ArchDataFlow[]
}

export class ArchitectureExtractor {
  extract(schema: IntentSchema, files: GeneratedFile[], relationships: Relationship[] = []): ArchitectureData {
    const routes = this.extractRoutes(files, schema)
    const routeByService = new Map<string, ArchRoute[]>()
    for (const route of routes) {
      if (!routeByService.has(route.service)) {
        routeByService.set(route.service, [])
      }
      routeByService.get(route.service)?.push(route)
    }

    // Build a lookup: lowercase entity name → canonical name (for FK detection)
    const entityNameMap = new Map(schema.entities.map(e => [e.name.toLowerCase(), e.name]))

    const models: ArchModel[] = schema.entities.map(entity => ({
      name: entity.name,
      tableName: entity.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() + 's',
      fields: entity.fields.map(f => {
        const fieldLower = f.name.toLowerCase()
        // Detect foreign key reference: field named <entity>_id or <entity>id
        let foreignKeyRef: string | undefined
        for (const [targetLower, targetName] of entityNameMap) {
          if (
            targetLower !== entity.name.toLowerCase() &&
            (fieldLower === `${targetLower}_id` || fieldLower === `${targetLower}id`)
          ) {
            foreignKeyRef = targetName
            break
          }
        }
        return {
          name: f.name,
          type: f.type,
          required: Boolean(f.required ?? false),
          indexed: /id$|_id$/.test(fieldLower),
          unique: /email|username|slug|^id$/.test(fieldLower),
          ...(foreignKeyRef ? { foreignKeyRef } : {})
        }
      })
    }))

    // Use pre-validated relationships if available, otherwise infer them
    const rawRelations = relationships.length > 0
      ? this.convertRelationships(relationships)
      : this.inferRelations(schema)

    // Attach human-readable labels
    const relations = rawRelations.map(r => ({ ...r, label: this.relationLabel(r.type) }))

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
        description: `${entity.name} service — manages ${entity.name.toLowerCase()} CRUD and business logic`,
        modelName: entity.name,
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

    const techStack = this.extractTechStack(schema)
    const layers = this.extractLayers(files, schema)
    const summary: ArchSummary = {
      totalEndpoints: routes.length,
      totalModels: models.length,
      totalRelations: relations.length,
      authEnabled: schema.authType !== 'none' && Boolean(schema.authType)
    }
    const dataFlow = this.buildDataFlow(routes, schema)

    return { services, models, relations, routes, serviceDependencies, techStack, layers, summary, dataFlow }
  }

  private relationLabel(type: ArchRelation['type']): string {
    switch (type) {
      case 'one-to-many':  return 'has many'
      case 'many-to-one':  return 'belongs to'
      case 'many-to-many': return 'has and belongs to many'
      case 'one-to-one':   return 'has one'
    }
  }

  private extractTechStack(schema: IntentSchema): ArchTechStack {
    const authLabel =
      schema.authType === 'jwt'    ? 'JWT' :
      schema.authType === 'oauth2' ? 'OAuth2' :
      schema.authType === 'none'   ? 'None' : 'JWT'

    // Check if any PostgreSQL/MySQL indicators are present in schema description
    const desc = (schema.description ?? '').toLowerCase()
    const database =
      desc.includes('postgres') ? 'PostgreSQL' :
      desc.includes('mysql')    ? 'MySQL' :
      'SQLite'

    return {
      framework: 'FastAPI',
      language:  'Python',
      database,
      auth:      authLabel,
      orm:       'SQLAlchemy'
    }
  }

  private extractLayers(files: GeneratedFile[], schema: IntentSchema): ArchLayer[] {
    const filePaths = files.map(f => f.path)

    const pick = (pattern: RegExp) => filePaths.filter(p => pattern.test(p))

    const layers: ArchLayer[] = [
      {
        name:        'API Layer',
        role:        'controller',
        description: 'FastAPI routers — handle HTTP requests, validate input, call the service layer',
        files:       pick(/^app\/api\/.+\.py$/)
      },
      {
        name:        'Service Layer',
        role:        'business-logic',
        description: 'Business logic — orchestrate data access, apply rules, return domain objects',
        files:       pick(/^app\/services\/.+\.py$/)
      },
      {
        name:        'Schema Layer',
        role:        'validation',
        description: 'Pydantic schemas — request/response validation and serialisation',
        files:       pick(/^app\/schemas\/.+\.py$/)
      },
      {
        name:        'Data Layer',
        role:        'persistence',
        description: 'SQLAlchemy ORM models — define database tables and relationships',
        files:       pick(/^app\/models\/.+\.py$/)
      },
      {
        name:        'Core',
        role:        'infrastructure',
        description: 'Core utilities — configuration, security, database session, dependency injection',
        files:       pick(/^app\/core\/.+\.py$/)
      }
    ]

    // Only return layers that have files or are API/Service (always relevant)
    return layers.filter(l => l.files.length > 0)
  }

  private inferRelations(schema: IntentSchema): ArchRelation[] {
    const entityNames = new Map(schema.entities.map(e => [e.name.toLowerCase(), e.name]))
    const relations: ArchRelation[] = []
    const seen = new Set<string>()

    for (const entity of schema.entities) {
      for (const field of entity.fields) {
        const fieldLower = field.name.toLowerCase()
        let matched = false

        for (const [targetLower, targetName] of entityNames) {
          if (targetLower === entity.name.toLowerCase()) continue

          const isRef =
            fieldLower === targetLower ||
            fieldLower === `${targetLower}id` ||
            fieldLower === `${targetLower}_id` ||
            fieldLower.startsWith(`${targetLower}_`)

          if (isRef) {
            matched = true
            const key = `${entity.name}:${targetName}:${field.name}`
            if (!seen.has(key)) {
              seen.add(key)
              const isList =
                field.type.toLowerCase().includes('list') ||
                field.type.toLowerCase().includes('array') ||
                field.type.toLowerCase().includes('[]')

              relations.push({
                from: entity.name,
                to: targetName,
                type: isList ? 'one-to-many' : 'many-to-one',
                foreignKey: field.name
              })
            }
          }
        }

        // For _id fields that didn't match any entity by name, check if the
        // field type hints at a relationship (e.g., assignee_id with type "User")
        if (!matched && fieldLower.endsWith('_id')) {
          const fieldType = field.type.toLowerCase()
          for (const [targetLower, targetName] of entityNames) {
            if (targetLower === entity.name.toLowerCase()) continue
            if (fieldType.includes(targetLower)) {
              const key = `${entity.name}:${targetName}:${field.name}`
              if (!seen.has(key)) {
                seen.add(key)
                relations.push({
                  from: entity.name,
                  to: targetName,
                  type: 'many-to-one',
                  foreignKey: field.name
                })
              }
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
      type: rel.type,
      ...(rel.foreignKey ? { foreignKey: rel.foreignKey } : {})
    }))
  }

  private extractRoutes(files: GeneratedFile[], schema: IntentSchema): ArchRoute[] {
    const routes: ArchRoute[] = []
    const seen = new Set<string>()

    // Match FastAPI route decorators on a single line (standard and f-string paths)
    const simplePattern = /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*[f]?["']([^"']+)["']/gi

    // APIRouter prefix pattern: router = APIRouter(prefix="/something")
    const prefixPattern = /APIRouter\s*\([^)]*prefix\s*=\s*["']([^"']+)["']/gi

    // Public endpoints that don't require auth (login, register, token, docs, health)
    const publicPathPattern = /\/(login|register|token|refresh|health|docs|openapi|redoc)/i

    for (const file of files) {
      if (!file.path.endsWith('.py')) continue

      // Extract router prefix if present
      let routerPrefix = ''
      const prefixMatch = prefixPattern.exec(file.content)
      if (prefixMatch) {
        routerPrefix = prefixMatch[1].replace(/\/$/, '')
      }
      prefixPattern.lastIndex = 0

      let match: RegExpExecArray | null
      const pattern = new RegExp(simplePattern.source, 'gi')

      while ((match = pattern.exec(file.content)) !== null) {
        const method = match[1].toUpperCase()
        const rawPath = match[2]
        const path = routerPrefix ? `${routerPrefix}${rawPath}` : rawPath
        const key = `${method}:${path}`

        if (!seen.has(key)) {
          seen.add(key)
          const service = this.matchService(path, schema)
          const authRequired = !publicPathPattern.test(path) && method !== 'GET'
            ? true
            : !publicPathPattern.test(path) && method === 'GET' && !path.endsWith('s') ? true : false
          routes.push({
            method,
            path,
            service,
            authRequired,
            description: this.describeRoute(method, path, service)
          })
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
            routes.push({
              method: 'GET',
              path: ep,
              service: entity.name,
              authRequired: true,
              description: `List ${entity.name} records`
            })
          }
        }
      }
    }

    return routes
  }

  private describeRoute(method: string, path: string, service: string): string {
    const hasId = path.includes('{') || path.includes(':id')
    switch (method) {
      case 'GET':    return hasId ? `Get a single ${service}` : `List all ${service} records`
      case 'POST':   return `Create a new ${service}`
      case 'PUT':    return `Replace a ${service}`
      case 'PATCH':  return `Update a ${service}`
      case 'DELETE': return `Delete a ${service}`
      default:       return `${method} ${path}`
    }
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

  /**
   * Builds explicit request-processing chains for each unique endpoint.
   * Limits to max 12 flows (one per entity × 4 CRUD ops) to keep the payload sane.
   */
  private buildDataFlow(routes: ArchRoute[], schema: IntentSchema): ArchDataFlow[] {
    const flows: ArchDataFlow[] = []
    const seen = new Set<string>()

    // HTTP method → descriptive action
    const actionMap: Record<string, string> = {
      GET:    'query & return records',
      POST:   'validate input & persist new record',
      PUT:    'replace record',
      PATCH:  'apply partial update',
      DELETE: 'delete record & return confirmation'
    }

    for (const route of routes) {
      const key = `${route.method}:${route.service}`
      if (seen.has(key) || flows.length >= 12) break
      seen.add(key)

      const serviceName = route.service !== 'unknown' ? route.service : 'App'
      const modelName   = serviceName
      const action      = actionMap[route.method] ?? route.method.toLowerCase()
      const hasId       = route.path.includes('{') || route.path.includes(':id')

      flows.push({
        endpoint: route.path,
        method:   route.method,
        steps: [
          {
            layer:     'API Layer',
            component: `${serviceName}Router`,
            action:    `Receive ${route.method} ${route.path}, authenticate${route.authRequired ? ' (JWT required)' : ''}, validate request`
          },
          {
            layer:     'Service Layer',
            component: `${serviceName}Service`,
            action:    `${action}${hasId ? ' by id' : ''}`
          },
          {
            layer:     'Data Layer',
            component: `${modelName} (SQLAlchemy)`,
            action:    route.method === 'GET'
              ? `SELECT FROM ${modelName.toLowerCase()}s${hasId ? ' WHERE id = ?' : ''}`
              : route.method === 'POST'
              ? `INSERT INTO ${modelName.toLowerCase()}s`
              : route.method === 'DELETE'
              ? `DELETE FROM ${modelName.toLowerCase()}s WHERE id = ?`
              : `UPDATE ${modelName.toLowerCase()}s SET ... WHERE id = ?`
          },
          {
            layer:     'Database',
            component: 'SQLite',
            action:    'Execute SQL and commit transaction'
          }
        ]
      })
    }

    return flows
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
