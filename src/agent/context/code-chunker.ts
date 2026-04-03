// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeChunk {
  id: string
  filepath: string
  content: string
  startLine: number
  endLine: number
  type: 'imports' | 'function' | 'class' | 'module-level'
  name: string
  metadata: Record<string, string | number>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CHUNK_SIZE = 1500
const MIN_CHUNK_CHARS = 20
const MERGE_THRESHOLD = 100
const OVERLAP_CHARS = 200

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChunk(
  filepath: string,
  content: string,
  startLine: number,
  endLine: number,
  type: CodeChunk['type'],
  name: string
): CodeChunk {
  return {
    id: `${filepath}::${startLine}`,
    filepath,
    content,
    startLine,
    endLine,
    type,
    name,
    metadata: { filepath, startLine, endLine, name, type }
  }
}

function mergeTinyChunks(chunks: CodeChunk[]): CodeChunk[] {
  if (chunks.length === 0) return []
  const result: CodeChunk[] = []
  let current = chunks[0]

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]
    if (current.content.trim().length < MERGE_THRESHOLD) {
      current = {
        ...current,
        content: current.content + '\n\n' + next.content,
        endLine: next.endLine,
        metadata: { ...current.metadata, endLine: next.endLine }
      }
    } else {
      result.push(current)
      current = next
    }
  }
  result.push(current)
  return result
}

function splitLongFunction(
  filepath: string,
  content: string,
  lineOffset: number,
  name: string,
  maxSize: number
): CodeChunk[] {
  const chunks: CodeChunk[] = []
  const parts = content.split(/\n{2,}/)
  let buffer = ''
  let bufferStartLine = lineOffset

  let currentLine = lineOffset
  for (const part of parts) {
    const partLines = part.split('\n').length
    const candidate = buffer ? buffer + '\n\n' + part : part

    if (candidate.length > maxSize && buffer.trim().length >= MIN_CHUNK_CHARS) {
      chunks.push(
        makeChunk(filepath, buffer.trim(), bufferStartLine + 1, currentLine, 'function', name)
      )
      // Start new buffer with overlap
      const overlap = buffer.slice(-OVERLAP_CHARS)
      buffer = overlap + '\n\n' + part
      bufferStartLine = currentLine - overlap.split('\n').length
    } else {
      buffer = candidate
    }
    currentLine += partLines + 2
  }

  if (buffer.trim().length >= MIN_CHUNK_CHARS) {
    chunks.push(
      makeChunk(
        filepath,
        buffer.trim(),
        bufferStartLine + 1,
        lineOffset + content.split('\n').length - 1,
        'function',
        name
      )
    )
  }

  return chunks.length > 0
    ? chunks
    : [
        makeChunk(
          filepath,
          content,
          lineOffset + 1,
          lineOffset + content.split('\n').length - 1,
          'function',
          name
        )
      ]
}

function splitClassIntoMethods(
  filepath: string,
  lines: string[],
  classStart: number,
  classEnd: number,
  className: string,
  maxSize: number
): CodeChunk[] {
  const result: CodeChunk[] = []

  // Find method boundaries (4-space or tab indented def/async def)
  interface MethodBoundary {
    line: number
    name: string
    decoratorStart: number
  }
  const methods: MethodBoundary[] = []
  let pendingDecorator = -1

  for (let i = classStart + 1; i <= classEnd; i++) {
    const line = lines[i] ?? ''
    const methodMatch = line.match(/^(?:    |\t)(?:async\s+)?def\s+(\w+)/)
    const decoratorMatch = line.match(/^(?:    |\t)@/)
    const blankLine = !line.trim()

    if (decoratorMatch && pendingDecorator === -1) {
      pendingDecorator = i
    } else if (methodMatch) {
      methods.push({
        line: i,
        name: methodMatch[1],
        decoratorStart: pendingDecorator >= 0 ? pendingDecorator : i
      })
      pendingDecorator = -1
    } else if (blankLine) {
      // blank lines don't reset pending decorator
    } else {
      pendingDecorator = -1
    }
  }

  if (methods.length === 0) {
    const text = lines.slice(classStart, classEnd + 1).join('\n').trimEnd()
    return [makeChunk(filepath, text, classStart + 1, classEnd + 1, 'class', className)]
  }

  // Class header (from classStart up to first method decorator)
  const headerEnd = methods[0].decoratorStart - 1
  const headerText = lines.slice(classStart, headerEnd + 1).join('\n').trimEnd()
  if (headerText.trim().length >= MIN_CHUNK_CHARS) {
    result.push(makeChunk(filepath, headerText, classStart + 1, headerEnd + 1, 'class', className))
  }

  // Each method
  for (let i = 0; i < methods.length; i++) {
    const method = methods[i]
    const nextMethod = methods[i + 1]
    const endLine = nextMethod ? nextMethod.decoratorStart - 1 : classEnd

    const text = lines.slice(method.decoratorStart, endLine + 1).join('\n').trimEnd()
    if (text.trim().length >= MIN_CHUNK_CHARS) {
      result.push(
        makeChunk(filepath, text, method.decoratorStart + 1, endLine + 1, 'function', method.name)
      )
    }
  }

  return result
}

