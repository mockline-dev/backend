import Handlebars from 'handlebars'
import { readFileSync } from 'fs'
import { join } from 'path'

import type { IntentSchema } from './intent-analyzer'
import { logger } from '../../logger'

export interface RenderedFile {
  path: string
  content: string
}

// ---------------------------------------------------------------------------
// Version map — loaded once at module load
// ---------------------------------------------------------------------------

const VERSION_MAP_PATH = join(process.cwd(), 'version-map.json')

let versionMap: Record<string, string>
try {
  versionMap = JSON.parse(readFileSync(VERSION_MAP_PATH, 'utf8')) as Record<string, string>
} catch {
  logger.warn('template-engine: version-map.json not found at %s, using empty map', VERSION_MAP_PATH)
  versionMap = {}
}

// ---------------------------------------------------------------------------
// Handlebars helpers
// ---------------------------------------------------------------------------

/** "myEntityName" → "MyEntityName" */
Handlebars.registerHelper('pascalCase', (str: unknown) => {
  if (typeof str !== 'string') return ''
  return str
    .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, c => c.toUpperCase())
})

/** "myEntityName" / "MyEntityName" → "my_entity_name" */
Handlebars.registerHelper('snakeCase', (str: unknown) => {
  if (typeof str !== 'string') return ''
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase()
})

/** Map IntentSchema field type → SQLAlchemy column type string */
Handlebars.registerHelper('sqlalchemyType', (type: unknown) => {
  const map: Record<string, string> = {
    string: 'String(255)',
    str: 'String(255)',
    text: 'Text',
    int: 'Integer',
    integer: 'Integer',
    float: 'Float',
    number: 'Float',
    bool: 'Boolean',
    boolean: 'Boolean',
    datetime: 'DateTime(timezone=True)',
    date: 'DateTime',
    json: 'Text',
    uuid: 'String(36)',
    email: 'String(255)',
    url: 'String(500)',
    password: 'String(255)'
  }
  const key = typeof type === 'string' ? type.toLowerCase() : ''
  return map[key] ?? 'String(255)'
})

/** Map IntentSchema field type → Pydantic type annotation */
Handlebars.registerHelper('pydanticType', (type: unknown) => {
  const map: Record<string, string> = {
    string: 'str',
    str: 'str',
    text: 'str',
    int: 'int',
    integer: 'int',
    float: 'float',
    number: 'float',
    bool: 'bool',
    boolean: 'bool',
    datetime: 'datetime',
    date: 'datetime',
    json: 'dict',
    uuid: 'str',
    email: 'str',
    url: 'str',
    password: 'str'
  }
  const key = typeof type === 'string' ? type.toLowerCase() : ''
  return map[key] ?? 'str'
})

/** Equality helper for use in {{#if (eq a b)}} */
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b)

// ---------------------------------------------------------------------------
// Template loader (cached)
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = join(process.cwd(), 'src', 'templates', 'fastapi')
const templateCache = new Map<string, HandlebarsTemplateDelegate>()

