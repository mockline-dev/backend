import { logger } from '../../logger'
import type { GeneratedFile, PlanEntity, ProjectPlan } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeatureSummaryEntry {
  entity: string
  featuresApplied: string[]
  featuresSkipped: string[]
  filesModified: string[]
}

// ─── Name helpers ─────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

// ─── Recognized features ──────────────────────────────────────────────────────

const RECOGNIZED_FEATURES = new Set(['soft-delete', 'slug', 'search', 'filter'])

// ─── Individual transform functions ──────────────────────────────────────────

/**
 * Soft-delete: model — insert is_deleted column before timestamps.
 */
function applySoftDeleteModel(content: string): string {
  const marker = '    created_at: Mapped[Optional[datetime]]'
  if (!content.includes(marker)) return content
  const insertion = '    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)\n'
  return content.replace(marker, insertion + marker)
}

/**
 * Soft-delete: CRUD — replace `pass` with overrides that filter is_deleted=False
 * and set the flag on removal instead of hard-deleting.
 */
function applySoftDeleteCrud(content: string, entityName: string): string {
  const snake = toSnakeCase(entityName)
  if (!content.includes('    pass')) return content

  // Ensure imports exist at top — add them if needed
  let result = content
  if (!result.includes('from typing import')) {
    result = `from typing import List, Optional\n\nfrom sqlalchemy import select\nfrom sqlalchemy.orm import Session\n\n` + result
  } else {
    if (!result.includes('from sqlalchemy import select')) {
      result = result.replace(
        /^(from app\.crud\.base import CRUDBase)/m,
        `from sqlalchemy import select\nfrom sqlalchemy.orm import Session\n\n$1`
      )
    }
  }

  const overrides = `
    def get(self, db: Session, id: int) -> Optional[${entityName}]:  # type: ignore[override]
        from sqlalchemy import select
        return db.execute(
            select(${entityName}).where(
                ${entityName}.id == id,
                ${entityName}.is_deleted == False,  # noqa: E712
            )
        ).scalar_one_or_none()

    def get_multi(  # type: ignore[override]
        self, db: Session, *, skip: int = 0, limit: int = 100
    ) -> List[${entityName}]:
        from sqlalchemy import select
        return list(
            db.execute(
                select(${entityName})
                .where(${entityName}.is_deleted == False)  # noqa: E712
                .offset(skip)
                .limit(limit)
            ).scalars().all()
        )

    def remove(self, db: Session, *, id: int) -> Optional[${entityName}]:  # type: ignore[override]
        obj = self.get(db, id)
        if obj is not None:
            obj.is_deleted = True  # type: ignore[attr-defined]
            db.commit()
        return obj`

  result = result.replace('    pass', overrides)
  return result
}

/**
 * Slug: model — insert slug column (String, unique, index) before timestamps.
 */
function applySlugModel(content: string): string {
  const marker = '    created_at: Mapped[Optional[datetime]]'
  if (!content.includes(marker)) return content
  const insertion = '    slug: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True, nullable=True)\n'
  return content.replace(marker, insertion + marker)
}

/**
 * Slug: CRUD — add create override (slug generation) and get_by_slug method.
 */
function applySlugCrud(content: string, entityName: string): string {
  // Find the "title" or "name" field to derive the slug from.
  // We'll look for a pattern in the model — but since we work on CRUD content,
  // we just try title/name as common candidates at runtime.
  const slugMethods = `
    def create(self, db: Session, *, obj_in: ${entityName}Create) -> ${entityName}:  # type: ignore[override]
        import re
        obj_data = obj_in.model_dump(exclude_unset=False)
        title_val = (
            obj_data.get("title") or obj_data.get("name") or
            obj_data.get("${toSnakeCase(entityName)}_name") or ""
        )
        if title_val and not obj_data.get("slug"):
            slug = re.sub(r"[^\\w\\s-]", "", str(title_val).lower())
            slug = re.sub(r"[-\\s]+", "-", slug).strip("-")
            obj_data["slug"] = slug
        db_obj = ${entityName}(**obj_data)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_slug(self, db: Session, *, slug: str) -> Optional[${entityName}]:
        from sqlalchemy import select
        return db.execute(
            select(${entityName}).where(${entityName}.slug == slug)  # type: ignore[attr-defined]
        ).scalar_one_or_none()`

  // Append before the module-level instance line
  const instanceLine = `\ncrud_${toSnakeCase(entityName)} = CRUD${entityName}(${entityName})`
  if (!content.includes(instanceLine)) return content

  // Ensure Optional is in the typing import
  let result = content
  if (!result.includes('from typing import')) {
    result = `from typing import Optional\n\n` + result
  }

  return result.replace(instanceLine, slugMethods + instanceLine)
}

