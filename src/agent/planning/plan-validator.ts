import type { ProjectPlan } from '../../types'

// ─── Result type ──────────────────────────────────────────────────────────────

export interface PlanValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ─── Entity coverage ──────────────────────────────────────────────────────────

// Words that appear in features but are never entity names
const COVERAGE_STOP_WORDS = new Set([
  'auth', 'authentication', 'authorization', 'management', 'system',
  'basic', 'simple', 'full', 'crud', 'data', 'support', 'feature',
  'api', 'rest', 'admin', 'access', 'control', 'with', 'and', 'the',
  'for', 'can', 'will', 'have', 'that', 'this', 'from', 'into',
  'based', 'using', 'each', 'list', 'view', 'edit', 'delete', 'create',
  'update', 'read', 'search', 'filter', 'sort', 'page', 'track',
])

/**
 * Checks whether entities cover the domain concepts mentioned in the feature list.
 * Returns advisory warning strings (not hard errors).
 */
export function checkEntityCoverage(features: string[], entityNames: string[]): string[] {
  const warnings: string[] = []
  const entityNamesLower = new Set(entityNames.map(n => n.toLowerCase()))

  for (const feature of features) {
    const words = feature
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !COVERAGE_STOP_WORDS.has(w))

    for (const word of words) {
      // Match singular and plural (strip trailing 's' or 'es')
      const singular = word.endsWith('es') ? word.slice(0, -2) : word.endsWith('s') ? word.slice(0, -1) : word
      if (!entityNamesLower.has(word) && !entityNamesLower.has(singular)) {
        warnings.push(`Feature "${feature}" mentions "${word}" but no matching entity found — consider adding it`)
        break // one warning per feature to avoid noise
      }
    }
  }

  return warnings
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Pure-code validation of a completed ProjectPlan — no LLM calls.
 *
 * Checks:
 * - At least one entity defined
 * - Entity names are unique
 * - Each entity has at least one user-facing field
 * - Field names are unique within each entity
 * - All field references resolve to known entities
 * - All relationship from/to entities exist
 * - Auth endpoints present when authRequired
 * - No direct circular FK chains (A references B, B references A)
 */
export function validatePlan(plan: ProjectPlan): PlanValidationResult {
  const errors: string[] = []

  if (plan.entities.length === 0) {
    errors.push('Plan must define at least one entity')
  }

  const entityNameSet = new Set<string>()
  for (const entity of plan.entities) {
    if (entityNameSet.has(entity.name)) {
      errors.push(`Duplicate entity name: "${entity.name}"`)
    }
    entityNameSet.add(entity.name)
  }

  const systemFields = new Set(['id', 'created_at', 'updated_at', 'deleted_at'])

  for (const entity of plan.entities) {
    const userFields = entity.fields.filter(f => !systemFields.has(f.name))
    if (userFields.length === 0) {
      errors.push(`Entity "${entity.name}" has no user-facing fields (only system columns)`)
    }

    const fieldNameSet = new Set<string>()
    for (const field of entity.fields) {
      if (fieldNameSet.has(field.name)) {
        errors.push(`Entity "${entity.name}" has duplicate field name: "${field.name}"`)
      }
      fieldNameSet.add(field.name)

      if (field.reference && !entityNameSet.has(field.reference.entity)) {
        errors.push(
          `Entity "${entity.name}" field "${field.name}" references unknown entity ` +
          `"${field.reference.entity}"`
        )
      }
    }
  }

  // ── Relationships ─────────────────────────────────────────────────────────

  for (const rel of plan.relationships) {
    if (!entityNameSet.has(rel.from)) {
      errors.push(`Relationship references unknown entity "${rel.from}"`)
    }
    if (!entityNameSet.has(rel.to)) {
      errors.push(`Relationship references unknown entity "${rel.to}"`)
    }
  }

  // ── Auth endpoints ────────────────────────────────────────────────────────

  if (plan.authRequired) {
    const paths = plan.endpoints.map(e => e.path)
    const hasLogin = paths.some(p => p === '/auth/login' || p.endsWith('/auth/login'))
    const hasRegister = paths.some(p => p === '/auth/register' || p.endsWith('/auth/register'))
    if (!hasLogin) {
      errors.push('authRequired=true but no /auth/login endpoint defined')
    }
    if (!hasRegister) {
      errors.push('authRequired=true but no /auth/register endpoint defined')
    }
  }

  // ── Circular FK chains (direct: A references B, B references A) ───────────

  const refGraph = new Map<string, Set<string>>()
  for (const entity of plan.entities) {
    const deps = new Set<string>()
    for (const field of entity.fields) {
      if (field.reference) {
        deps.add(field.reference.entity)
      }
    }
    refGraph.set(entity.name, deps)
  }

  for (const [name, deps] of refGraph) {
    for (const dep of deps) {
      const depDeps = refGraph.get(dep)
      if (depDeps?.has(name)) {
        // Report only once per pair (lexicographic order)
        if (name < dep) {
          errors.push(`Circular foreign key chain detected: "${name}" ↔ "${dep}"`)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings: checkEntityCoverage(plan.features, plan.entities.map(e => e.name)) }
}
