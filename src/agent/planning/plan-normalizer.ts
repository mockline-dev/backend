import { logger } from '../../logger'
import { PlanningError } from './planning-pipeline'
import type { PlanEndpoint, PlanEntity, PlanField, PlanRelationship, ProjectPlan } from '../../types'
import type { LLMEntity, LLMProjectPlan, LLMRelationship } from './single-call-planner'

// ─── Python reserved words ────────────────────────────────────────────────────

const PYTHON_RESERVED = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'type', 'while', 'with', 'yield',
  // Common builtins / SQLAlchemy conflicts
  'id', 'list', 'dict', 'set', 'tuple', 'filter', 'map', 'object',
])

/** SQLAlchemy / FastAPI class names that conflict with entity names */
const SQLALCHEMY_CONFLICTS = new Set([
  'Model', 'Base', 'Session', 'Column', 'Table', 'Query',
  'Integer', 'String', 'Boolean', 'Float', 'DateTime', 'Text',
  'Relationship', 'Metadata', 'Engine', 'Connection', 'Transaction',
  'Index', 'Schema', 'Request', 'Response', 'Router',
])

const MAX_NAME_LEN = 60

// ─── Name sanitizers ─────────────────────────────────────────────────────────

/** Ensure name is a valid Python identifier: starts with letter, only [a-zA-Z0-9_] */
function sanitizePythonIdentifier(name: string): string {
  // Replace non-alphanumeric/underscore chars with _
  let safe = name.replace(/[^a-zA-Z0-9_]/g, '_')
  // Must start with a letter
  if (!/^[a-zA-Z]/.test(safe)) safe = 'f_' + safe
  return safe
}

function sanitizeEntityName(name: string): string {
  let safe = toPascalCase(name.slice(0, MAX_NAME_LEN))
  safe = sanitizePythonIdentifier(safe)
  if (SQLALCHEMY_CONFLICTS.has(safe)) safe = safe + 'Entity'
  return safe
}

function sanitizeFieldName(name: string): string {
  let safe = toSnakeCase(name.slice(0, MAX_NAME_LEN))
  safe = sanitizePythonIdentifier(safe)
  if (PYTHON_RESERVED.has(safe)) safe = safe + '_field'
  return safe
}



/** Aliases the LLM might output → canonical type name */
const TYPE_ALIASES: Record<string, string> = {
  // → string
  str: 'string', varchar: 'string', char: 'string', text_short: 'string',
  // → text
  longtext: 'text', content: 'text', body: 'text',
  // → integer
  int: 'integer', number: 'integer', bigint: 'integer', smallint: 'integer',
  // → float
  double: 'float', real: 'float',
  // → decimal
  numeric: 'decimal',
  // → boolean
  bool: 'boolean', flag: 'boolean',
  // → datetime
  timestamp: 'datetime', time: 'datetime',
  // → email
  mail: 'email',
  // → uuid
  guid: 'uuid',
  // → json
  jsonb: 'json', object: 'json', dict: 'json', array: 'json', list: 'json',
}

/** Types the sqlalchemyType/pydanticType helpers in template-engine.ts support */
const KNOWN_TYPES = new Set([
  'string', 'text', 'integer', 'float', 'decimal', 'boolean',
  'date', 'datetime', 'email', 'uuid', 'json', 'password',
])

function normalizeType(raw: string): string {
  const lower = raw.toLowerCase().trim()
  const aliased = TYPE_ALIASES[lower] ?? lower
  return KNOWN_TYPES.has(aliased) ? aliased : 'string'
}

// ─── Name normalization ───────────────────────────────────────────────────────

function toPascalCase(s: string): string {
  return s
    .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, c => c.toUpperCase())
}

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase()
}

/** Best-effort snake_case pluralization (append 's' like existing templates do) */
function toSnakePlural(s: string): string {
  const snake = toSnakeCase(s)
  return snake.endsWith('s') ? snake : snake + 's'
}

// ─── Relationship converter ───────────────────────────────────────────────────

