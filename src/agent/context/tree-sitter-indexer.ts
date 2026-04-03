import { execFileSync } from 'child_process'

import { logger } from '../../logger'
import type { Application } from '../../declarations'
import type { GeneratedFile } from '../../types'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FunctionInfo {
  name: string
  params: string[]
  returnType?: string
  line: number
  docstring?: string
}

export interface ClassInfo {
  name: string
  bases: string[]
  methods: FunctionInfo[]
  line: number
}

export interface ImportInfo {
  module: string
  names: string[]
  line: number
}

export interface DecoratorInfo {
  name: string
  target: string
  line: number
}

export interface VariableInfo {
  name: string
  type?: string
  line: number
}

export interface CodeIndex {
  projectId: string
  filepath: string
  functions: FunctionInfo[]
  classes: ClassInfo[]
  imports: ImportInfo[]
  decorators: DecoratorInfo[]
  variables: VariableInfo[]
  updatedAt: number
}

// ─── Python AST extractor script ──────────────────────────────────────────────

const PY_FULL_EXTRACTOR = `
import ast, json, sys

code = sys.stdin.read()
try:
    tree = ast.parse(code)
except SyntaxError as e:
    print(json.dumps({"functions":[],"classes":[],"imports":[],"decorators":[],"variables":[]}))
    sys.exit(0)

def get_args(node):
    args = [a.arg for a in node.args.args]
    if node.args.vararg:
        args.append('*' + node.args.vararg.arg)
    if node.args.kwarg:
        args.append('**' + node.args.kwarg.arg)
    return args

def get_return_type(node):
    if node.returns:
        try:
            return ast.unparse(node.returns)
        except Exception:
            pass
    return None

def get_decorator_name(d):
    if isinstance(d, ast.Name):
        return d.id
    if isinstance(d, ast.Attribute):
        return d.attr
    if isinstance(d, ast.Call):
        return get_decorator_name(d.func)
    return None

def get_base_names(bases):
    parts = []
    for b in bases:
        if isinstance(b, ast.Name):
            parts.append(b.id)
        elif isinstance(b, ast.Attribute):
            parts.append(b.attr)
    return parts

functions = []
classes = []
imports = []
decorators = []
variables = []

for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        for alias in node.names:
            imports.append({"module": alias.name, "names": [], "line": node.lineno})
    elif isinstance(node, ast.ImportFrom):
        if node.module:
            names = [a.name for a in node.names]
            imports.append({"module": node.module, "names": names, "line": node.lineno})

for node in ast.iter_child_nodes(tree):
    if isinstance(node, ast.ClassDef):
        class_decorators = []
        for d in node.decorator_list:
            dn = get_decorator_name(d)
            if dn:
                decorators.append({"name": dn, "target": node.name, "line": d.lineno})
                class_decorators.append(dn)
        methods = []
        for item in ast.iter_child_nodes(node):
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn_doc = ast.get_docstring(item)
                for fd in item.decorator_list:
                    fdn = get_decorator_name(fd)
                    if fdn:
                        decorators.append({"name": fdn, "target": item.name, "line": fd.lineno})
                methods.append({
                    "name": item.name,
                    "params": get_args(item),
                    "returnType": get_return_type(item),
                    "line": item.lineno,
                    "docstring": fn_doc
                })
        classes.append({
            "name": node.name,
            "bases": get_base_names(node.bases),
            "methods": methods,
            "line": node.lineno
        })
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        fn_doc = ast.get_docstring(node)
        for d in node.decorator_list:
            dn = get_decorator_name(d)
            if dn:
                decorators.append({"name": dn, "target": node.name, "line": d.lineno})
        functions.append({
            "name": node.name,
            "params": get_args(node),
            "returnType": get_return_type(node),
            "line": node.lineno,
            "docstring": fn_doc
        })
    elif isinstance(node, (ast.Assign, ast.AnnAssign)):
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            try:
                type_str = ast.unparse(node.annotation)
            except Exception:
                type_str = None
            variables.append({"name": node.target.id, "type": type_str, "line": node.lineno})
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and not t.id.startswith('_'):
                    variables.append({"name": t.id, "type": None, "line": node.lineno})

print(json.dumps({"functions":functions,"classes":classes,"imports":imports,"decorators":decorators,"variables":variables}))
`

