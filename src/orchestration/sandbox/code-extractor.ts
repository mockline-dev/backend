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
  bash: 'sh',
  html: 'html',
  css: 'css',
  toml: 'toml',
  dockerfile: '',
  markdown: 'md',
  md: 'md'
}

// Common language keywords that should never be treated as file paths
const KEYWORDS = new Set([
  'import', 'from', 'const', 'let', 'var', 'return', 'class', 'function',
  'if', 'else', 'for', 'while', 'async', 'await', 'export', 'default',
  'type', 'interface', 'def', 'print', 'pass', 'break', 'continue',
  'true', 'false', 'null', 'undefined', 'None', 'True', 'False'
])

/**
 * Validate that an extracted string is a plausible file path and not noise.
 */
function isValidFilePath(path: string): boolean {
  if (!path || path.length > 200) return false
  // No absolute paths, parent traversal, or shebang leftovers
  if (path.startsWith('/') || path.startsWith('..') || path.startsWith('!')) return false
  // No URLs
  if (path.includes('://')) return false
  // No single-word language keywords
  if (KEYWORDS.has(path)) return false
  // Must contain at least one word character
  if (!/\w/.test(path)) return false
  // No spaces (file paths don't have spaces in LLM-generated code)
  if (/\s/.test(path)) return false
  return true
}

/**
 * Scan the text immediately before a code fence for a filename hint.
 * LLMs often write "**src/main.py**" or "`src/main.py`:" or "### src/main.py" before a block.
 */
function extractPreBlockPath(markdown: string, blockStartIndex: number): string | null {
  const window = markdown.slice(Math.max(0, blockStartIndex - 300), blockStartIndex)
  const lines = window.split('\n').reverse() // check closest lines first

  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // **src/main.py** or **`src/main.py`**
    let m = trimmed.match(/\*\*`?([^\s*`]+)`?\*\*\s*:?\s*$/)
    if (m && isValidFilePath(m[1])) return m[1]

    // `src/main.py` or `src/main.py`:
    m = trimmed.match(/^`([^\s`]+)`\s*:?\s*$/)
    if (m && isValidFilePath(m[1])) return m[1]

    // ### src/main.py or ## src/main.py
    m = trimmed.match(/^#{1,4}\s+`?([^\s`]+)`?\s*$/)
    if (m && isValidFilePath(m[1])) return m[1]

    // Bare path ending with colon: src/main.py:
    m = trimmed.match(/^([a-zA-Z][\w/.-]+)\s*:\s*$/)
    if (m && isValidFilePath(m[1]) && (m[1].includes('/') || m[1].includes('.'))) return m[1]
  }

  return null
}

/**
 * Try to infer a meaningful filename from code content when no filepath comment is present.
 * Returns null if no strong signal is found.
 */
