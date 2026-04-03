/**
 * Parses raw output from Python validation tools into structured error objects.
 *
 * These functions are intentionally pure (no I/O) to make them easy to test.
 */

export interface ParsedError {
  file?: string
  line?: number
  col?: number
  code?: string
  message: string
  severity: 'error' | 'warning'
}

// ---------------------------------------------------------------------------
// py_compile output parser
// ---------------------------------------------------------------------------

/**
 * Parses the stderr emitted by `python3 -m py_compile <file>`.
 *
 * Typical format:
 *   File "/path/to/file.py", line 12
 *     bad code here
 *   SyntaxError: invalid syntax
 */
export function parseCompileErrors(output: string, filePath?: string): ParsedError[] {
  if (!output.trim()) return []

  const errors: ParsedError[] = []
  const lines = output.split('\n')

  let currentFile: string | undefined = filePath
  let currentLine: number | undefined

  for (const line of lines) {
    // "  File "/path/to/file.py", line 12"
    const fileLineMatch = line.match(/File "([^"]+)", line (\d+)/)
    if (fileLineMatch) {
      currentFile = filePath ?? fileLineMatch[1]
      currentLine = parseInt(fileLineMatch[2], 10)
      continue
    }

    // "SyntaxError: msg" / "IndentationError: msg" / "TabError: msg"
    const errMatch = line.match(/^(SyntaxError|IndentationError|TabError|ValueError):\s*(.+)$/)
    if (errMatch) {
      errors.push({
        file: currentFile,
        line: currentLine,
        code: 'E999',
        message: errMatch[2].trim(),
        severity: 'error'
      })
      currentLine = undefined
      continue
    }
  }

  // Fallback: unparsed but non-empty output → single error
  if (errors.length === 0 && output.trim()) {
    const lineMatch = output.match(/line (\d+)/)
    const msgLines = output.trim().split('\n')
    errors.push({
      file: currentFile,
      line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
      code: 'E999',
      message: msgLines[msgLines.length - 1]?.trim() ?? 'Syntax error',
      severity: 'error'
    })
  }

  return errors
}

// ---------------------------------------------------------------------------
// pyflakes output parser
// ---------------------------------------------------------------------------

/**
 * Parses stdout/stderr from `python3 -m pyflakes <path>`.
 *
 * Formats:
 *   filename.py:10:1: F821 undefined name 'foo'
 *   filename.py:10: message
 */
export function parsePyflakesErrors(output: string, filePath?: string): ParsedError[] {
  if (!output.trim()) return []

  const errors: ParsedError[] = []
  const lines = output.split('\n').filter(l => l.trim())

  for (const line of lines) {
    // pyflakes format: "path:line:col message" or "path:line message"
    // (no colon before the message — just a space)
    const match = line.match(/^([^:]+):(\d+)(?::(\d+))?\s+(.+)$/)
    if (match) {
      const rawMessage = match[4].trim()
      // "imported but unused" is a warning in non-__init__ files
      const isUnusedImport = rawMessage.includes('imported but unused')
      errors.push({
        file: filePath ?? match[1],
        line: parseInt(match[2], 10),
        col: match[3] ? parseInt(match[3], 10) : undefined,
        message: rawMessage,
        severity: isUnusedImport ? 'warning' : 'error'
      })
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Python traceback / stderr parser
// ---------------------------------------------------------------------------

/**
 * Parses Python traceback output from a runtime process (e.g. uvicorn stderr).
 *
 * Extracts the last frame from each traceback:
 *   Traceback (most recent call last):
 *     File "/path/to/file.py", line 23, in <module>
 *       some_call()
 *   ImportError: No module named 'foo'
 */
export function parseRuntimeErrors(stderr: string, filePath?: string): ParsedError[] {
  if (!stderr.trim()) return []

  const errors: ParsedError[] = []
  const lines = stderr.split('\n')

  let insideTraceback = false
  let lastFile: string | undefined = filePath
  let lastLine: number | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('Traceback (most recent call last):')) {
      insideTraceback = true
      continue
    }

    if (insideTraceback) {
      // "  File "/path.py", line N, in <scope>"
      const frameMatch = line.match(/^\s+File "([^"]+)", line (\d+),/)
      if (frameMatch) {
        lastFile = filePath ?? frameMatch[1]
        lastLine = parseInt(frameMatch[2], 10)
        continue
      }

      // Exception line — ends the traceback
      const excMatch = line.match(/^([A-Za-z][A-Za-z0-9_.]*Error|[A-Za-z][A-Za-z0-9_.]*Exception|SystemExit):\s*(.*)$/)
      if (excMatch) {
        errors.push({
          file: lastFile,
          line: lastLine,
          code: excMatch[1],
          message: `${excMatch[1]}: ${excMatch[2].trim() || '(no message)'}`,
          severity: 'error'
        })
        insideTraceback = false
        lastFile = filePath
        lastLine = undefined
        continue
      }

      // Bare exception (no colon message)
      const bareExcMatch = line.match(/^([A-Z][A-Za-z]+Error|[A-Z][A-Za-z]+Exception)$/)
      if (bareExcMatch) {
        errors.push({
          file: lastFile,
          line: lastLine,
          code: bareExcMatch[1],
          message: bareExcMatch[1],
          severity: 'error'
        })
        insideTraceback = false
        continue
      }
    }
  }

  // Non-traceback errors like "ERROR: ..." from uvicorn startup
  for (const line of lines) {
    if (/^(ERROR|CRITICAL):/i.test(line) && !errors.some(e => line.includes(e.message))) {
      errors.push({
        file: filePath,
        message: line.trim(),
        severity: 'error'
      })
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Error context enrichment
// ---------------------------------------------------------------------------

/**
 * Returns a snippet showing the error location with surrounding lines.
 *
 * Example output:
 *   Error in models.py line 42:
 *   SyntaxError: invalid syntax
 *
 *   LINE 40:   def create():
 *   LINE 41:       pass
 *   LINE 42:       bad syntax here  ← ERROR HERE
 *   LINE 43:
 *   LINE 44:   class User(Base):
 */
export function enrichErrorContext(error: ParsedError, fileContent: string): string {
  const header = `Error in ${error.file ?? 'unknown'} line ${error.line ?? '?'}:\n${error.message}`

  if (!error.line || !fileContent) return header

  const allLines = fileContent.split('\n')
  const errIdx = error.line - 1  // 0-based
  const start = Math.max(0, errIdx - 2)
  const end = Math.min(allLines.length - 1, errIdx + 2)

  const snippet = []
  for (let i = start; i <= end; i++) {
    const lineNum = i + 1
    const marker = i === errIdx ? '  ← ERROR HERE' : ''
    snippet.push(`  LINE ${lineNum}: ${allLines[i]}${marker}`)
  }

  return `${header}\n\n${snippet.join('\n')}`
}
