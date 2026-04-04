import { readFileSync } from 'fs'
import { join } from 'path'

import config from 'config'
import Handlebars from 'handlebars'

import { logger } from '../../logger'
import type { GeneratedFile, PlanEntity, PlanRelationship, ProjectPlan } from '../../types'

// ─── Config shape ─────────────────────────────────────────────────────────────

interface TemplateConfig {
  dir: string
  versionMapPath: string
}

// ─── Normalised relationship (what templates actually receive) ────────────────

interface TemplateRelation {
  type: 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many'
  to: string
  foreignKey: string
  junctionTable?: string
  /** True when this entity owns the FK column (many-to-one or one-to-one owner). */
  isOwner: boolean
}

// ─── Helpers (idempotent — safe to call many times) ──────────────────────────

let helpersRegistered = false

function registerHelpers(): void {
  if (helpersRegistered) return
  helpersRegistered = true

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b)
  Handlebars.registerHelper('neq', (a: unknown, b: unknown) => a !== b)
  Handlebars.registerHelper('contains', (arr: unknown, val: unknown) =>
    Array.isArray(arr) && arr.includes(val)
  )
  Handlebars.registerHelper('lowercase', (s: unknown) =>
    typeof s === 'string' ? s.toLowerCase() : ''
  )
  Handlebars.registerHelper('uppercase', (s: unknown) =>
    typeof s === 'string' ? s.toUpperCase() : ''
  )
  Handlebars.registerHelper('snakeCase', (s: unknown) => toSnakeCase(s))
  Handlebars.registerHelper('camelCase', (s: unknown) => toCamelCase(s))
  Handlebars.registerHelper('pascalCase', (s: unknown) => toPascalCase(s))

  Handlebars.registerHelper('sqlalchemyType', (type: unknown) => {
    const map: Record<string, string> = {
      string: 'String(255)',
      str: 'String(255)',
      text: 'Text',
      int: 'Integer',
      integer: 'Integer',
      number: 'Integer',
      float: 'Float',
      decimal: 'Float',
      bool: 'Boolean',
      boolean: 'Boolean',
      datetime: 'DateTime(timezone=True)',
      date: 'DateTime',
      json: 'Text',
      uuid: 'String(36)',
      email: 'String(255)',
      url: 'String(500)',
      password: 'String(255)',
      bytes: 'Text'
    }
    const key = typeof type === 'string' ? type.toLowerCase() : ''
    return map[key] ?? 'String(255)'
  })

  Handlebars.registerHelper('pydanticType', (type: unknown) => {
    const map: Record<string, string> = {
      string: 'str',
      str: 'str',
      text: 'str',
      int: 'int',
      integer: 'int',
      number: 'int',
      float: 'float',
      decimal: 'float',
      bool: 'bool',
      boolean: 'bool',
      datetime: 'datetime',
      date: 'datetime',
      json: 'dict',
      uuid: 'str',
      email: 'str',
      url: 'str',
      password: 'str',
      bytes: 'str'
    }
    const key = typeof type === 'string' ? type.toLowerCase() : ''
    return map[key] ?? 'str'
  })

  Handlebars.registerHelper('pythonDefault', (val: unknown) => {
    if (val === undefined || val === null) return 'None'
    if (typeof val === 'string') return `"${val}"`
    if (typeof val === 'boolean') return val ? 'True' : 'False'
    return String(val)
  })

  Handlebars.registerHelper('joinImports', (arr: unknown) =>
    Array.isArray(arr) ? arr.join(', ') : ''
  )

  Handlebars.registerHelper('testJson', (fields: unknown) => {
    if (!Array.isArray(fields)) return '{}'
    const obj: Record<string, unknown> = {}
    for (const field of fields) {
      if (typeof field !== 'object' || field === null) continue
      const f = field as { name?: string; type?: string; required?: boolean; reference?: unknown }
      if (!f.name) continue
      if (f.reference) continue  // skip FK fields
      if (!f.required) continue  // only required fields in test payload
      obj[f.name] = testValue(f.type ?? 'string')
    }
    return toPythonDict(obj)
  })
}

function toPythonDict(val: unknown): string {
  if (val === null) return 'None'
  if (val === true) return 'True'
  if (val === false) return 'False'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  if (Array.isArray(val)) return `[${val.map(toPythonDict).join(', ')}]`
  if (typeof val === 'object') {
    const pairs = Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `"${k}": ${toPythonDict(v)}`)
    return `{${pairs.join(', ')}}`
  }
  return String(val)
}