/**
 * Convert per-entity embedded relationships into the top-level PlanRelationship[]
 * format, inject FK fields, and deduplicate.
 *
 * The LLM is instructed to declare relationships from the "many" (FK-owning) side
 * using "many-to-one". We handle "one-to-many" defensively as well.
 */
function convertRelationships(
  entities: PlanEntity[],
  llmEntities: LLMEntity[]
): PlanRelationship[] {
  const entityMap = new Map(entities.map(e => [e.name, e]))
  const entityNames = new Set(entities.map(e => e.name))
  const relationships: PlanRelationship[] = []

  // Dedup key: canonical_from__canonical_to__type
  const seen = new Set<string>()

  for (const llmEntity of llmEntities) {
    const entityName = toPascalCase(llmEntity.name)
    const entity = entityMap.get(entityName)
    if (!entity) continue

    for (const rel of llmEntity.relationships) {
      const targetName = toPascalCase(rel.target)
      if (!entityNames.has(targetName)) {
        logger.warn(
          'plan-normalizer: relationship from "%s" to unknown entity "%s" — skipped',
          entityName,
          rel.target
        )
        continue
      }

      let canonicalFrom: string
      let canonicalTo: string
      let canonicalType: 'one-to-one' | 'one-to-many' | 'many-to-many'
      let foreignKey: string
      let junctionTable: string | undefined

      switch (rel.type) {
        case 'many-to-one': {
          // entity OWNS FK → target
          // canonical: from=target, to=entity, type=one-to-many, fk={fieldName}_id on entity
          canonicalFrom = targetName
          canonicalTo = entityName
          canonicalType = 'one-to-many'
          foreignKey = `${toSnakeCase(rel.fieldName)}_id`
          break
        }
        case 'one-to-many': {
          // entity has CHILDREN → target (target owns the FK)
          // canonical: from=entity, to=target, type=one-to-many, fk={backref}_id on target
          canonicalFrom = entityName
          canonicalTo = targetName
          canonicalType = 'one-to-many'
          foreignKey = `${toSnakeCase(rel.backref)}_id`
          break
        }
        case 'one-to-one': {
          // entity OWNS FK → target
          // canonical: from=target, to=entity, type=one-to-one, fk={fieldName}_id on entity
          canonicalFrom = targetName
          canonicalTo = entityName
          canonicalType = 'one-to-one'
          foreignKey = `${toSnakeCase(rel.fieldName)}_id`
          break
        }
        case 'many-to-many': {
          // Skip self-referential M2M (templates can't handle it cleanly)
          if (entityName === targetName) {
            logger.warn(
              'plan-normalizer: self-referential many-to-many on "%s" — skipped',
              entityName
            )
            continue
          }
          // Alphabetical order for canonical from/to
          const [a, b] = [entityName, targetName].sort()
          canonicalFrom = a
          canonicalTo = b
          canonicalType = 'many-to-many'
          foreignKey = `${toSnakeCase(a)}_id`
          junctionTable = `${toSnakePlural(a)}_${toSnakePlural(b)}`
          break
        }
      }

      const dedupKey = `${canonicalFrom}::${canonicalTo}::${canonicalType}`
      if (seen.has(dedupKey)) {
        logger.debug('plan-normalizer: duplicate relationship "%s" — skipped', dedupKey)
        continue
      }
      seen.add(dedupKey)

      // Inject FK field into the "to" entity (for one-to-many and one-to-one)
      if (canonicalType !== 'many-to-many') {
        const toEntity = entityMap.get(canonicalTo)
        if (toEntity) {
          const alreadyHasFK = toEntity.fields.some(f => f.name === foreignKey)
          if (!alreadyHasFK) {
            toEntity.fields.push({
              name: foreignKey,
              type: 'integer',
              required: false,
              unique: false,
              reference: { entity: canonicalFrom, field: 'id' },
            })
            logger.debug(
              'plan-normalizer: injected FK field "%s" into entity "%s"',
              foreignKey,
              canonicalTo
            )
          }
        }
      }

      relationships.push({
        from: canonicalFrom,
        to: canonicalTo,
        type: canonicalType,
        foreignKey,
        ...(junctionTable !== undefined ? { junctionTable } : {}),
      })
    }
  }

  return relationships
}

