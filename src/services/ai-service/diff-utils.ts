/**
 * Utilities for applying SEARCH/REPLACE diff blocks to file content.
 * Used by the ai-stream service to apply AI-suggested file modifications.
 */

export interface Hunk {
  startLine: number
  endLine: number
  oldContent: string
  newContent: string
}

export interface ApplyResult {
  newContent: string
  hunks: Hunk[]
  unapplied: string[]
}

const SEARCH_REPLACE_PATTERN =
  /<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*REPLACE/g

/**
 * Applies all SEARCH/REPLACE blocks found in `diffText` to `originalContent`.
 *
 * For each block:
 * 1. Tries an exact string match first.
 * 2. Falls back to whitespace-normalised matching (ignores leading/trailing spaces per line).
 *
 * Returns the modified content, the list of applied hunks, and any blocks that
 * could not be matched (unapplied).
 */
export function applySearchReplace(originalContent: string, diffText: string): ApplyResult {
  const hunks: Hunk[] = []
  const unapplied: string[] = []
  let current = originalContent

  const pattern = new RegExp(SEARCH_REPLACE_PATTERN.source, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(diffText)) !== null) {
    const searchText = match[1]
    const replaceText = match[2]

    // Attempt exact match first
    const exactIdx = current.indexOf(searchText)
    if (exactIdx !== -1) {
      const before = current.substring(0, exactIdx)
      const startLine = before.split('\n').length
      const endLine = startLine + searchText.split('\n').length - 1
      hunks.push({ startLine, endLine, oldContent: searchText, newContent: replaceText })
      current = before + replaceText + current.substring(exactIdx + searchText.length)
      continue
    }

    // Fuzzy fallback: normalise whitespace per line and try to match
    const normalised = fuzzyMatch(current, searchText)
    if (normalised !== null) {
      const { start, end, matchedText } = normalised
      const before = current.substring(0, start)
      const startLine = before.split('\n').length
      const endLine = startLine + matchedText.split('\n').length - 1
      hunks.push({ startLine, endLine, oldContent: matchedText, newContent: replaceText })
      current = before + replaceText + current.substring(end)
      continue
    }

    unapplied.push(searchText)
  }

  return { newContent: current, hunks, unapplied }
}

/**
 * Attempts a whitespace-normalised match of `searchText` within `content`.
 * Normalises each line by trimming trailing whitespace and collapsing repeated spaces.
 * Returns start/end byte offsets of the matched region in `content`, or null on failure.
 */
function fuzzyMatch(
  content: string,
  searchText: string
): { start: number; end: number; matchedText: string } | null {
  const normalise = (line: string) => line.replace(/[ \t]+/g, ' ').trimEnd()

  const searchLines = searchText.split('\n').map(normalise)
  const contentLines = content.split('\n')

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidate = contentLines.slice(i, i + searchLines.length)
    if (candidate.map(normalise).join('\n') === searchLines.join('\n')) {
      // Reconstruct byte offsets
      const start = contentLines
        .slice(0, i)
        .reduce((acc, l) => acc + l.length + 1, 0)
      const matchedText = candidate.join('\n')
      const end = start + matchedText.length
      return { start, end, matchedText }
    }
  }

  return null
}
