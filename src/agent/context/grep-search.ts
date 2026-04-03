// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  filepath: string
  content: string
  score: number
  source: 'chromadb' | 'grep'
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'in', 'is', 'it', 'to', 'of', 'for',
  'with', 'that', 'this', 'be', 'are', 'was', 'has', 'have', 'not', 'as'
])

const SNIPPET_RADIUS = 15

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractSnippet(content: string, keywords: string[]): string {
  const lines = content.split('\n')
  const lowerLines = lines.map(l => l.toLowerCase())

  let bestLine = 0
  let bestScore = 0

  for (let i = 0; i < lines.length; i++) {
    let score = 0
    for (const kw of keywords) {
      if (lowerLines[i].includes(kw)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestLine = i
    }
  }

  const start = Math.max(0, bestLine - SNIPPET_RADIUS)
  const end = Math.min(lines.length - 1, bestLine + SNIPPET_RADIUS)
  return lines.slice(start, end + 1).join('\n')
}

// ─── grepSearch ───────────────────────────────────────────────────────────────

/**
 * Keyword-based fallback search over an in-memory file map.
 *
 * Scoring:
 *   +1  per keyword occurrence in content
 *   +3  per function/class name match (via def/class keyword)
 *   +5  if keyword appears in the filename
 *
 * Returns top `limit` results with ±15-line snippets.
 */
export function grepSearch(
  files: Map<string, string>,
  query: string,
  limit = 5
): SearchResult[] {
  const keywords = tokenize(query)
  if (keywords.length === 0) return []

  const scored: Array<{ filepath: string; score: number }> = []

  for (const [filepath, content] of files) {
    const lowerContent = content.toLowerCase()
    const lowerFilepath = filepath.toLowerCase()

    let score = 0

    for (const keyword of keywords) {
      // Count all occurrences in file content
      let idx = 0
      while ((idx = lowerContent.indexOf(keyword, idx)) !== -1) {
        score++
        idx++
      }

      // 3x bonus for function/class name matches
      const defPattern = new RegExp(`def\\s+${escapeRegex(keyword)}\\s*\\(`, 'gi')
      const classPattern = new RegExp(`class\\s+${escapeRegex(keyword)}\\s*[:(]`, 'gi')

      const defMatches = content.match(defPattern)
      if (defMatches) score += defMatches.length * 3

      const classMatches = content.match(classPattern)
      if (classMatches) score += classMatches.length * 3

      // 5 bonus for filename match
      if (lowerFilepath.includes(keyword)) score += 5
    }

    if (score > 0) {
      scored.push({ filepath, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map(({ filepath, score }) => {
    const content = files.get(filepath) ?? ''
    return {
      filepath,
      content: extractSnippet(content, keywords),
      score,
      source: 'grep' as const
    }
  })
}