// ─── Topological sort ─────────────────────────────────────────────────────────

/**
 * Sort entities so that parent entities (referenced by FK) come before children.
 * Falls back to original order if a cycle is detected.
 */
function topologicalSort(entities: PlanEntity[]): PlanEntity[] {
  const nameToEntity = new Map(entities.map(e => [e.name, e]))
  const deps = new Map<string, Set<string>>()

  for (const entity of entities) {
    const d = new Set<string>()
    for (const field of entity.fields) {
      if (field.reference && field.reference.entity !== entity.name) {
        d.add(field.reference.entity)
      }
    }
    deps.set(entity.name, d)
  }

  const sorted: PlanEntity[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(name: string): boolean {
    if (visiting.has(name)) return false // cycle — skip
    if (visited.has(name)) return true
    visiting.add(name)
    for (const dep of deps.get(name) ?? []) {
      if (!visit(dep)) {
        logger.warn('plan-normalizer: cycle detected involving "%s" — using original order', name)
        visiting.delete(name)
        return false
      }
    }
    visiting.delete(name)
    visited.add(name)
    const e = nameToEntity.get(name)
    if (e) sorted.push(e)
    return true
  }

  for (const entity of entities) {
    if (!visited.has(entity.name)) visit(entity.name)
  }

  // If cycle prevented full sort, append remaining entities in original order
  for (const entity of entities) {
    if (!visited.has(entity.name)) sorted.push(entity)
  }

  return sorted
}

// ─── Auth normalization ───────────────────────────────────────────────────────

const AUTH_KEYWORD_RE = /\b(auth|login|logout|register|authentication|sign[-\s]?in|sign[-\s]?up|password|jwt|token|user\s+management)\b/i

/**
 * Ensure the User entity has the required auth fields when authRequired is true.
 * Adds email and hashed_password fields if missing.
 */
function normalizeUserEntity(entity: PlanEntity): void {
  const fieldNames = new Set(entity.fields.map(f => f.name))

  if (!fieldNames.has('email')) {
    entity.fields.unshift({
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
    })
  }

  if (!fieldNames.has('hashed_password')) {
    entity.fields.push({
      name: 'hashed_password',
      type: 'string',
      required: true,
      unique: false,
    })
  }
}

// ─── Endpoint generation ──────────────────────────────────────────────────────

function generateEndpoints(entities: PlanEntity[], authRequired: boolean): PlanEndpoint[] {
  const endpoints: PlanEndpoint[] = []

  for (const entity of entities) {
    const base = `/${toSnakePlural(entity.name)}`
    endpoints.push(
      { path: base, methods: ['GET', 'POST'], auth: { GET: false, POST: authRequired }, description: `List and create ${entity.name}` },
      { path: `${base}/{id}`, methods: ['GET', 'PUT', 'DELETE'], auth: { GET: false, PUT: authRequired, DELETE: authRequired }, description: `Get, update, or delete ${entity.name}` }
    )
  }

  if (authRequired) {
    endpoints.push(
      { path: '/auth/register', methods: ['POST'], auth: { POST: false }, description: 'Register new user' },
      { path: '/auth/login', methods: ['POST'], auth: { POST: false }, description: 'Login and receive JWT' },
      { path: '/auth/me', methods: ['GET'], auth: { GET: true }, description: 'Get current user' }
    )
  }

  return endpoints
}

// ─── Main normalizer ──────────────────────────────────────────────────────────

/**
 * Converts the raw LLM plan into a fully normalized ProjectPlan:
 * - Normalizes field types to canonical names
 * - Converts embedded per-entity relationships → top-level PlanRelationship[]
 * - Injects FK fields into the "many" side entities
 * - Topologically sorts entities (parents before children)
 * - Adds missing auth fields to User entity when authRequired
 * - Detects auth keywords in description as a fallback
 * - Generates standard CRUD endpoints deterministically
 */
export function normalizePlan(llmPlan: LLMProjectPlan, userPrompt?: string): ProjectPlan {
  // ── 0. Guard: empty entities ─────────────────────────────────────────────
  if (!llmPlan.entities || llmPlan.entities.length === 0) {
    throw new PlanningError(
      'Your project description did not produce any data models. Try rephrasing with specific entities like "users", "products", or "orders".',
      ['No entities in LLM plan']
    )
  }

  // ── 1. Normalize entity names and field types ────────────────────────────
  const rawEntities: PlanEntity[] = llmPlan.entities.map(e => {
    const entityName = sanitizeEntityName(e.name)
    const tableName = e.tableName || toSnakePlural(entityName)

    let fields: PlanField[] = e.fields.map(f => ({
      name: sanitizeFieldName(f.name),
      type: normalizeType(f.type),
      required: !f.nullable,
      unique: f.unique,
      ...(f.default !== null ? { default: f.default } : {}),
    }))

    // Guard: entity with no user fields — add a default 'name' field
    const hasUserField = fields.some(f => f.name !== 'id' && !f.name.endsWith('_id'))
    if (fields.length === 0 || !hasUserField) {
      logger.warn('plan-normalizer: entity "%s" has no user fields — adding default "name" field', entityName)
      fields = [{ name: 'name', type: 'string', required: true, unique: false }, ...fields]
    }

    return {
      name: entityName,
      tableName,
      fields,
      timestamps: true,
      softDelete: e.features.includes('soft-delete'),
      features: e.features,
    }
  })

  // ── 1b. Deduplicate entities (merge by normalized name) ───────────────────
  const entityMap = new Map<string, PlanEntity>()
  for (const entity of rawEntities) {
    const existing = entityMap.get(entity.name)
    if (existing) {
      logger.warn('plan-normalizer: duplicate entity "%s" — merging fields', entity.name)
      const existingFieldNames = new Set(existing.fields.map(f => f.name))
      for (const field of entity.fields) {
        if (!existingFieldNames.has(field.name)) {
          existing.fields.push(field)
        }
      }
    } else {
      entityMap.set(entity.name, entity)
    }
  }
  const entities = [...entityMap.values()]

  // ── 1c. Warn on large plans ───────────────────────────────────────────────
  if (entities.length > 15) {
    logger.info(
      'plan-normalizer: plan has %d entities — generation may take longer than usual',
      entities.length
    )
  }

  // ── 2. Auth override (keyword detection in user prompt) ──────────────────
  let authRequired = llmPlan.auth.required
  if (!authRequired && userPrompt && AUTH_KEYWORD_RE.test(userPrompt)) {
    logger.warn('plan-normalizer: prompt contains auth keywords but LLM returned required=false — overriding')
    authRequired = true
  }

  // ── 3. Ensure User entity exists when auth is required ──────────────────
  if (authRequired) {
    const userEntity = entities.find(e => e.name.toLowerCase() === 'user')
    if (!userEntity) {
      logger.warn('plan-normalizer: authRequired=true but no User entity — adding one')
      entities.unshift({
        name: 'User',
        tableName: 'users',
        fields: [
          { name: 'email', type: 'email', required: true, unique: true },
          { name: 'hashed_password', type: 'string', required: true, unique: false },
          { name: 'is_active', type: 'boolean', required: true, unique: false, default: 'true' },
        ],
        timestamps: true,
        softDelete: false,
        features: [],
      })
    } else {
      normalizeUserEntity(userEntity)
    }
  }

  // ── 4. Convert embedded relationships → top-level array + inject FKs ────
  const relationships = convertRelationships(entities, llmPlan.entities)

  // ── 5. Topological sort ──────────────────────────────────────────────────
  const sortedEntities = topologicalSort(entities)

  // ── 6. Generate endpoints deterministically ──────────────────────────────
  const endpoints = generateEndpoints(sortedEntities, authRequired)

  logger.info(
    'plan-normalizer: normalized plan "%s" — %d entities, %d relationships, %d endpoints',
    llmPlan.projectName,
    sortedEntities.length,
    relationships.length,
    endpoints.length
  )

  return {
    projectName: llmPlan.projectName,
    description: llmPlan.description,
    features: llmPlan.features,
    entities: sortedEntities,
    relationships,
    endpoints,
    authRequired,
    externalPackages: [],
  }
}
