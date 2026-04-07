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

/**
 * Try to infer a meaningful filename from code content when no filepath comment is present.
 * Returns null if no strong signal is found.
 */
function inferFileNameFromContent(content: string, language: string): string | null {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  const lower = content.toLowerCase()

  // Dockerfile — FROM must be uppercase, and language must not be a known code lang
  const knownCodeLangs = new Set(['python', 'py', 'typescript', 'ts', 'javascript', 'js', 'sh', 'bash', 'json', 'yaml', 'yml', 'toml'])
  if (!knownCodeLangs.has(language) && /^FROM\s+\S+/.test(firstLine)) return 'Dockerfile'

  // Shell scripts
  if (firstLine === '#!/bin/bash' || firstLine === '#!/bin/sh' || firstLine === '#!/usr/bin/env bash') {
    return 'script.sh'
  }

  // Python entry points
  if (language === 'python' || language === 'py') {
    if (lower.includes('if __name__') || lower.includes('from fastapi') || lower.includes('import fastapi') ||
        lower.includes('from flask') || lower.includes('import flask')) {
      return 'main.py'
    }
    // requirements.txt pattern: lines of "package==version" or "package>=version"
    if (/^[a-z][a-z0-9_-]*[=><!]=/.test(content.trim())) return 'requirements.txt'
  }

  // JavaScript/TypeScript entry points
  if (['typescript', 'ts', 'javascript', 'js'].includes(language)) {
    if (lower.includes('export default') || lower.includes('export const app') ||
        lower.includes('module.exports')) {
      return language === 'typescript' || language === 'ts' ? 'index.ts' : 'index.js'
    }
  }

  // JSON: package.json if has "name" + "scripts" or "dependencies"
  if (language === 'json') {
    try {
      const parsed = JSON.parse(content.trim())
      if (parsed && typeof parsed === 'object' && 'name' in parsed &&
          ('scripts' in parsed || 'dependencies' in parsed)) {
        return 'package.json'
      }
    } catch {
      // Not valid JSON
    }
  }

  // TOML project files
  if (language === 'toml' && (lower.includes('[tool.poetry]') || lower.includes('[project]'))) {
    return 'pyproject.toml'
  }

  return null
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
  const usedNames = new Set<string>()

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

    // Try to infer a meaningful name from content before falling back to generic
    if (!filePath) {
      const inferred = inferFileNameFromContent(body, language)
      if (inferred) {
        // Resolve collisions by appending index
        if (!usedNames.has(inferred)) {
          filePath = inferred
        } else {
          const dotIdx = inferred.lastIndexOf('.')
          const base = dotIdx >= 0 ? inferred.slice(0, dotIdx) : inferred
          const ext = dotIdx >= 0 ? inferred.slice(dotIdx) : ''
          let counter = 2
          while (usedNames.has(`${base}_${counter}${ext}`)) counter++
          filePath = `${base}_${counter}${ext}`
        }
      }
    }

    // Final fallback: generate a filename from language
    if (!filePath) {
      const ext = LANG_EXT[language] ?? 'txt'
      filePath = `file_${++fallbackIndex}.${ext}`
    }

    usedNames.add(filePath)
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
