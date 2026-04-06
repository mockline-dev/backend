import * as path from 'path'
import { createModuleLogger } from '../../logging'
import type { CodeChunk } from '../types'
import { chunkText } from './text.chunker'

const log = createModuleLogger('tree-sitter-chunker')

// Lazy-loaded tree-sitter module
let Parser: any = null
let parsersLoaded = false
const parsers: Map<string, any> = new Map()

const LANGUAGE_MAP: Record<string, string> = {
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript'
}

const CODE_EXTENSIONS = new Set(Object.keys(LANGUAGE_MAP))

/**
 * Initialize web-tree-sitter WASM engine. Called once at startup.
 * Safe to call multiple times — only initializes once.
 */
export async function initTreeSitter(): Promise<void> {
  if (parsersLoaded) return

  try {
    const TreeSitter = await import('web-tree-sitter')
    Parser = TreeSitter.default ?? TreeSitter
    await Parser.init()

    // Load language grammars from node_modules
    const grammarPaths: Record<string, string> = {
      python: require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm'),
      typescript: require.resolve('tree-sitter-wasms/out/tree-sitter-typescript.wasm'),
      tsx: require.resolve('tree-sitter-wasms/out/tree-sitter-tsx.wasm'),
      javascript: require.resolve('tree-sitter-wasms/out/tree-sitter-javascript.wasm')
    }

    for (const [lang, grammarPath] of Object.entries(grammarPaths)) {
      try {
        const language = await Parser.Language.load(grammarPath)
        const parser = new Parser()
        parser.setLanguage(language)
        parsers.set(lang, parser)
      } catch (langErr: unknown) {
        log.warn(`Failed to load tree-sitter grammar for ${lang}`, {
          error: langErr instanceof Error ? langErr.message : String(langErr)
        })
      }
    }

    parsersLoaded = true
    log.info('Tree-sitter initialized', { languages: [...parsers.keys()] })
  } catch (err: unknown) {
    log.warn('Tree-sitter WASM init failed — will use text chunker fallback', {
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Returns true if the file extension is supported for AST-based chunking.
 */
export function isCodeFile(filepath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(filepath).toLowerCase())
}

/**
 * Chunk a source file using tree-sitter AST for semantic boundaries.
 * Falls back to text chunker if tree-sitter is unavailable or fails.
 */
export async function chunkCode(content: string, filepath: string): Promise<CodeChunk[]> {
  const ext = path.extname(filepath).toLowerCase()
  const langKey = LANGUAGE_MAP[ext]

  if (!langKey || !parsersLoaded) {
    return chunkText(content, filepath)
  }

  const parser = parsers.get(langKey)
  if (!parser) {
    return chunkText(content, filepath)
  }

  try {
    const tree = parser.parse(content)
    return extractChunks(tree.rootNode, content, filepath)
  } catch (err: unknown) {
    log.warn('Tree-sitter parse failed, falling back to text chunker', {
      filepath,
      error: err instanceof Error ? err.message : String(err)
    })
    return chunkText(content, filepath)
  }
}

/**
 * Walk the AST and extract meaningful top-level chunks.
 * Targets: function_definition, class_definition, method_definition, decorated_definition.
 */
function extractChunks(rootNode: any, content: string, filepath: string): CodeChunk[] {
  const lines = content.split('\n')
  const chunks: CodeChunk[] = []
  let chunkIndex = 0

  const TARGET_NODE_TYPES = new Set([
    'function_definition',
    'function_declaration',
    'class_definition',
    'class_declaration',
    'method_definition',
    'decorated_definition',
    'export_statement',
    'lexical_declaration',
    'expression_statement'
  ])

  function walk(node: any, depth = 0) {
    if (TARGET_NODE_TYPES.has(node.type) && depth <= 2) {
      const startLine = node.startPosition.row
      const endLine = node.endPosition.row
      const chunkContent = lines.slice(startLine, endLine + 1).join('\n')

      // Skip tiny nodes (likely single-line declarations)
      if (endLine - startLine < 1) return

      const symbolName = extractSymbolName(node)
      const symbolKind = mapNodeKind(node.type)

      chunks.push({
        id: `${filepath}:${startLine}:${chunkIndex}`,
        filepath,
        content: chunkContent,
        startLine,
        endLine,
        symbolName,
        symbolKind
      })
      chunkIndex++
      return // Don't recurse into already-extracted nodes
    }

    for (const child of node.children ?? []) {
      walk(child, depth + 1)
    }
  }

  walk(rootNode)

  // If AST extraction yielded nothing, fall back to text chunker
  if (chunks.length === 0) {
    return chunkText(content, filepath)
  }

  return chunks
}

function extractSymbolName(node: any): string | undefined {
  // Try to find a name/identifier child
  for (const child of node.children ?? []) {
    if (child.type === 'identifier' || child.type === 'name') {
      return child.text
    }
  }
  return undefined
}

function mapNodeKind(nodeType: string): CodeChunk['symbolKind'] {
  if (nodeType.includes('function') || nodeType === 'decorated_definition') return 'function'
  if (nodeType.includes('class')) return 'class'
  if (nodeType === 'method_definition') return 'method'
  return 'block'
}
