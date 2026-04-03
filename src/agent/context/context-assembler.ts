import type { TreeSitterIndexer, CodeIndex } from './tree-sitter-indexer'
import type { ChromaClient } from './chroma-client'

// ─── Constants ────────────────────────────────────────────────────────────────

/** ~6K tokens ≈ 24K chars (GPT-4 tokeniser averages ~4 chars/token) */
const MAX_CONTEXT_CHARS = 24_000

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCodeIndex(index: CodeIndex): string {
  const parts: string[] = [`# Symbols in ${index.filepath}`]

  if (index.imports.length > 0) {
    parts.push('\n## Imports')
    for (const imp of index.imports) {
      if (imp.names.length > 0) {
        parts.push(`from ${imp.module} import ${imp.names.join(', ')} (line ${imp.line})`)
      } else {
        parts.push(`import ${imp.module} (line ${imp.line})`)
      }
    }
  }

  if (index.classes.length > 0) {
    parts.push('\n## Classes')
    for (const cls of index.classes) {
      const bases = cls.bases.length > 0 ? `(${cls.bases.join(', ')})` : ''
      parts.push(`class ${cls.name}${bases} — line ${cls.line}`)
      for (const method of cls.methods) {
        parts.push(`  def ${method.name}(${method.params.join(', ')}) — line ${method.line}`)
      }
    }
  }

  if (index.functions.length > 0) {
    parts.push('\n## Functions')
    for (const fn of index.functions) {
      const ret = fn.returnType ? ` -> ${fn.returnType}` : ''
      parts.push(`def ${fn.name}(${fn.params.join(', ')})${ret} — line ${fn.line}`)
      if (fn.docstring) parts.push(`  """${fn.docstring.split('\n')[0]}"""`)
    }
  }

  return parts.join('\n')
}

// ─── assembleContext ──────────────────────────────────────────────────────────

/**
 * Builds an optimal context string for an LLM call about targetFile.
 *
 * Priority order (highest first):
 *   1. Symbols for targetFile + its direct import dependencies
 *   2. Semantic search results from ChromaDB (if available)
 *   3. Plan info (caller must include separately)
 *
 * Total output is capped at MAX_CONTEXT_CHARS (~6K tokens).
 */
export async function assembleContext(
  projectId: string,
  targetFile: string,
  purpose: string,
  indexer: TreeSitterIndexer,
  chromaClient: ChromaClient | null
): Promise<string> {
  const sections: string[] = []
  let remaining = MAX_CONTEXT_CHARS

  // ── 1. Target file symbols ─────────────────────────────────────────────────
  const targetIndex = await indexer.getSymbols(projectId, targetFile)
  if (targetIndex) {
    const text = formatCodeIndex(targetIndex)
    if (text.length <= remaining) {
      sections.push(text)
      remaining -= text.length
    }
  }

  // ── 2. Direct dependency symbols ──────────────────────────────────────────
  if (targetIndex && remaining > 500) {
    for (const imp of targetIndex.imports.slice(0, 10)) {
      if (remaining <= 500) break

      // Try to map module name to file path (e.g. "app.models.user" → "app/models/user.py")
      const candidatePath = imp.module.replace(/\./g, '/') + '.py'
      const depIndex = await indexer.getSymbols(projectId, candidatePath)
      if (depIndex) {
        const text = formatCodeIndex(depIndex)
        const allowed = Math.min(text.length, remaining - 100)
        if (allowed > 200) {
          sections.push(text.slice(0, allowed))
          remaining -= allowed
        }
      }
    }
  }

  // ── 3. Semantic search (ChromaDB) ──────────────────────────────────────────
  if (chromaClient && remaining > 500 && purpose.trim()) {
    const results = await chromaClient.search(projectId, purpose, 3)
    if (results.length > 0) {
      sections.push('\n## Semantically relevant code')
      for (const r of results) {
        if (remaining <= 200) break
        const snippet = `### ${r.filepath}\n${r.content.slice(0, Math.min(r.content.length, remaining - 100))}`
        sections.push(snippet)
        remaining -= snippet.length
      }
    }
  }

  return sections.join('\n\n').slice(0, MAX_CONTEXT_CHARS)
}
