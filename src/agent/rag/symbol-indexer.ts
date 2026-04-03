import { execFileSync } from 'child_process'

export type SymbolKind = 'class' | 'function' | 'method'

export interface CodeSymbol {
  kind: SymbolKind
  name: string
  line: number
  signature?: string
  docstring?: string
}

/**
 * Extracts function/class/method definitions from source files.
 *
 * Python files use python3 ast module via subprocess for accurate AST parsing.
 * TypeScript/JavaScript files use a regex heuristic (tree-sitter Phase F if needed).
 */
export class SymbolIndexer {
  /**
   * Extract all public symbols from the given source file content.
   * For Python: uses python3 ast module (accurate, handles decorators/async).
   * For TypeScript/JS: uses regex heuristic.
   */
  extractSymbols(content: string, filePath: string): CodeSymbol[] {
    if (filePath.endsWith('.py')) {
      return extractPythonSymbols(content)
    }
    if (
      filePath.endsWith('.ts') ||
      filePath.endsWith('.tsx') ||
      filePath.endsWith('.js') ||
      filePath.endsWith('.jsx')
    ) {
      return extractTsSymbols(content)
    }
    return []
  }

  /**
   * Return only public symbol names from a Python or TS file.
   * Convenience wrapper used by ImportRegistry.
   */
  extractPublicNames(content: string, filePath: string): string[] {
    return this.extractSymbols(content, filePath)
      .filter(s => !s.name.startsWith('_'))
      .map(s => s.name)
  }
}

// ---------------------------------------------------------------------------
// Python AST extraction via python3 subprocess
// ---------------------------------------------------------------------------

const PY_EXTRACTOR = `
import ast, json, sys

code = sys.stdin.read()
try:
    tree = ast.parse(code)
except SyntaxError:
    print(json.dumps([]))
    sys.exit(0)

def sig_args(node):
    args = [a.arg for a in node.args.args]
    if node.args.vararg:
        args.append('*' + node.args.vararg.arg)
    if node.args.kwarg:
        args.append('**' + node.args.kwarg.arg)
    return ', '.join(args)

def base_names(bases):
    parts = []
    for b in bases:
        if isinstance(b, ast.Name):
            parts.append(b.id)
        elif isinstance(b, ast.Attribute):
            parts.append(b.attr)
    return parts

symbols = []
for node in ast.iter_child_nodes(tree):
    if isinstance(node, ast.ClassDef):
        bases = base_names(node.bases)
        base_str = '(' + ', '.join(bases) + ')' if bases else ''
        doc = ast.get_docstring(node)
        symbols.append({
            'kind': 'class',
            'name': node.name,
            'line': node.lineno,
            'signature': 'class ' + node.name + base_str,
            'docstring': doc
        })
        for item in ast.iter_child_nodes(node):
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and not item.name.startswith('_'):
                method_doc = ast.get_docstring(item)
                symbols.append({
                    'kind': 'method',
                    'name': item.name,
                    'line': item.lineno,
                    'signature': 'def ' + item.name + '(' + sig_args(item) + ')',
                    'docstring': method_doc
                })
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        if not node.name.startswith('_'):
            fn_doc = ast.get_docstring(node)
            symbols.append({
                'kind': 'function',
                'name': node.name,
                'line': node.lineno,
                'signature': 'def ' + node.name + '(' + sig_args(node) + ')',
                'docstring': fn_doc
            })

print(json.dumps(symbols))
`

interface RawSymbol {
  kind: string
  name: string
  line: number
  signature?: string
  docstring?: string | null
}

function extractPythonSymbols(content: string): CodeSymbol[] {
  try {
    const output = execFileSync('python3', ['-c', PY_EXTRACTOR], {
      input: content,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const raw: unknown = JSON.parse(output.trim())
    if (!Array.isArray(raw)) return []

    return (raw as RawSymbol[])
      .filter(s => typeof s.kind === 'string' && typeof s.name === 'string' && typeof s.line === 'number')
      .map(s => ({
        kind: s.kind as SymbolKind,
        name: s.name,
        line: s.line,
        signature: s.signature ?? undefined,
        docstring: s.docstring ?? undefined
      }))
  } catch {
    // Fallback to regex if python3 unavailable or parsing fails
    return extractPythonSymbolsRegex(content)
  }
}

// ---------------------------------------------------------------------------
// TypeScript/JavaScript regex extraction
// ---------------------------------------------------------------------------

function extractTsSymbols(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = []
  const lines = content.split('\n')

  lines.forEach((line, i) => {
    const clsMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/)
    if (clsMatch) {
      symbols.push({ kind: 'class', name: clsMatch[1], line: i + 1 })
      return
    }
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)/)
    if (fnMatch) {
      symbols.push({
        kind: 'function',
        name: fnMatch[1],
        line: i + 1,
        signature: `function ${fnMatch[1]}(${fnMatch[2]}...)`
      })
    }
  })

  return symbols
}

// ---------------------------------------------------------------------------
// Python regex fallback (used when python3 subprocess fails)
// ---------------------------------------------------------------------------

function extractPythonSymbolsRegex(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = []
  const lines = content.split('\n')

  lines.forEach((line, i) => {
    const clsMatch = line.match(/^class (\w+)(\([^)]*\))?:/)
    if (clsMatch) {
      symbols.push({
        kind: 'class',
        name: clsMatch[1],
        line: i + 1,
        signature: `class ${clsMatch[1]}${clsMatch[2] ?? ''}`
      })
      return
    }
    const methodMatch = line.match(/^ {4,}def ([a-zA-Z]\w*)\(([^)]*)\)/)
    if (methodMatch && !methodMatch[1].startsWith('_')) {
      symbols.push({
        kind: 'method',
        name: methodMatch[1],
        line: i + 1,
        signature: `def ${methodMatch[1]}(${methodMatch[2]})`
      })
      return
    }
    const fnMatch = line.match(/^def ([a-zA-Z]\w*)\(([^)]*)\)/)
    if (fnMatch && !fnMatch[1].startsWith('_')) {
      symbols.push({
        kind: 'function',
        name: fnMatch[1],
        line: i + 1,
        signature: `def ${fnMatch[1]}(${fnMatch[2]})`
      })
    }
  })

  return symbols
}

export const symbolIndexer = new SymbolIndexer()