// ─── Regex fallback ───────────────────────────────────────────────────────────

function regexParsePython(content: string): Pick<CodeIndex, 'functions' | 'classes' | 'imports' | 'decorators' | 'variables'> {
  const functions: FunctionInfo[] = []
  const classes: ClassInfo[] = []
  const imports: ImportInfo[] = []
  const decorators: DecoratorInfo[] = []
  const variables: VariableInfo[] = []
  const lines = content.split('\n')

  lines.forEach((line, i) => {
    const ln = i + 1

    // Imports
    const fromImport = line.match(/^from ([\w.]+) import (.+)/)
    if (fromImport) {
      const names = fromImport[2].split(',').map(s => s.trim().replace(/\(|\)/g, ''))
      imports.push({ module: fromImport[1], names, line: ln })
      return
    }
    const plainImport = line.match(/^import ([\w.,\s]+)/)
    if (plainImport) {
      plainImport[1].split(',').forEach(m => {
        imports.push({ module: m.trim(), names: [], line: ln })
      })
      return
    }

    // Classes
    const cls = line.match(/^class (\w+)(\(([^)]*)\))?:/)
    if (cls) {
      const bases = cls[3] ? cls[3].split(',').map(s => s.trim()).filter(Boolean) : []
      classes.push({ name: cls[1], bases, methods: [], line: ln })
      return
    }

    // Functions / methods
    const fn = line.match(/^(?:\s{4,})?(?:async\s+)?def ([a-zA-Z]\w*)\(([^)]*)\)/)
    if (fn) {
      functions.push({ name: fn[1], params: fn[2].split(',').map(s => s.trim()).filter(Boolean), line: ln })
    }

    // Decorators
    const dec = line.match(/^@(\w[\w.]*)/)
    if (dec) decorators.push({ name: dec[1], target: '', line: ln })
  })

  return { functions, classes, imports, decorators, variables }
}

// ─── MongoDB document shape ───────────────────────────────────────────────────

interface CodeIndexDoc extends CodeIndex {
  _id?: unknown
}

// ─── TreeSitterIndexer ────────────────────────────────────────────────────────

/**
 * Indexes Python (and TypeScript) files into a structured CodeIndex.
 *
 * Uses python3 ast module for accurate extraction.
 * Falls back to regex if python3 subprocess fails.
 * Persists to MongoDB collection "code-index" when app is configured.
 */
export class TreeSitterIndexer {
  private app: Application | null = null

  /** Wire up MongoDB persistence. Call once at startup. */
  configure(app: Application): void {
    this.app = app
  }

  // ── Core extraction ─────────────────────────────────────────────────────────

