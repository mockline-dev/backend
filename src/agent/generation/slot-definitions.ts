import type { PlanEntity, PlanField, ProjectPlan } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeSlot {
  /** Unique identifier for this slot */
  id: string
  /** Entity this slot belongs to */
  entityName: string
  /** The unrecognized feature string from the plan */
  feature: string
  /** Target file path (relative to project root) */
  filePath: string
  /** Human-readable description of what to generate */
  description: string
  /** Surrounding code context (existing class, imports) */
  contextCode: string
  /** Model fields as a readable summary for the prompt */
  modelSummary: string
  /** The base code already in the file (before enhancement) */
  existingCode: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Features handled deterministically — no LLM slot needed */
const DETERMINISTIC_FEATURES = new Set(['soft-delete', 'slug', 'search', 'filter'])

/** Maximum total slots per project generation (single-GPU constraint) */
export const MAX_SLOTS_PER_PROJECT = 10

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

function summarizeFields(fields: PlanField[]): string {
  return fields
    .filter(f => !f.reference)
    .map(f => `  ${f.name}: ${f.type}${f.required ? '' : '?'}${f.unique ? ' (unique)' : ''}`)
    .join('\n')
}

function buildModelSummary(entity: PlanEntity): string {
  const lines = [`class ${entity.name}(Base):`, `  id: int (PK, auto)`]
  for (const field of entity.fields) {
    if (field.reference) {
      lines.push(`  ${field.name}: int (FK→${field.reference.entity}.id)`)
    } else {
      lines.push(`  ${field.name}: ${field.type}${field.required ? '' : '?'}`)
    }
  }
  if (entity.timestamps) {
    lines.push(`  created_at: datetime?`, `  updated_at: datetime?`)
  }
  if (entity.softDelete) {
    lines.push(`  is_deleted: bool (default=False)`)
  }
  return lines.join('\n')
}

/** Convert a feature string to a plain-English description of what to implement */
function featureToDescription(feature: string, entityName: string): string {
  const normalized = feature.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
  return `Implement "${normalized}" functionality for the ${entityName} entity as CRUD methods on the CRUD${entityName} class.`
}

/** Build the CRUD file stub context that the LLM will extend */
function buildCrudContext(entity: PlanEntity, existingCrudContent: string): string {
  const snake = toSnakeCase(entity.name)
  return `# Existing CRUD class for ${entity.name}
# File: app/crud/${snake}.py
# The class currently has these imports and may already have custom methods:
${existingCrudContent}

# The class inherits from CRUDBase which provides:
#   get(db, id) -> Optional[${entity.name}]
#   get_multi(db, *, skip, limit) -> List[${entity.name}]
#   create(db, *, obj_in) -> ${entity.name}
#   update(db, *, db_obj, obj_in) -> ${entity.name}
#   remove(db, *, id) -> Optional[${entity.name}]`
}

// ─── Slot builder ─────────────────────────────────────────────────────────────

/**
 * Builds LLM code slots from the plan's entities.
 *
 * Only entities with UNRECOGNIZED features get slots — recognized features
 * (soft-delete, slug, search, filter) are handled deterministically.
 *
 * Capped at MAX_SLOTS_PER_PROJECT (10) to keep generation time reasonable.
 */
export function buildSlotsForPlan(
  plan: ProjectPlan,
  /** Map of file path → current (post-template) content */
  fileContents: Map<string, string>
): CodeSlot[] {
  const slots: CodeSlot[] = []

  for (const entity of plan.entities) {
    const customFeatures = entity.features.filter(f => !DETERMINISTIC_FEATURES.has(f))
    if (customFeatures.length === 0) continue

    const snake = toSnakeCase(entity.name)
    const crudPath = `app/crud/${snake}.py`
    const existingCrud = fileContents.get(crudPath) ?? ''

    for (const feature of customFeatures) {
      if (slots.length >= MAX_SLOTS_PER_PROJECT) break

      slots.push({
        id: `${snake}_crud_${feature.replace(/[^a-z0-9]/gi, '_')}_${slots.length}`,
        entityName: entity.name,
        feature,
        filePath: crudPath,
        description: featureToDescription(feature, entity.name),
        contextCode: buildCrudContext(entity, existingCrud),
        modelSummary: buildModelSummary(entity),
        existingCode: existingCrud,
      })
    }

    if (slots.length >= MAX_SLOTS_PER_PROJECT) break
  }

  return slots
}
