import { logger } from '../../logger'

export interface ApplyResult {
  success: boolean
  result: string
  error?: string
}

/**
 * Apply an exact search/replace to file content.
 *
 * Matching order:
 *   1. Exact substring match
 *   2. Normalised line endings (CRLF → LF)
 *   3. Fuzzy per-line whitespace normalisation (trim trailing, collapse runs)
 *
 * When the search text appears more than once, the FIRST occurrence is
 * replaced and a warning is logged.
 *
 * @param content  Full current file content
 * @param search   Block of text to find (must be an exact substring)
 * @param replace  Replacement text
 */
export function applySearchReplace(
  content: string,
  search: string,
  replace: string
): ApplyResult {
  if (!search) {
    return { success: false, result: content, error: 'Search text must not be empty' }
  }

  // ── Pass 1: exact match ────────────────────────────────────────────────────
  const exactIdx = content.indexOf(search)
  if (exactIdx !== -1) {
    if (content.indexOf(search, exactIdx + 1) !== -1) {
      logger.warn('applySearchReplace: search text appears multiple times — replacing first occurrence')
    }
    return {
      success: true,
      result:
        content.substring(0, exactIdx) +
        replace +
        content.substring(exactIdx + search.length)
    }
  }

  // ── Pass 2: normalise line endings ─────────────────────────────────────────
  const normalContent = content.replace(/\r\n/g, '\n')
  const normalSearch = search.replace(/\r\n/g, '\n').trim()
  const normIdx = normalContent.indexOf(normalSearch)
  if (normIdx !== -1) {
    return {
      success: true,
      result:
        normalContent.substring(0, normIdx) +
        replace +
        normalContent.substring(normIdx + normalSearch.length)
    }
  }

  // ── Pass 3: fuzzy per-line whitespace normalisation ────────────────────────
  const squash = (line: string) => line.replace(/[ \t]+/g, ' ').trimEnd()
  const searchLines = normalSearch.split('\n').map(squash)
  const contentLines = normalContent.split('\n')

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidate = contentLines.slice(i, i + searchLines.length)
    if (candidate.map(squash).join('\n') === searchLines.join('\n')) {
      const before = contentLines.slice(0, i).join('\n')
      const after = contentLines.slice(i + searchLines.length).join('\n')
      const joined =
        (before ? before + '\n' : '') + replace + (after ? '\n' + after : '')
      return { success: true, result: joined }
    }
  }

  return {
    success: false,
    result: content,
    error: 'Search block not found in file. Read the file first to see its exact content.'
  }
}