  indexFile(projectId: string, filepath: string, content: string): CodeIndex {
    let parsed: Pick<CodeIndex, 'functions' | 'classes' | 'imports' | 'decorators' | 'variables'>

    if (filepath.endsWith('.py')) {
      parsed = this.parsePython(content)
    } else {
      // For TS/JS: lightweight regex (tree-sitter Phase F if needed)
      parsed = this.parsePythonRegex(content)
    }

    const index: CodeIndex = {
      projectId,
      filepath,
      ...parsed,
      updatedAt: Date.now()
    }

    // Persist to MongoDB (fire-and-forget)
    this.persist(index).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('TreeSitterIndexer: failed to persist %s/%s: %s', projectId, filepath, msg)
    })

    return index
  }

  indexProject(projectId: string, files: GeneratedFile[]): void {
    for (const file of files) {
      if (file.path.endsWith('.py')) {
        this.indexFile(projectId, file.path, file.content)
      }
    }
    logger.info('TreeSitterIndexer: indexed %d Python files for project %s', files.filter(f => f.path.endsWith('.py')).length, projectId)
  }

  async getSymbols(projectId: string, filepath: string): Promise<CodeIndex | null> {
    if (!this.app) return null
    try {
      const col = await this.getCollection()
      const doc = await col.findOne({ projectId, filepath }) as CodeIndexDoc | null
      if (!doc) return null
      const { _id: _dropped, ...rest } = doc
      return rest as CodeIndex
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('TreeSitterIndexer.getSymbols failed: %s', msg)
      return null
    }
  }

  async findSymbol(projectId: string, symbolName: string): Promise<Array<{ filepath: string; type: string; line: number }>> {
    if (!this.app) return []
    try {
      const col = await this.getCollection()
      const docs = await col.find({ projectId }).toArray() as CodeIndexDoc[]
      const results: Array<{ filepath: string; type: string; line: number }> = []

      for (const doc of docs) {
        for (const fn of doc.functions) {
          if (fn.name === symbolName) results.push({ filepath: doc.filepath, type: 'function', line: fn.line })
        }
        for (const cls of doc.classes) {
          if (cls.name === symbolName) results.push({ filepath: doc.filepath, type: 'class', line: cls.line })
          for (const method of cls.methods) {
            if (method.name === symbolName) results.push({ filepath: doc.filepath, type: 'method', line: method.line })
          }
        }
      }
      return results
    } catch {
      return []
    }
  }

  async getDependencyGraph(projectId: string): Promise<Map<string, string[]>> {
    const graph = new Map<string, string[]>()
    if (!this.app) return graph

    try {
      const col = await this.getCollection()
      const docs = await col.find({ projectId }).toArray() as CodeIndexDoc[]

      // Build a set of known filepaths (normalised to module paths)
      const fileModuleMap = new Map<string, string>()
      for (const doc of docs) {
        // e.g. "app/services/user_service.py" → "app.services.user_service"
        const mod = doc.filepath.replace(/\//g, '.').replace(/\.py$/, '')
        fileModuleMap.set(mod, doc.filepath)
      }

      for (const doc of docs) {
        const deps: string[] = []
        for (const imp of doc.imports) {
          const target = fileModuleMap.get(imp.module)
          if (target && target !== doc.filepath) deps.push(target)
        }
        graph.set(doc.filepath, deps)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('TreeSitterIndexer.getDependencyGraph failed: %s', msg)
    }

    return graph
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private parsePython(content: string): Pick<CodeIndex, 'functions' | 'classes' | 'imports' | 'decorators' | 'variables'> {
    try {
      const output = execFileSync('python3', ['-c', PY_FULL_EXTRACTOR], {
        input: content,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const raw = JSON.parse(output.trim()) as {
        functions: FunctionInfo[]
        classes: ClassInfo[]
        imports: ImportInfo[]
        decorators: DecoratorInfo[]
        variables: VariableInfo[]
      }

      return {
        functions: raw.functions ?? [],
        classes: raw.classes ?? [],
        imports: raw.imports ?? [],
        decorators: raw.decorators ?? [],
        variables: raw.variables ?? []
      }
    } catch {
      logger.debug('TreeSitterIndexer: python3 failed, falling back to regex')
      return this.parsePythonRegex(content)
    }
  }

  private parsePythonRegex(content: string): Pick<CodeIndex, 'functions' | 'classes' | 'imports' | 'decorators' | 'variables'> {
    return regexParsePython(content)
  }

  private async persist(index: CodeIndex): Promise<void> {
    if (!this.app) return
    const col = await this.getCollection()
    await col.replaceOne(
      { projectId: index.projectId, filepath: index.filepath },
      index,
      { upsert: true }
    )
  }

  private async getCollection() {
    if (!this.app) throw new Error('TreeSitterIndexer: not configured with app instance')
    const db = await this.app.get('mongodbClient')
    const col = db.collection('code-index')
    await col.createIndex({ projectId: 1, filepath: 1 }, { unique: true, background: true })
    return col
  }
}

export const treeSitterIndexer = new TreeSitterIndexer()