/**
 * Slug: route — append a GET /by-slug/{slug} endpoint.
 */
function applySlugRoute(content: string, entityName: string): string {
  const snake = toSnakeCase(entityName)
  const endpoint = `

@router.get("/by-slug/{slug}", response_model=${entityName}Response)
def get_${snake}_by_slug(
    slug: str,
    db: Session = Depends(get_db),
) -> ${entityName}Response:
    item = crud_${snake}.get_by_slug(db, slug=slug)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${entityName} not found")
    return item  # type: ignore[return-value]
`
  return content + endpoint
}

/**
 * Search: CRUD — add search() method.
 */
function applySearchCrud(content: string, entityName: string, textFields: string[]): string {
  if (textFields.length === 0) return content

  const fieldFilters = textFields
    .map(f => `            ${entityName}.${f}.ilike(f"%{q}%"),  # type: ignore[attr-defined]`)
    .join('\n')

  const searchMethod = `
    def search(
        self, db: Session, *, q: str, skip: int = 0, limit: int = 100
    ) -> List[${entityName}]:
        from sqlalchemy import or_, select
        filters = [
${fieldFilters}
        ]
        return list(
            db.execute(
                select(${entityName}).where(or_(*filters)).offset(skip).limit(limit)
            ).scalars().all()
        )`

  const instanceLine = `\ncrud_${toSnakeCase(entityName)} = CRUD${entityName}(${entityName})`
  if (!content.includes(instanceLine)) return content

  // Ensure List, Optional imports
  let result = content
  if (!result.includes('from typing import')) {
    result = `from typing import List, Optional\n\n` + result
  }

  return result.replace(instanceLine, searchMethod + instanceLine)
}

/**
 * Search: route — add optional `q` query param to the list endpoint.
 */
function applySearchRoute(content: string, entityName: string): string {
  const snake = toSnakeCase(entityName)

  // Add Query to fastapi imports
  let result = content
  if (!result.includes('Query') && result.includes('from fastapi import')) {
    result = result.replace(
      /from fastapi import (.*)/,
      'from fastapi import $1, Query'
    )
  }

  // Add `q` parameter to the list function signature
  result = result.replace(
    `def list_${snake}s(\n    skip: int = 0,\n    limit: int = 100,\n    db: Session = Depends(get_db),`,
    `def list_${snake}s(\n    skip: int = 0,\n    limit: int = 100,\n    q: Optional[str] = Query(None, description="Search query"),\n    db: Session = Depends(get_db),`
  )

  // Add Optional to typing imports if needed
  if (!result.includes('Optional') && result.includes('from typing import')) {
    result = result.replace(
      /from typing import (List)([,\s])/,
      'from typing import List, Optional$2'
    )
  }

  // Change the return statement to use search when q is provided
  const oldReturn = `    return crud_${snake}.get_multi(db, skip=skip, limit=limit)  # type: ignore[return-value]`
  const newReturn = `    if q:\n        return crud_${snake}.search(db, q=q, skip=skip, limit=limit)  # type: ignore[return-value]\n    return crud_${snake}.get_multi(db, skip=skip, limit=limit)  # type: ignore[return-value]`
  result = result.replace(oldReturn, newReturn)

  return result
}

// ─── Feature dispatcher ───────────────────────────────────────────────────────

/**
 * Apply all recognized features for a single entity to the relevant generated files.
 * Mutates nothing — returns a new map of path → content for modified files.
 */
