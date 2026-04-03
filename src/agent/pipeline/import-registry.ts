/**
 * ImportRegistry — tracks public symbols for every generated file.
 *
 * After each file is written (template or LLM), call `register(path, content)`.
 * Before generating a file that depends on others, call `getAvailableImports(depPaths)`
 * to get an exact "from X import Y, Z" block ready to paste into the LLM prompt.
 *
 * Python files use the SymbolIndexer (python3 ast) for accurate extraction.
 * TypeScript files use SymbolIndexer regex + export-const detection.
 */

import { symbolIndexer } from '../rag/symbol-indexer'

interface SymbolRecord {
  /** Python-style module alias derived from the file path, e.g. "app.models.user" */
  moduleAlias: string
  /** Exported symbol names, e.g. ["User", "UserCreate", "UserUpdate"] */
  symbols: string[]
}

export class ImportRegistry {
  private readonly records = new Map<string, SymbolRecord>()

  /**
   * Parse `content` and record all public symbols for `filePath`.
   * Should be called immediately after a file is generated.
   */
  register(filePath: string, content: string): void {
    const symbols = extractPublicSymbols(filePath, content)
    if (symbols.length === 0) return

    const moduleAlias = pathToModuleAlias(filePath)
    this.records.set(filePath, { moduleAlias, symbols })
  }

  /**
   * Return a formatted import block for the given dependency file paths.
   * Only includes paths that have been registered (i.e. already generated).
   *
   * Example output:
   *   from app.models.user import User
   *   from app.schemas.user import UserBase, UserCreate, UserUpdate
   *   from app.services.user_service import create_user, get_user
   */
  getAvailableImports(depPaths: string[]): string {
    const lines: string[] = []
    for (const p of depPaths) {
      const rec = this.records.get(p)
      if (!rec || rec.symbols.length === 0) continue
      lines.push(`from ${rec.moduleAlias} import ${rec.symbols.join(', ')}`)
    }
    return lines.join('\n')
  }

  /**
   * Return all registered paths (useful for building the full import picture
   * when a file's dependency set is unknown at planning time).
   */
  getAllImports(): string {
    const lines: string[] = []
    for (const rec of this.records.values()) {
      if (rec.symbols.length === 0) continue
      lines.push(`from ${rec.moduleAlias} import ${rec.symbols.join(', ')}`)
    }
    return lines.join('\n')
  }

  has(filePath: string): boolean {
    return this.records.has(filePath)
  }

  size(): number {
    return this.records.size
  }
}

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------

/**
 * Extract public symbol names from file content.
 * Python: uses SymbolIndexer (python3 ast) — accurate, handles decorators/async.
 * TypeScript: uses SymbolIndexer regex + export-const detection.
 */
function extractPublicSymbols(filePath: string, content: string): string[] {
  const isPy = filePath.endsWith('.py')
  const isTs =
    filePath.endsWith('.ts') ||
    filePath.endsWith('.tsx') ||
    filePath.endsWith('.js') ||
    filePath.endsWith('.jsx')

  if (isPy) {
    // SymbolIndexer uses python3 ast for accurate extraction; falls back to regex on failure
    const names = symbolIndexer.extractPublicNames(content, filePath)

    // Also capture module-level instance assignments: settings = Settings()
    // These aren't functions/classes so ast misses them; add via regex
    for (const line of content.split('\n')) {
      const assignMatch = line.match(/^([a-z]\w*)\s*=\s*[A-Z]/)
      if (assignMatch && !assignMatch[1].startsWith('_') && !names.includes(assignMatch[1])) {
        names.push(assignMatch[1])
      }
    }

    return names
  }

  if (isTs) {
    const symbols = new Set<string>()

    // SymbolIndexer handles class and function declarations
    for (const sym of symbolIndexer.extractPublicNames(content, filePath)) {
      symbols.add(sym)
    }

    // Also capture: export const foo = ... / export const FooSchema = ...
    for (const line of content.split('\n')) {
      const constMatch = line.match(/^export\s+const\s+(\w+)\s*[=:]/)
      if (constMatch) symbols.add(constMatch[1])
    }

    return Array.from(symbols)
  }

  return []
}

/**
 * Convert a project-relative file path to a Python module alias.
 *
 * Examples:
 *   app/models/user.py           → app.models.user
 *   app/core/database.py         → app.core.database
 *   app/services/user_service.py → app.services.user_service
 *   main.py                      → main
 */
function pathToModuleAlias(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/\.py$/, '')
    .replace(/\.ts$/, '')
    .replace(/\.js$/, '')
    .replace(/\//g, '.')
}
