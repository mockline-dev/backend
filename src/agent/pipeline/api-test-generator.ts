import type { IntentSchema } from './intent-analyzer'
import type { ArchitectureData, ArchRoute } from './architecture-extractor'
import type { Relationship } from './schema-validator'

export interface ApiTestRequest {
  name: string
  method: string
  path: string
  headers: Record<string, string>
  body?: Record<string, any>
  expectedStatus: number
}

export interface ApiTestGroup {
  name: string
  requests: ApiTestRequest[]
}

export interface ApiTestCollection {
  name: string
  baseUrl: string
  auth?: {
    type: string
    headerName: string
    tokenPlaceholder: string
  }
  groups: ApiTestGroup[]
}

// Mapping of field types to sample values
const SAMPLE_VALUES: Record<string, any> = {
  str: 'example_string',
  int: 1,
  float: 1.0,
  bool: true,
  datetime: new Date().toISOString(),
  'List[str]': ['item1', 'item2'],
  'List[int]': [1, 2],
  'List[float]': [1.0, 2.0],
  'List[dict]': [{}],
  dict: {},
  json: {}
}

function sampleValueForField(name: string, type: string): any {
  const nameLower = name.toLowerCase()
  // Special cases based on field name
  if (nameLower.includes('email')) return 'user@example.com'
  if (nameLower === 'password' || nameLower === 'password_hash') return 'SecurePassword123!'
  if (nameLower.includes('url') || nameLower.includes('link')) return 'https://example.com'
  if (nameLower.includes('phone')) return '+1234567890'
  if (nameLower.includes('name') && type === 'str') return 'Example Name'
  if (nameLower.includes('title') && type === 'str') return 'Example Title'
  if (nameLower.includes('description') && type === 'str') return 'A sample description.'
  if (nameLower.includes('slug')) return 'example-slug'
  if (nameLower.includes('status')) return 'active'
  if (nameLower.endsWith('_id') || nameLower === 'id') return '000000000000000000000001'
  return SAMPLE_VALUES[type] ?? 'value'
}

function buildSampleBody(
  entity: IntentSchema['entities'][number],
  excludeFields: string[] = ['id', 'created_at', 'updated_at', 'deleted_at']
): Record<string, any> {
  const body: Record<string, any> = {}
  for (const field of entity.fields) {
    if (excludeFields.includes(field.name)) continue
    if (!field.required) continue
    body[field.name] = sampleValueForField(field.name, field.type)
  }
  return body
}

function buildAuthHeaders(hasAuth: boolean): Record<string, string> {
  if (!hasAuth) return { 'Content-Type': 'application/json' }
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer {{ACCESS_TOKEN}}'
  }
}

/**
 * Sorts entities so that entities with no foreign-key dependencies come first.
 * This ensures "create parent before child" ordering in the test collection.
 */
function sortEntitiesByDependency(
  entities: IntentSchema['entities'],
  relationships: Relationship[]
): IntentSchema['entities'] {
  const dependsOn = new Map<string, Set<string>>()
  for (const e of entities) {
    dependsOn.set(e.name, new Set())
  }
  for (const rel of relationships) {
    if (rel.type === 'many-to-one' && dependsOn.has(rel.from)) {
      dependsOn.get(rel.from)!.add(rel.to)
    }
  }

  const sorted: IntentSchema['entities'] = []
  const visited = new Set<string>()

  function visit(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    for (const dep of dependsOn.get(name) ?? []) {
      visit(dep)
    }
    const entity = entities.find(e => e.name === name)
    if (entity) sorted.push(entity)
  }

  for (const entity of entities) {
    visit(entity.name)
  }
  return sorted
}

/**
 * Detects the auth entity (User or similar) from the schema.
 */
function findAuthEntity(schema: IntentSchema): IntentSchema['entities'][number] | undefined {
  if (schema.authType === 'none') return undefined
  return schema.entities.find(e => {
    const name = e.name.toLowerCase()
    return name === 'user' || name === 'account' || name === 'member'
  })
}

export class ApiTestGenerator {
  generate(
    schema: IntentSchema,
    architecture: ArchitectureData,
    relationships: Relationship[]
  ): ApiTestCollection {
    const hasAuth = schema.authType !== 'none'
    const authHeaders = buildAuthHeaders(hasAuth)
    const authEntity = findAuthEntity(schema)

    // Sort entities dependency-first
    const orderedEntities = sortEntitiesByDependency(schema.entities, relationships)

    const groups: ApiTestGroup[] = []

    // Auth group (register + login) — always first if auth is enabled
    if (authEntity && hasAuth) {
      const authGroup = this.buildAuthGroup(authEntity, schema)
      if (authGroup.requests.length > 0) {
        groups.push(authGroup)
      }
    }

    // CRUD groups per entity
    for (const entity of orderedEntities) {
      // Skip auth entity — already handled above
      if (entity === authEntity && hasAuth) continue

      const entityRoutes = architecture.routes.filter(r => r.service === entity.name)
      const group = this.buildEntityGroup(entity, entityRoutes, authHeaders)
      if (group.requests.length > 0) {
        groups.push(group)
      }
    }

    const collection: ApiTestCollection = {
      name: schema.projectName,
      baseUrl: '{{BASE_URL}}',
      groups
    }

    if (hasAuth) {
      collection.auth = {
        type: schema.authType,
        headerName: 'Authorization',
        tokenPlaceholder: '{{ACCESS_TOKEN}}'
      }
    }

    return collection
  }