function applyFeaturesForEntity(
  entity: PlanEntity,
  fileMap: Map<string, string>
): { modified: Map<string, string>; applied: string[]; skipped: string[] } {
  const snake = toSnakeCase(entity.name)
  const modelPath = `app/models/${snake}.py`
  const crudPath = `app/crud/${snake}.py`
  const routePath = `app/api/routes/${snake}.py`

  const modified = new Map<string, string>()
  const applied: string[] = []
  const skipped: string[] = []

  // Determine which features to apply — softDelete comes from the bool flag + features array
  const features = new Set<string>(entity.features)
  if (entity.softDelete) features.add('soft-delete')

  for (const feature of features) {
    if (!RECOGNIZED_FEATURES.has(feature)) {
      skipped.push(feature)
      continue
    }

    try {
      switch (feature) {
        case 'soft-delete': {
          const model = modified.get(modelPath) ?? fileMap.get(modelPath)
          const crud = modified.get(crudPath) ?? fileMap.get(crudPath)
          if (model) modified.set(modelPath, applySoftDeleteModel(model))
          if (crud) modified.set(crudPath, applySoftDeleteCrud(crud, entity.name))
          applied.push(feature)
          break
        }
        case 'slug': {
          const model = modified.get(modelPath) ?? fileMap.get(modelPath)
          const crud = modified.get(crudPath) ?? fileMap.get(crudPath)
          const route = modified.get(routePath) ?? fileMap.get(routePath)
          if (model) modified.set(modelPath, applySlugModel(model))
          if (crud) modified.set(crudPath, applySlugCrud(crud, entity.name))
          if (route) modified.set(routePath, applySlugRoute(route, entity.name))
          applied.push(feature)
          break
        }
        case 'search': {
          // Find text/string fields for ILIKE search
          const textFields = entity.fields
            .filter(f => !f.reference && (f.type === 'string' || f.type === 'text' || f.type === 'email'))
            .map(f => f.name)

          if (textFields.length === 0) {
            logger.debug(
              'feature-applicator: entity "%s" has search feature but no string/text fields — skipping',
              entity.name
            )
            skipped.push(feature)
            break
          }

          const crud = modified.get(crudPath) ?? fileMap.get(crudPath)
          const route = modified.get(routePath) ?? fileMap.get(routePath)
          if (crud) modified.set(crudPath, applySearchCrud(crud, entity.name, textFields))
          if (route) modified.set(routePath, applySearchRoute(route, entity.name))
          applied.push(feature)
          break
        }
        case 'filter': {
          // Filter is a subset of search — just log as acknowledged, skip for now
          // (a full filter implementation would add per-field query params)
          logger.debug(
            'feature-applicator: entity "%s" filter feature acknowledged — skip (use search instead)',
            entity.name
          )
          skipped.push(feature)
          break
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(
        'feature-applicator: entity "%s" feature "%s" transform failed (%s) — keeping original',
        entity.name,
        feature,
        msg
      )
      skipped.push(feature)
    }
  }

  return { modified, applied, skipped }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Post-processes template-rendered files to apply deterministic feature enhancements.
 *
 * Features driven by entity.softDelete and entity.features (e.g. 'slug', 'search').
 * If no entity has any recognized feature, files are returned unchanged.
 *
 * Safety: every transform is wrapped in try/catch — failures keep the original file.
 */
export function applyFeatures(
  plan: ProjectPlan,
  files: GeneratedFile[]
): { files: GeneratedFile[]; summary: FeatureSummaryEntry[] } {
  // Build mutable map for efficient lookups/updates
  const fileMap = new Map<string, string>(files.map(f => [f.path, f.content]))
  const allModified = new Map<string, string>()
  const summary: FeatureSummaryEntry[] = []

  for (const entity of plan.entities) {
    const hasFeatures = entity.softDelete || entity.features.length > 0
    if (!hasFeatures) {
      logger.debug(
        'feature-applicator: entity "%s" — no features, using standard CRUD',
        entity.name
      )
      continue
    }

    const { modified, applied, skipped } = applyFeaturesForEntity(entity, fileMap)

    if (applied.length > 0) {
      // Merge modified files back into the shared map for subsequent entities
      for (const [path, content] of modified) {
        fileMap.set(path, content)
        allModified.set(path, content)
      }

      const filesModified = [...modified.keys()]
      logger.info(
        'feature-applicator: entity "%s" — applied [%s], modified %d files',
        entity.name,
        applied.join(', '),
        filesModified.length
      )
      summary.push({ entity: entity.name, featuresApplied: applied, featuresSkipped: skipped, filesModified })
    } else if (skipped.length > 0) {
      logger.debug(
        'feature-applicator: entity "%s" — all features skipped: [%s]',
        entity.name,
        skipped.join(', ')
      )
    }
  }

  if (allModified.size === 0) {
    return { files, summary }
  }

  // Rebuild GeneratedFile[] with modified content
  const updatedFiles = files.map(f => {
    const newContent = allModified.get(f.path)
    if (newContent !== undefined) {
      return { ...f, content: newContent }
    }
    return f
  })

  return { files: updatedFiles, summary }
}
