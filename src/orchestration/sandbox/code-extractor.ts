import type { SandboxFile } from './types'

// Language-to-extension map for filename fallback
const LANG_EXT: Record<string, string> = {
  typescript: 'ts',
  ts: 'ts',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  sh: 'sh',
  bash: 'sh'
}

// File path comment patterns (checked in order):
// 1. After the fence language tag:    ```ts // filepath: src/foo.ts
// 2. First line comment Python style: # src/foo.py
// 3. First line comment C-style:      // src/foo.ts
// 4. FeathersJS / AI agent style:     // File: src/foo.ts
const FILE_PATH_IN_FENCE = /^[a-z]*\s+(?:\/\/\s*(?:filepath:|file:)?\s*(\S+\.\w+)|#\s*(\S+\.\w+))/i
const FILE_PATH_FIRST_LINE_COMMENT = /^(?:\/\/\s*(?:filepath:|file:)?\s*|#\s*)(\S+\.\w+)/

/**
 * Extract fenced code blocks from LLM markdown output and return them as SandboxFile objects.
 *
 * Supported path hint locations:
 *   ```ts // filepath: src/index.ts
 *   ```typescript // src/index.ts
 *   ```python\n# src/main.py
 *   ```js\n// src/utils.js
 */
export function extractCodeBlocks(markdown: string): SandboxFile[] {
  const files: SandboxFile[] = []
  // Match fenced blocks: ```<lang?> <rest-of-line?>\n<content>\n```
  const fenceRegex = /^```([^\n`]*)\n([\s\S]*?)^```/gm
  let match: RegExpExecArray | null
  let fallbackIndex = 0

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const fenceLine = match[1].trim() // e.g. "ts // filepath: src/index.ts"
    const body = match[2]

    if (!body.trim()) continue

    // Determine language and optional path from the fence line
    let language = ''
    let filePath: string | null = null

    const fenceMatch = FILE_PATH_IN_FENCE.exec(fenceLine)
    if (fenceMatch) {
      language = fenceLine.split(/\s+/)[0].toLowerCase()
      filePath = fenceMatch[1] ?? fenceMatch[2] ?? null
    } else {
      // Fence line only contains the language tag
      language = fenceLine.split(/\s+/)[0].toLowerCase()
    }

    // If no path in fence, check first line of the body for a path comment
    if (!filePath) {
      const firstLine = body.split('\n')[0]
      const lineMatch = FILE_PATH_FIRST_LINE_COMMENT.exec(firstLine.trim())
      if (lineMatch) {
        filePath = lineMatch[1]
      }
    }

    // Final fallback: generate a filename from language
    if (!filePath) {
      const ext = LANG_EXT[language] ?? 'txt'
      filePath = `file_${++fallbackIndex}.${ext}`
    }

    files.push({ path: filePath, content: body, language: language || undefined })
  }

  return files
}

/**
 * Detect the primary programming language from a list of sandbox files.
 * Returns 'typescript' by default.
 */
export function detectPrimaryLanguage(files: SandboxFile[]): string {
  const counts: Record<string, number> = {}
  for (const f of files) {
    const lang = f.language ?? extensionToLanguage(f.path.split('.').pop() ?? '')
    counts[lang] = (counts[lang] ?? 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'typescript'
}

function extensionToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    tsx: 'typescript',
    jsx: 'javascript'
  }
  return map[ext.toLowerCase()] ?? 'unknown'
}