function testValue(type: string): unknown {
  switch (type.toLowerCase()) {
    case 'string': case 'password': case 'uuid': return 'test_value'
    case 'text': return 'Test content for field'
    case 'integer': case 'number': case 'int': return 1
    case 'float': case 'decimal': case 'double': return 1.5
    case 'boolean': case 'bool': return true
    case 'email': return 'test@example.com'
    case 'date': return '2024-01-01'
    case 'datetime': case 'timestamp': return '2024-01-01T00:00:00'
    case 'json': return {}
    default: return 'test_value'
  }
}

// ─── Case converters ──────────────────────────────────────────────────────────

function toSnakeCase(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase()
}

function toPascalCase(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, c => c.toUpperCase())
}

function toCamelCase(input: unknown): string {
  const pascal = toPascalCase(input)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

// ─── Relationship normaliser ──────────────────────────────────────────────────

function normalizeRelations(
  entityName: string,
  relationships: PlanRelationship[]
): TemplateRelation[] {
  const result: TemplateRelation[] = []

  for (const rel of relationships) {
    if (rel.from === entityName) {
      result.push({
        type: rel.type,
        to: rel.to,
        foreignKey: rel.foreignKey,
        junctionTable: rel.junctionTable,
        isOwner: rel.type === 'one-to-one' || rel.type === 'many-to-many'
      })
    } else if (rel.to === entityName) {
      if (rel.type === 'one-to-many') {
        // Entity is the "many" side — owns the FK
        result.push({
          type: 'many-to-one',
          to: rel.from,
          foreignKey: rel.foreignKey,
          isOwner: true
        })
      } else if (rel.type === 'one-to-one') {
        result.push({
          type: 'one-to-one',
          to: rel.from,
          foreignKey: rel.foreignKey,
          isOwner: false
        })
      } else if (rel.type === 'many-to-many') {
        result.push({
          type: 'many-to-many',
          to: rel.from,
          foreignKey: rel.foreignKey,
          junctionTable: rel.junctionTable,
          isOwner: false
        })
      }
    }
  }

  return result
}

// ─── Template engine ──────────────────────────────────────────────────────────

export class TemplateEngine {
  private readonly templatesDir: string
  private readonly versions: Record<string, string>
  private readonly cache = new Map<string, HandlebarsTemplateDelegate>()

  constructor() {
    const cfg = config.get<TemplateConfig>('templates')
    this.templatesDir = join(process.cwd(), cfg.dir)
    const versionMapPath = join(process.cwd(), cfg.versionMapPath)

    try {
      this.versions = JSON.parse(readFileSync(versionMapPath, 'utf8')) as Record<string, string>
    } catch {
      this.versions = {}
      logger.warn('TemplateEngine: version-map.json not found at %s', versionMapPath)
    }

    registerHelpers()
  }

  /** Render a single named template with the given context. */
  render(templateName: string, context: Record<string, unknown>): string {
    const tpl = this.loadTemplate(templateName)
    return tpl({ ...context, versions: this.versions })
  }

  /** Render all scaffold files for a project from a ProjectPlan. */
  renderProject(plan: ProjectPlan): GeneratedFile[] {
    const files: GeneratedFile[] = []
    const base = this.baseContext(plan)

    // ── Infrastructure ──────────────────────────────────────────────────────
    files.push(this.renderFile('pyproject.toml.hbs', 'pyproject.toml', base))
    files.push(this.renderFile('requirements.txt.hbs', 'requirements.txt', base))
    files.push(this.renderFile('main.py.hbs', 'main.py', base))
    files.push(this.renderFile('config.py.hbs', 'app/config.py', base))
    files.push(this.renderFile('database.py.hbs', 'app/core/database.py', base))
    files.push(this.renderFile('env.example.hbs', '.env.example', base))

    // ── __init__.py stubs (only for packages without dedicated templates) ──
    // models, schemas, crud have their own init templates rendered below
    const stubPackages = ['app', 'app/core', 'app/api', 'app/api/routes', 'app/services', 'tests']
    for (const pkg of stubPackages) {
      files.push({ path: `${pkg}/__init__.py`, content: '', source: 'template', validated: false })
    }

    // ── Models ──────────────────────────────────────────────────────────────
    files.push(this.renderFile('models/base.py.hbs', 'app/models/base.py', base))
    for (const entity of plan.entities) {
      const ectx = this.entityContext(entity, plan, base)
      files.push(this.renderFile('models/entity.py.hbs', `app/models/${toSnakeCase(entity.name)}.py`, ectx))
    }
    files.push(this.renderFile('models/init.py.hbs', 'app/models/__init__.py', base))

    // ── Schemas ─────────────────────────────────────────────────────────────
    for (const entity of plan.entities) {
      const ectx = this.entityContext(entity, plan, base)
      files.push(this.renderFile('schemas/entity.py.hbs', `app/schemas/${toSnakeCase(entity.name)}.py`, ectx))
    }
    files.push(this.renderFile('schemas/init.py.hbs', 'app/schemas/__init__.py', base))

    // ── CRUD ────────────────────────────────────────────────────────────────
    files.push(this.renderFile('crud/base.py.hbs', 'app/crud/base.py', base))
    for (const entity of plan.entities) {
      const ectx = this.entityContext(entity, plan, base)
      files.push(this.renderFile('crud/entity.py.hbs', `app/crud/${toSnakeCase(entity.name)}.py`, ectx))
    }
    files.push(this.renderFile('crud/init.py.hbs', 'app/crud/__init__.py', base))

    // ── API ─────────────────────────────────────────────────────────────────
    files.push(this.renderFile('api/router.py.hbs', 'app/api/router.py', base))
    files.push(this.renderFile('api/deps.py.hbs', 'app/api/deps.py', base))
    files.push(this.renderFile('api/routes/health.py.hbs', 'app/api/routes/health.py', base))
    for (const entity of plan.entities) {
      const ectx = this.entityContext(entity, plan, base)
      files.push(this.renderFile('api/routes/entity.py.hbs', `app/api/routes/${toSnakeCase(entity.name)}.py`, ectx))
    }
    if (plan.authRequired) {
      files.push(this.renderFile('api/routes/auth.py.hbs', 'app/api/routes/auth.py', base))
    }

    // ── Services ────────────────────────────────────────────────────────────
    for (const entity of plan.entities) {
      const ectx = this.entityContext(entity, plan, base)
      files.push(this.renderFile('services/entity_service.py.hbs', `app/services/${toSnakeCase(entity.name)}_service.py`, ectx))
    }

    // ── Core ────────────────────────────────────────────────────────────────
    files.push(this.renderFile('core/exceptions.py.hbs', 'app/core/exceptions.py', base))
    if (plan.authRequired) {
      files.push(this.renderFile('core/security.py.hbs', 'app/core/security.py', base))
    }

    // ── Tests ───────────────────────────────────────────────────────────────
    files.push(this.renderFile('tests/conftest.py.hbs', 'tests/conftest.py', base))
    for (const entity of plan.entities) {
      const ectx = this.entityContext(entity, plan, base)
      files.push(this.renderFile('tests/test_entity.py.hbs', `tests/test_${toSnakeCase(entity.name)}.py`, ectx))
    }

    // ── Alembic ─────────────────────────────────────────────────────────────
    files.push(this.renderFile('alembic/alembic.ini.hbs', 'alembic.ini', base))
    files.push(this.renderFile('alembic/env.py.hbs', 'alembic/env.py', base))

    logger.info(
      'TemplateEngine: rendered %d scaffold files for "%s"',
      files.length,
      plan.projectName
    )
    return files
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private renderFile(
    templateName: string,
    outputPath: string,
    context: Record<string, unknown>
  ): GeneratedFile {
    try {
      const content = this.render(templateName, context)
      return { path: outputPath, content, source: 'template', validated: false }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('TemplateEngine: %s → %s failed: %s', templateName, outputPath, msg)
      throw new Error(`Template render failed [${outputPath}]: ${msg}`)
    }
  }

  private baseContext(plan: ProjectPlan): Record<string, unknown> {
    return {
      projectName: plan.projectName,
      description: plan.description,
      authRequired: plan.authRequired,
      entities: plan.entities,
      relationships: plan.relationships,
      externalPackages: plan.externalPackages,
      features: plan.features,
      versions: this.versions
    }
  }

  private entityContext(
    entity: PlanEntity,
    plan: ProjectPlan,
    base: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      ...base,
      // Spread entity fields (name, tableName, fields, timestamps, softDelete)
      name: entity.name,
      tableName: entity.tableName,
      fields: entity.fields,
      timestamps: entity.timestamps,
      softDelete: entity.softDelete,
      relations: normalizeRelations(entity.name, plan.relationships)
    }
  }

  private loadTemplate(name: string): HandlebarsTemplateDelegate {
    const cached = this.cache.get(name)
    if (cached) return cached

    const fullPath = join(this.templatesDir, name)
    const source = readFileSync(fullPath, 'utf8')
    const tpl = Handlebars.compile(source, { noEscape: true })
    this.cache.set(name, tpl)
    return tpl
  }
}