function loadTemplate(relativePath: string): HandlebarsTemplateDelegate {
  const cached = templateCache.get(relativePath)
  if (cached) return cached

  const fullPath = join(TEMPLATES_DIR, relativePath)
  const source = readFileSync(fullPath, 'utf8')
  const compiled = Handlebars.compile(source, { noEscape: true })
  templateCache.set(relativePath, compiled)
  return compiled
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

interface TemplateContext {
  projectName: string
  description: string
  authRequired: boolean
  entities: IntentSchema['entities']
  versions: Record<string, string>
  [key: string]: unknown
}

function buildBaseContext(schema: IntentSchema): TemplateContext {
  return {
    projectName: schema.projectName,
    description: schema.description ?? '',
    authRequired: schema.authType !== 'none',
    entities: schema.entities ?? [],
    versions: versionMap
  }
}

function buildEntityContext(
  base: TemplateContext,
  entity: IntentSchema['entities'][number],
  schema: IntentSchema
): TemplateContext {
  // Tag each relation so the template knows which side this entity is on.
  // isSource=true  → entity is the FROM side (owns the relationship / foreign key)
  // isSource=false → entity is the TO side (receives the back-reference)
  const relations = (schema.relationships ?? [])
    .filter(r => r.from === entity.name || r.to === entity.name)
    .map(r => ({ ...r, isSource: r.from === entity.name }))
  return { ...base, ...entity, relations }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render all scaffold (template-only, no-LLM) files for a project.
 * Returns a list of { path, content } objects ready to upload to R2.
 */
export function renderScaffold(schema: IntentSchema): RenderedFile[] {
  const ctx = buildBaseContext(schema)
  const files: RenderedFile[] = []

  // ── Infrastructure ──────────────────────────────────────────────────────
  files.push(render('requirements.txt.hbs', 'requirements.txt', ctx))
  files.push(render('.env.hbs', '.env', ctx))
  files.push(render('main.py.hbs', 'main.py', ctx))
  files.push(render('config.py.hbs', 'app/config.py', ctx))
  files.push(render('database.py.hbs', 'app/core/database.py', ctx))

  // ── __init__.py stubs ───────────────────────────────────────────────────
  const initPkgs = [
    'app',
    'app/core',
    'app/models',
    'app/schemas',
    'app/crud',
    'app/api',
    'app/api/routes',
    'app/services',
    'tests'
  ]
  for (const pkg of initPkgs) {
    files.push({ path: `${pkg}/__init__.py`, content: '' })
  }

  // ── Models ──────────────────────────────────────────────────────────────
  files.push(render('models/base.py.hbs', 'app/models/base.py', ctx))
  for (const entity of schema.entities) {
    const ectx = buildEntityContext(ctx, entity, schema)
    const snake = toSnakeCase(entity.name)
    files.push(render('models/entity.py.hbs', `app/models/${snake}.py`, ectx))
  }

  // ── Schemas ─────────────────────────────────────────────────────────────
  for (const entity of schema.entities) {
    const ectx = buildEntityContext(ctx, entity, schema)
    const snake = toSnakeCase(entity.name)
    files.push(render('schemas/entity.py.hbs', `app/schemas/${snake}.py`, ectx))
  }

  // ── CRUD ────────────────────────────────────────────────────────────────
  files.push(render('crud/base.py.hbs', 'app/crud/base.py', ctx))
  for (const entity of schema.entities) {
    const ectx = buildEntityContext(ctx, entity, schema)
    const snake = toSnakeCase(entity.name)
    files.push(render('crud/entity.py.hbs', `app/crud/${snake}.py`, ectx))
  }

  // ── API ─────────────────────────────────────────────────────────────────
  files.push(render('api/router.py.hbs', 'app/api/router.py', ctx))
  files.push(render('api/deps.py.hbs', 'app/api/deps.py', ctx))
  files.push(render('api/routes/health.py.hbs', 'app/api/routes/health.py', ctx))

  // ── Core ────────────────────────────────────────────────────────────────
  files.push(render('core/exceptions.py.hbs', 'app/core/exceptions.py', ctx))
  if (ctx.authRequired) {
    files.push(render('core/security.py.hbs', 'app/core/security.py', ctx))
  }

  // ── Tests ───────────────────────────────────────────────────────────────
  files.push(render('tests/conftest.py.hbs', 'tests/conftest.py', ctx))

  logger.info('template-engine: rendered %d scaffold files for "%s"', files.length, schema.projectName)
  return files
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function render(templatePath: string, outputPath: string, ctx: TemplateContext): RenderedFile {
  try {
    const tpl = loadTemplate(templatePath)
    return { path: outputPath, content: tpl(ctx) }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('template-engine: failed to render %s: %s', templatePath, msg)
    throw new Error(`Template render failed for ${outputPath}: ${msg}`)
  }
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase()
}