function inferFileNameFromContent(content: string, language: string): string | null {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  const lower = content.toLowerCase()

  // Dockerfile — FROM must be uppercase
  const knownCodeLangs = new Set(['python', 'py', 'typescript', 'ts', 'javascript', 'js', 'sh', 'bash', 'json', 'yaml', 'yml', 'toml'])
  if (language === 'dockerfile' || (!knownCodeLangs.has(language) && /^FROM\s+\S+/.test(firstLine))) {
    return 'Dockerfile'
  }

  // Shell scripts
  if (firstLine === '#!/bin/bash' || firstLine === '#!/bin/sh' || firstLine === '#!/usr/bin/env bash') {
    return 'script.sh'
  }

  // Python entry points
  if (language === 'python' || language === 'py') {
    if (lower.includes('if __name__') || lower.includes('from fastapi') || lower.includes('import fastapi')) {
      return 'main.py'
    }
    if (lower.includes('flask(__name__)') || lower.includes('from flask') || lower.includes('import flask')) {
      return 'app.py'
    }
    // requirements.txt pattern: lines of "package==version" or "package>=version"
    if (/^[a-z][a-z0-9_-]*[=><!]=/.test(content.trim())) return 'requirements.txt'
  }

  // JavaScript/TypeScript entry points
  if (['typescript', 'ts', 'javascript', 'js'].includes(language)) {
    const isTS = language === 'typescript' || language === 'ts'
    if (lower.includes('app.listen(') || lower.includes('createserver(') ||
        lower.includes('.listen(') && lower.includes('express')) {
      return isTS ? 'server.ts' : 'server.js'
    }
    if (lower.includes('export default') || lower.includes('export const app') ||
        lower.includes('module.exports')) {
      return isTS ? 'index.ts' : 'index.js'
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
  if (language === 'toml' && (lower.includes('[tool.poetry]') || lower.includes('[project]') ||
      lower.includes('[build-system]'))) {
    return 'pyproject.toml'
  }

  // YAML: docker-compose
  if ((language === 'yaml' || language === 'yml') &&
      (lower.includes('docker-compose') || (lower.includes('services:') && lower.includes('image:')))) {
    return 'docker-compose.yml'
  }

  // .env files: lines of KEY=VALUE
  if ((language === 'env' || language === '') && /^[A-Z_][A-Z0-9_]*=.*/m.test(content)) {
    return '.env.example'
  }

  // HTML
  if (language === 'html' && (lower.includes('<!doctype') || lower.includes('<html'))) {
    return 'index.html'
  }

  // CSS
  if (language === 'css' && (lower.includes('{') && lower.includes(':'))) {
    return 'styles.css'
  }

  return null
}

// File path comment patterns (checked in order):
// 1. After the fence language tag:    ```ts // filepath: src/foo.ts  or  ```ts // src/foo.ts
// 2. First line comment (various styles)
const FILE_PATH_IN_FENCE = /^[a-z]*\s+(?:\/\/\s*(?:filepath:|file:)?\s*(\S+)|#\s*(?:filepath:|file:)?\s*(\S+))/i
const FILE_PATH_FIRST_LINE_COMMENT =
  /^(?:\/\/\s*(?:filepath:|file:)?\s*|#\s*(?:filepath:|file:)?\s*|<!--\s*(?:filepath:|file:)?\s*)(\S+?)(?:\s*-->)?$/

/**
 * Extract fenced code blocks from LLM markdown output and return them as SandboxFile objects.
 *
 * Path detection priority:
 *   1. Pre-block hint: **src/main.py**, `src/main.py`:, ### src/main.py
 *   2. Fence-line: ```ts // filepath: src/index.ts  or  ```typescript // src/index.ts
 *   3. First-line comment: // filepath: src/utils.ts  or  # src/main.py
 *   4. Content inference (entry points, package files, etc.)
 *   5. Fallback: file_N.ext
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
      const candidate = fenceMatch[1] ?? fenceMatch[2] ?? null
      if (candidate && isValidFilePath(candidate)) {
        filePath = candidate
      }
    } else {
      // Fence line only contains the language tag
      language = fenceLine.split(/\s+/)[0].toLowerCase()
    }

    // Priority 1: pre-block hint (only if no path found in fence)
    if (!filePath) {
      const preBlock = extractPreBlockPath(markdown, match.index)
      if (preBlock) filePath = preBlock
    }

    // Priority 3: check first line of the body for a path comment
    if (!filePath) {
      const firstLine = body.split('\n')[0]
      const lineMatch = FILE_PATH_FIRST_LINE_COMMENT.exec(firstLine.trim())
      if (lineMatch) {
        const candidate = lineMatch[1]
        if (isValidFilePath(candidate)) {
          filePath = candidate
        }
      }
    }

    // Priority 4: infer from content
    if (!filePath) {
      const inferred = inferFileNameFromContent(body, language)
      if (inferred) {
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

    // Priority 5: generic fallback
    if (!filePath) {
      const ext = LANG_EXT[language]
      if (ext === '') {
        // Language with no extension (e.g. dockerfile)
        filePath = 'Dockerfile'
      } else {
        filePath = `file_${++fallbackIndex}.${ext ?? 'txt'}`
      }
    }

    usedNames.add(filePath)
    files.push({ path: filePath, content: body, language: language || undefined })
  }

  ensureInitPyFiles(files)
  fixRequirementsTxt(files)
  fixPydanticV2(files)

  return files
}

// Known import name → PyPI package name corrections.
// The LLM frequently uses the import name in requirements.txt despite prompt instructions.
const PYPI_NAME_FIXES: Record<string, string> = {
  jwt: 'PyJWT',
  pyjwt: 'PyJWT',
  dotenv: 'python-dotenv',
  yaml: 'PyYAML',
  pyyaml: 'PyYAML',
  bs4: 'beautifulsoup4',
  pil: 'Pillow',
  cv2: 'opencv-python',
  sklearn: 'scikit-learn',
  dateutil: 'python-dateutil',
  serial: 'pyserial'
}

/**
 * Auto-generate empty __init__.py files for any subdirectory that contains .py files
 * but does not already have an __init__.py. Mutates files in-place.
 *
 * Example: models/user.py → adds models/__init__.py (if missing)
 */
function ensureInitPyFiles(files: SandboxFile[]): void {
  const existingPaths = new Set(files.map(f => f.path))
  const dirsNeeded = new Set<string>()

  for (const f of files) {
    if (!f.path.endsWith('.py')) continue
    const parts = f.path.split('/')
    // Collect every ancestor directory (skip root-level files — they have no parent dir)
    for (let i = 1; i < parts.length; i++) {
      dirsNeeded.add(parts.slice(0, i).join('/'))
    }
  }

  for (const dir of dirsNeeded) {
    const initPath = `${dir}/__init__.py`
    if (!existingPaths.has(initPath)) {
      files.push({ path: initPath, content: '', language: 'python' })
      existingPaths.add(initPath)
    }
  }
}

/**
 * Fix known import-name → PyPI-package-name mismatches in requirements.txt.
 * Also normalises case for known packages. Mutates files in-place.
 *
 * Example: "jwt" → "PyJWT", "pyjwt==1.7.1" → "PyJWT"
 */
function fixRequirementsTxt(files: SandboxFile[]): void {
  for (const f of files) {
    if (f.path !== 'requirements.txt' && !f.path.endsWith('/requirements.txt')) continue
    const lines = f.content.split('\n')
    const fixed = lines.map(line => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line
      // Extract bare package name (before any version specifier or extras)
      const nameMatch = trimmed.match(/^([A-Za-z0-9_-]+)/)
      if (!nameMatch) return line
      const key = nameMatch[1].toLowerCase()
      const replacement = PYPI_NAME_FIXES[key]
      if (!replacement) return line
      // Replace name + strip any version pin the LLM may have invented
      return replacement
    })
    f.content = fixed.join('\n')
  }
}

/**
 * Fix Pydantic v2 incompatibilities in generated Python files.
 * The sandbox runs pydantic 2.x — v1 patterns cause immediate ImportError crashes.
 * Mutates files in-place.
 *
 * Fixes applied:
 * - "from pydantic import BaseSettings" → removed (rewritten to use os.environ.get directly)
 * - "from pydantic import validator" → "from pydantic import field_validator"
 * - ".dict(" → ".model_dump("
 * - "pydantic-settings" in requirements.txt → removed (no .env in sandbox)
 */
function fixPydanticV2(files: SandboxFile[]): void {
  for (const f of files) {
    if (f.path.endsWith('.py')) {
      let content = f.content

      // BaseSettings import crash: "from pydantic import BaseSettings" — v1 only
      // Replace with a simple os.environ.get() helper comment so the file stays valid
      if (content.includes('BaseSettings')) {
        content = content.replace(
          /from pydantic(?:_settings)? import .*?BaseSettings.*?\n/g,
          '# BaseSettings removed: use os.environ.get("KEY", "default") directly\n'
        )
        // Remove any class that inherits BaseSettings (replace with plain dict approach)
        content = content.replace(
          /class\s+\w+\s*\(\s*BaseSettings\s*\)\s*:\s*\n([ \t]+.+\n)*/g,
          '# Settings class removed — read config from os.environ.get() directly\n'
        )
      }

      // validator → field_validator (deprecated in v2)
      content = content.replace(
        /from pydantic import (.*?)validator(.*?)(\n)/g,
        (_, before, after, nl) => {
          const cleaned = (before + 'field_validator' + after).replace(/,\s*,/g, ',').trim()
          return `from pydantic import ${cleaned}${nl}`
        }
      )

      // root_validator → model_validator
      content = content.replace(/root_validator/g, 'model_validator')

      // .dict( → .model_dump( (method calls)
      content = content.replace(/\.dict\(/g, '.model_dump(')

      // class Config: orm_mode = True → model_config = ConfigDict(from_attributes=True)
      content = content.replace(
        /class Config:\s*\n\s*orm_mode\s*=\s*True/g,
        'model_config = ConfigDict(from_attributes=True)'
      )
      if (content.includes('ConfigDict') && !content.includes('from pydantic import')) {
        // ConfigDict needs to be imported if used
        content = content.replace(
          /(from pydantic import\s+)([^\n]+)/,
          (_, prefix, imports) => {
            if (!imports.includes('ConfigDict')) return `${prefix}${imports}, ConfigDict`
            return `${prefix}${imports}`
          }
        )
      }

      f.content = content
    }

    // Remove pydantic-settings from requirements.txt — sandbox has no .env
    if (f.path === 'requirements.txt' || f.path.endsWith('/requirements.txt')) {
      f.content = f.content
        .split('\n')
        .filter(line => !/^pydantic[-_]settings/i.test(line.trim()))
        .join('\n')
    }
  }
}

/**
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
