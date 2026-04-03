import type { PlanEntity, PlanRelationship, PlanEndpoint } from '../../types'
import type { ChatMessage, OllamaClient } from '../../llm/client'
import { getModelConfig } from '../../llm/client'
import { structuredLLMCall } from '../../llm/structured-output'
import { logger } from '../../logger'

import { EndpointsSchema } from './schemas'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

function summariseEntities(entities: PlanEntity[]): string {
  return entities.map(e => `- ${e.name} (table: ${e.tableName})`).join('\n')
}

function summariseRelationships(relationships: PlanRelationship[]): string {
  if (relationships.length === 0) return 'None'
  return relationships.map(r => `- ${r.from} ${r.type} ${r.to}`).join('\n')
}

// ─── Planner ──────────────────────────────────────────────────────────────────

/**
 * Plans REST API endpoints for all entities.
 *
 * Post-processing ensures:
 * - Standard CRUD endpoints exist for each entity
 * - Auth endpoints (login/register) exist when authRequired
 * - No duplicate paths
 */
export async function planAPIContracts(
  client: OllamaClient,
  entities: PlanEntity[],
  relationships: PlanRelationship[],
  authRequired: boolean
): Promise<PlanEndpoint[]> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an API designer. Output ONLY a JSON object with this EXACT structure:\n' +
        '{"endpoints": [{"path": "/items", "methods": ["GET", "POST"], "auth": {"GET": false, "POST": true}, "description": "..."}]}\n' +
        'Rules:\n' +
        '- "path": URL path string (use {id} for path params)\n' +
        '- "methods": array of HTTP methods (GET, POST, PUT, PATCH, DELETE)\n' +
        '- "auth": object mapping each method to boolean (true = auth required)\n' +
        '- "description": short string\n' +
        (authRequired ? 'Include POST /auth/login and POST /auth/register endpoints.\n' : '') +
        'Return only the {"endpoints": [...]} wrapper object.',
    },
    {
      role: 'user',
      content:
        `Entities:\n${summariseEntities(entities)}\n\n` +
        `Relationships:\n${summariseRelationships(relationships)}\n\n` +
        `Plan REST API endpoints for all entities with CRUD operations.`,
    },
  ]

  const modelCfg = getModelConfig('planning')
  const result = await structuredLLMCall(client, EndpointsSchema, messages, {
    model: modelCfg.name,
    temperature: modelCfg.temperature,
    think: modelCfg.think,
  })

  const endpoints: PlanEndpoint[] = [...result.endpoints]
  const paths = new Set(result.endpoints.map(e => e.path))

  // ── Ensure standard CRUD for each entity ────────────────────────────────────
  for (const entity of entities) {
    const base = `/${toSnakeCase(entity.name)}s`

    if (!paths.has(base)) {
      endpoints.push({
        path: base,
        methods: ['GET', 'POST'],
        auth: { GET: false, POST: authRequired },
        description: `List and create ${entity.name} records`,
      })
      paths.add(base)
    }

    const detail = `${base}/{id}`
    if (!paths.has(detail)) {
      endpoints.push({
        path: detail,
        methods: ['GET', 'PUT', 'DELETE'],
        auth: { GET: false, PUT: authRequired, DELETE: authRequired },
        description: `Retrieve, update, or delete a single ${entity.name}`,
      })
      paths.add(detail)
    }
  }

  // ── Ensure auth endpoints ────────────────────────────────────────────────────
  if (authRequired) {
    if (!paths.has('/auth/login')) {
      endpoints.push({
        path: '/auth/login',
        methods: ['POST'],
        auth: { POST: false },
        description: 'Authenticate and receive JWT token',
      })
      paths.add('/auth/login')
    }
    if (!paths.has('/auth/register')) {
      endpoints.push({
        path: '/auth/register',
        methods: ['POST'],
        auth: { POST: false },
        description: 'Register a new user account',
      })
      paths.add('/auth/register')
    }
  }

  // ── Remove duplicates (keep first occurrence) ────────────────────────────────
  const seen = new Set<string>()
  return endpoints.filter(ep => {
    if (seen.has(ep.path)) {
      logger.warn('planAPIContracts: duplicate path "%s" dropped', ep.path)
      return false
    }
    seen.add(ep.path)
    return true
  })
}