  private buildAuthGroup(
    authEntity: IntentSchema['entities'][number],
    schema: IntentSchema
  ): ApiTestGroup {
    const requests: ApiTestRequest[] = []
    const entityLower = authEntity.name.toLowerCase()

    const registerBody = buildSampleBody(authEntity)
    // Auth endpoints typically live at /auth/register, /auth/login, or /{entity}/register
    requests.push({
      name: `Register (create ${authEntity.name})`,
      method: 'POST',
      path: `/api/v1/auth/register`,
      headers: { 'Content-Type': 'application/json' },
      body: registerBody,
      expectedStatus: 201
    })

    requests.push({
      name: 'Login',
      method: 'POST',
      path: `/api/v1/auth/login`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        username: registerBody['email'] ?? registerBody['username'] ?? 'user@example.com',
        password: registerBody['password'] ?? 'SecurePassword123!'
      },
      expectedStatus: 200
    })

    return { name: 'Authentication', requests }
  }

  private buildEntityGroup(
    entity: IntentSchema['entities'][number],
    routes: ArchRoute[],
    authHeaders: Record<string, string>
  ): ApiTestGroup {
    const requests: ApiTestRequest[] = []
    const entityLower = entity.name.toLowerCase()
    const basePath = `/api/v1/${entityLower}s`

    // Use routes from architecture if available, otherwise generate standard CRUD
    const usedPaths = new Set<string>()

    if (routes.length > 0) {
      for (const route of routes) {
        const key = `${route.method}:${route.path}`
        if (usedPaths.has(key)) continue
        usedPaths.add(key)

        const isCreate = route.method === 'POST' && !route.path.includes('{')
        const isList = route.method === 'GET' && !route.path.includes('{')
        const isGetOne = route.method === 'GET' && route.path.includes('{')
        const isUpdate = (route.method === 'PUT' || route.method === 'PATCH') && route.path.includes('{')
        const isDelete = route.method === 'DELETE' && route.path.includes('{')

        const req: ApiTestRequest = {
          name: this.generateRequestName(route.method, route.path, entity.name),
          method: route.method,
          path: `{{BASE_URL}}${route.path}`,
          headers: { ...authHeaders },
          expectedStatus: isCreate ? 201 : 200
        }

        if (isCreate || isUpdate) {
          req.body = buildSampleBody(entity)
        }

        requests.push(req)
      }
    } else {
      // Generate standard CRUD if no routes in architecture
      const endpoints = entity.endpoints ?? ['list', 'get', 'create', 'update', 'delete']

      if (endpoints.includes('create')) {
        requests.push({
          name: `Create ${entity.name}`,
          method: 'POST',
          path: `{{BASE_URL}}${basePath}`,
          headers: { ...authHeaders },
          body: buildSampleBody(entity),
          expectedStatus: 201
        })
      }
      if (endpoints.includes('list')) {
        requests.push({
          name: `List ${entity.name}s`,
          method: 'GET',
          path: `{{BASE_URL}}${basePath}`,
          headers: { ...authHeaders },
          expectedStatus: 200
        })
      }
      if (endpoints.includes('get')) {
        requests.push({
          name: `Get ${entity.name} by ID`,
          method: 'GET',
          path: `{{BASE_URL}}${basePath}/{{${entity.name.toUpperCase()}_ID}}`,
          headers: { ...authHeaders },
          expectedStatus: 200
        })
      }
      if (endpoints.includes('update')) {
        requests.push({
          name: `Update ${entity.name}`,
          method: 'PUT',
          path: `{{BASE_URL}}${basePath}/{{${entity.name.toUpperCase()}_ID}}`,
          headers: { ...authHeaders },
          body: buildSampleBody(entity),
          expectedStatus: 200
        })
      }
      if (endpoints.includes('delete')) {
        requests.push({
          name: `Delete ${entity.name}`,
          method: 'DELETE',
          path: `{{BASE_URL}}${basePath}/{{${entity.name.toUpperCase()}_ID}}`,
          headers: { ...authHeaders },
          expectedStatus: 204
        })
      }
    }

    return { name: entity.name, requests }
  }

  private generateRequestName(method: string, path: string, entityName: string): string {
    const hasId = path.includes('{')
    switch (method) {
      case 'GET': return hasId ? `Get ${entityName} by ID` : `List ${entityName}s`
      case 'POST': return `Create ${entityName}`
      case 'PUT': return `Update ${entityName} (full)`
      case 'PATCH': return `Update ${entityName} (partial)`
      case 'DELETE': return `Delete ${entityName}`
      default: return `${method} ${path}`
    }
  }
}
