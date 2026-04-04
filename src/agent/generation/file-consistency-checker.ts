import type { GeneratedFile } from '../../types'
import { logger } from '../../logger'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsistencyCorrection {
  file: string
  type: 'import_removed' | 'router_removed' | 'init_fixed' | 'fk_removed' | 'backpopulates_fixed'
  detail: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract all `from app.models.<X> import ...` model names used in a file. */
function extractModelImports(content: string): string[] {
  const re = /from\s+app\.models\.(\w+)\s+import/g
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    names.push(m[1])
  }
  return names
}

/** Extract all `app.include_router(...)` router variable names from main.py. */
function extractIncludedRouters(content: string): string[] {
  const re = /app\.include_router\(\s*(\w+)/g
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    names.push(m[1])
  }
  return names
}

/** Extract all `from app.api.routes.<X> import <var>` pairs from main.py. */
function extractRouterImports(content: string): Array<{ module: string; varName: string }> {
  const re = /from\s+app\.api\.routes\.(\w+)\s+import\s+(\w+)/g
  const results: Array<{ module: string; varName: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    results.push({ module: m[1], varName: m[2] })
  }
  return results
}

/** Extract all ForeignKey table references: `ForeignKey("tablename.column")` */
function extractForeignKeys(content: string): string[] {
  const re = /ForeignKey\("(\w+)\.\w+"\)/g
  const tables: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    tables.push(m[1])
  }
  return tables
}

/**
 * Extract back_populates references: `back_populates="fieldname"`.
 * Returns the relationship field names referenced by back_populates.
 */
function extractBackPopulates(content: string): string[] {
  const re = /back_populates\s*=\s*"(\w+)"/g
  const refs: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    refs.push(m[1])
  }
  return refs
}

/** Remove lines matching a predicate, return modified content. */
function filterLines(content: string, shouldRemove: (line: string) => boolean): string {
  return content
    .split('\n')
    .filter(line => !shouldRemove(line))
    .join('\n')
}

// ─── Main checker ─────────────────────────────────────────────────────────────

/**
 * Check cross-file consistency of generated files and apply corrections.
 *
 * Checks:
 * 1. Import consistency — remove broken `from app.models.X import ...` lines
 * 2. Router registration — remove broken `app.include_router(...)` lines in main.py
 * 3. Model __init__.py — remove stale imports of missing model files
 * 4. FK targets — remove `ForeignKey("table.id")` lines referencing unknown tables
 * 5. back_populates — remove `back_populates="X"` when target relationship not found
 */