function splitByDoubleNewlines(filepath: string, content: string): CodeChunk[] {
  const blocks = content.split(/\n{2,}/)
  const chunks: CodeChunk[] = []
  let lineOffset = 0

  for (const block of blocks) {
    const trimmed = block.trim()
    const blockLines = block.split('\n').length
    if (trimmed.length >= MIN_CHUNK_CHARS) {
      chunks.push(
        makeChunk(filepath, trimmed, lineOffset + 1, lineOffset + blockLines, 'module-level', 'module')
      )
    }
    lineOffset += blockLines + 2
  }
  return chunks
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Chunks a Python file into semantic code units using regex-based parsing.
 * No tree-sitter dependency.
 */
export function chunkPythonFile(
  filepath: string,
  content: string,
  maxChunkSize = DEFAULT_MAX_CHUNK_SIZE
): CodeChunk[] {
  if (!content.trim()) return []

  const lines = content.split('\n')
  const n = lines.length
  const chunks: CodeChunk[] = []

  // ── Step 1: Find imports block ──────────────────────────────────────────────
  // Consecutive import/from lines at top; blank lines and comments are skipped
  let importsEnd = -1
  for (let i = 0; i < n; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      importsEnd = i
    } else if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    } else {
      break
    }
  }

  if (importsEnd >= 0) {
    const text = lines.slice(0, importsEnd + 1).join('\n').trim()
    if (text.length >= MIN_CHUNK_CHARS) {
      chunks.push(makeChunk(filepath, text, 1, importsEnd + 1, 'imports', 'imports'))
    }
  }

  // ── Step 2: Find top-level def/class blocks ─────────────────────────────────
  interface TopLevelBlock {
    decoratorStart: number
    defLine: number
    kind: 'function' | 'class'
    name: string
  }

  const blocks: TopLevelBlock[] = []
  let pendingDecoratorStart = -1

  for (let i = 0; i < n; i++) {
    const line = lines[i]

    // Skip indented and blank lines
    if (!line || line[0] === ' ' || line[0] === '\t') {
      if (!line || !line.trim()) pendingDecoratorStart = -1
      continue
    }

    const trimmed = line.trim()

    if (trimmed.startsWith('@')) {
      if (pendingDecoratorStart === -1) pendingDecoratorStart = i
      continue
    }

    const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)/)
    const classMatch = trimmed.match(/^class\s+(\w+)/)

    if (funcMatch) {
      blocks.push({
        decoratorStart: pendingDecoratorStart >= 0 ? pendingDecoratorStart : i,
        defLine: i,
        kind: 'function',
        name: funcMatch[1]
      })
    } else if (classMatch) {
      blocks.push({
        decoratorStart: pendingDecoratorStart >= 0 ? pendingDecoratorStart : i,
        defLine: i,
        kind: 'class',
        name: classMatch[1]
      })
    }

    pendingDecoratorStart = -1
  }

  // Track which lines are covered by imports/blocks
  const coveredLines = new Set<number>()
  if (importsEnd >= 0) {
    for (let i = 0; i <= importsEnd; i++) coveredLines.add(i)
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const nextBlock = blocks[i + 1]
    const endLine = nextBlock ? nextBlock.decoratorStart - 1 : n - 1

    for (let j = block.decoratorStart; j <= endLine; j++) coveredLines.add(j)

    const text = lines.slice(block.decoratorStart, endLine + 1).join('\n').trimEnd()
    if (text.trim().length < MIN_CHUNK_CHARS) continue

    if (text.length <= maxChunkSize) {
      chunks.push(
        makeChunk(filepath, text, block.decoratorStart + 1, endLine + 1, block.kind, block.name)
      )
    } else if (block.kind === 'function') {
      chunks.push(...splitLongFunction(filepath, text, block.decoratorStart, block.name, maxChunkSize))
    } else {
      chunks.push(...splitClassIntoMethods(filepath, lines, block.decoratorStart, endLine, block.name, maxChunkSize))
    }
  }

  // ── Step 3: Module-level code ────────────────────────────────────────────────
  const moduleChunks: CodeChunk[] = []
  let moduleStart = -1

  for (let i = 0; i <= n; i++) {
    const covered = i === n || coveredLines.has(i)
    if (!covered && moduleStart === -1) {
      moduleStart = i
    } else if (covered && moduleStart >= 0) {
      const text = lines.slice(moduleStart, i).join('\n').trim()
      if (text.length >= MIN_CHUNK_CHARS) {
        moduleChunks.push(makeChunk(filepath, text, moduleStart + 1, i, 'module-level', 'module'))
      }
      moduleStart = -1
    }
  }

  chunks.push(...mergeTinyChunks(moduleChunks))

  // Sort by startLine and filter tiny chunks
  chunks.sort((a, b) => a.startLine - b.startLine)
  return chunks.filter(c => c.content.trim().length >= MIN_CHUNK_CHARS)
}

/**
 * Chunks any file — Python files get semantic chunking, others split by double newlines.
 */
export function chunkFile(
  filepath: string,
  content: string,
  maxChunkSize = DEFAULT_MAX_CHUNK_SIZE
): CodeChunk[] {
  if (filepath.endsWith('.py')) {
    return chunkPythonFile(filepath, content, maxChunkSize)
  }
  return splitByDoubleNewlines(filepath, content)
}
