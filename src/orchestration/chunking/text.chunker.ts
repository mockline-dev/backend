import * as path from 'path'
import { countTokens } from '../prompt/token-counter'
import type { CodeChunk } from '../types'

const DEFAULT_MAX_TOKENS = 300
const OVERLAP_LINES = 3

export function chunkText(content: string, filepath: string, maxTokens = DEFAULT_MAX_TOKENS): CodeChunk[] {
  if (!content.trim()) return []

  const lines = content.split('\n')
  const chunks: CodeChunk[] = []
  let chunkIndex = 0
  let i = 0

  while (i < lines.length) {
    const chunkLines: string[] = []
    let tokenCount = 0
    const startLine = i

    while (i < lines.length && tokenCount < maxTokens) {
      const line = lines[i]
      const lineTokens = countTokens(line + '\n')
      tokenCount += lineTokens
      chunkLines.push(line)
      i++
    }

    if (chunkLines.length === 0) break

    const chunkContent = chunkLines.join('\n')
    const endLine = startLine + chunkLines.length - 1

    chunks.push({
      id: `${filepath}:chunk:${chunkIndex}`,
      filepath,
      content: chunkContent,
      startLine,
      endLine,
      symbolKind: 'block',
      symbolName: path.basename(filepath)
    })

    chunkIndex++

    // Overlap: step back OVERLAP_LINES for context continuity
    if (i < lines.length) {
      i = Math.max(startLine + 1, i - OVERLAP_LINES)
    }
  }

  return chunks
}