export function checkFileConsistency(
  inputFiles: GeneratedFile[]
): { files: GeneratedFile[]; corrections: ConsistencyCorrection[] } {
  const corrections: ConsistencyCorrection[] = []
  const fileMap = new Map<string, string>(inputFiles.map(f => [f.path, f.content]))

  // Build lookup sets
  const modelFiles = new Set<string>()       // e.g. "user", "post"
  const routeFiles = new Set<string>()        // e.g. "users", "posts"
  const tableNames = new Set<string>()        // e.g. "users", "posts"

  for (const [path] of fileMap) {
    const m = path.match(/^app\/models\/(\w+)\.py$/)
    if (m) modelFiles.add(m[1])

    const r = path.match(/^app\/api\/routes\/(\w+)\.py$/)
    if (r) routeFiles.add(r[1])
  }

  // Collect table names from model files (heuristic: look for `__tablename__ = "X"`)
  for (const [path, content] of fileMap) {
    if (!path.startsWith('app/models/') || path.includes('__init__')) continue
    const m = content.match(/__tablename__\s*=\s*["'](\w+)["']/)
    if (m) tableNames.add(m[1])
  }

  // ── 1. Import consistency in non-model files ──────────────────────────────
  for (const [path, content] of fileMap) {
    if (path.startsWith('app/models/')) continue
    const usedModels = extractModelImports(content)
    const broken = usedModels.filter(m => !modelFiles.has(m))
    if (broken.length === 0) continue

    const fixed = filterLines(content, line =>
      broken.some(m => line.includes(`from app.models.${m} import`))
    )
    fileMap.set(path, fixed)
    for (const m of broken) {
      corrections.push({ file: path, type: 'import_removed', detail: `Removed broken import: app.models.${m}` })
    }
  }

  // ── 2. Router registration in main.py ────────────────────────────────────
  const mainContent = fileMap.get('main.py')
  if (mainContent) {
    const routerImports = extractRouterImports(mainContent)
    const included = extractIncludedRouters(mainContent)

    // Check each imported router module exists
    const brokenModules = routerImports.filter(({ module }) => !routeFiles.has(module))
    if (brokenModules.length > 0) {
      const brokenVarNames = new Set(brokenModules.map(b => b.varName))
      const brokenModuleNames = new Set(brokenModules.map(b => b.module))

      let fixed = filterLines(mainContent, line =>
        brokenModules.some(({ module }) => line.includes(`from app.api.routes.${module} import`))
      )
      fixed = filterLines(fixed, line =>
        [...brokenVarNames].some(v =>
          new RegExp(`app\\.include_router\\(\\s*${v}`).test(line)
        )
      )
      fileMap.set('main.py', fixed)

      for (const { module } of brokenModules) {
        corrections.push({ file: 'main.py', type: 'router_removed', detail: `Removed broken router: app.api.routes.${module}` })
      }
    }
  }

  // ── 3. Model __init__.py ──────────────────────────────────────────────────
  const modelInitPath = 'app/models/__init__.py'
  const modelInit = fileMap.get(modelInitPath)
  if (modelInit) {
    const usedModels = extractModelImports(modelInit)
    const stale = usedModels.filter(m => !modelFiles.has(m))
    if (stale.length > 0) {
      const fixed = filterLines(modelInit, line =>
        stale.some(m => line.includes(`from app.models.${m} import`))
      )
      fileMap.set(modelInitPath, fixed)
      for (const m of stale) {
        corrections.push({ file: modelInitPath, type: 'init_fixed', detail: `Removed stale import: app.models.${m}` })
      }
    }
  }

  // ── 4. FK targets ─────────────────────────────────────────────────────────
  if (tableNames.size > 0) {
    for (const [path, content] of fileMap) {
      if (!path.endsWith('.py')) continue
      const usedTables = extractForeignKeys(content)
      const broken = usedTables.filter(t => !tableNames.has(t))
      if (broken.length === 0) continue

      const fixed = filterLines(content, line =>
        broken.some(t => line.includes(`ForeignKey("${t}.`))
      )
      fileMap.set(path, fixed)
      for (const t of broken) {
        corrections.push({ file: path, type: 'fk_removed', detail: `Removed broken ForeignKey to table "${t}"` })
      }
    }
  }

  // ── 5. back_populates ─────────────────────────────────────────────────────
  // Build a set of all relationship field names defined across all model files
  const definedRelationships = new Set<string>()
  for (const [path, content] of fileMap) {
    if (!path.startsWith('app/models/') || path.includes('__init__')) continue
    // Match: fieldname = relationship(...)
    const re = /^(\w+)\s*=\s*relationship\(/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      definedRelationships.add(m[1])
    }
  }

  if (definedRelationships.size > 0) {
    for (const [path, content] of fileMap) {
      if (!path.startsWith('app/models/') || path.includes('__init__')) continue
      const refs = extractBackPopulates(content)
      const broken = refs.filter(r => !definedRelationships.has(r))
      if (broken.length === 0) continue

      // Remove the back_populates= kwarg from the relationship() call
      let fixed = content
      for (const ref of broken) {
        // Remove `, back_populates="ref"` or `back_populates="ref",`
        fixed = fixed
          .replace(new RegExp(`,\\s*back_populates\\s*=\\s*"${ref}"`, 'g'), '')
          .replace(new RegExp(`back_populates\\s*=\\s*"${ref}"\\s*,?`, 'g'), '')
        corrections.push({ file: path, type: 'backpopulates_fixed', detail: `Removed invalid back_populates="${ref}"` })
      }
      fileMap.set(path, fixed)
    }
  }

  if (corrections.length > 0) {
    logger.info(
      'file-consistency-checker: applied %d correction(s)',
      corrections.length
    )
    for (const c of corrections) {
      logger.debug('  [%s] %s: %s', c.type, c.file, c.detail)
    }
  }

  // Rebuild files array with corrections applied
  const files = inputFiles.map(f => {
    const updated = fileMap.get(f.path)
    return updated !== undefined && updated !== f.content ? { ...f, content: updated } : f
  })

  return { files, corrections }
}
