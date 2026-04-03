import type { ProjectPlan } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateFileSpec {
  templateName: string
  outputPath: string
  context: Record<string, unknown>
}

export interface LLMFileSpec {
  outputPath: string
  purpose: string
  /**
   * Paths of OTHER LLM files this file depends on.
   * Used exclusively for topological ordering — not for import resolution.
   */
  dependencies: string[]
  context: Record<string, unknown>
}

export interface FilePlan {
  templateFiles: TemplateFileSpec[]
  llmFiles: LLMFileSpec[]
  /** Union of all output paths (template + LLM). */
  allPaths: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

function toPascalCase(s: string): string {
  return s.replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^(.)/, c => c.toUpperCase())
}

// ─── Planner ──────────────────────────────────────────────────────────────────

/**
 * Deterministically computes the complete file plan from a ProjectPlan.
 *
 * Template files: boilerplate generated from Handlebars templates (no LLM).
 * LLM files: business logic files that require the LLM.
 */
export function planFiles(plan: ProjectPlan): FilePlan {
  const templateFiles: TemplateFileSpec[] = []
  const llmFiles: LLMFileSpec[] = []

  // ── Infrastructure templates ───────────────────────────────────────────────
  templateFiles.push(
    { templateName: 'pyproject.toml.hbs', outputPath: 'pyproject.toml', context: {} },
    { templateName: 'requirements.txt.hbs', outputPath: 'requirements.txt', context: {} },
    { templateName: 'main.py.hbs', outputPath: 'main.py', context: {} },
    { templateName: 'config.py.hbs', outputPath: 'app/config.py', context: {} },
    { templateName: 'database.py.hbs', outputPath: 'app/core/database.py', context: {} },
    { templateName: 'env.example.hbs', outputPath: '.env.example', context: {} },
  )

  // ── __init__.py stubs ──────────────────────────────────────────────────────
  const stubDirs = [
    'app', 'app/core', 'app/api', 'app/api/routes', 'app/services', 'tests',
  ]
  for (const dir of stubDirs) {
    templateFiles.push({
      templateName: 'init.py.stub',
      outputPath: `${dir}/__init__.py`,
      context: {},
    })
  }

  // ── Model templates ────────────────────────────────────────────────────────
  templateFiles.push({
    templateName: 'models/base.py.hbs',
    outputPath: 'app/models/base.py',
    context: {},
  })
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    templateFiles.push({
      templateName: 'models/entity.py.hbs',
      outputPath: `app/models/${snake}.py`,
      context: { entityName: entity.name },
    })
  }
  templateFiles.push({
    templateName: 'models/init.py.hbs',
    outputPath: 'app/models/__init__.py',
    context: {},
  })

  // ── Schema templates ───────────────────────────────────────────────────────
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    templateFiles.push({
      templateName: 'schemas/entity.py.hbs',
      outputPath: `app/schemas/${snake}.py`,
      context: { entityName: entity.name },
    })
  }
  templateFiles.push({
    templateName: 'schemas/init.py.hbs',
    outputPath: 'app/schemas/__init__.py',
    context: {},
  })

  // ── CRUD templates ─────────────────────────────────────────────────────────
  templateFiles.push({
    templateName: 'crud/base.py.hbs',
    outputPath: 'app/crud/base.py',
    context: {},
  })
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    templateFiles.push({
      templateName: 'crud/entity.py.hbs',
      outputPath: `app/crud/${snake}.py`,
      context: { entityName: entity.name },
    })
  }
  templateFiles.push({
    templateName: 'crud/init.py.hbs',
    outputPath: 'app/crud/__init__.py',
    context: {},
  })

  // ── API templates ──────────────────────────────────────────────────────────
  templateFiles.push(
    { templateName: 'api/router.py.hbs', outputPath: 'app/api/router.py', context: {} },
    { templateName: 'api/deps.py.hbs', outputPath: 'app/api/deps.py', context: {} },
    { templateName: 'api/routes/health.py.hbs', outputPath: 'app/api/routes/health.py', context: {} },
  )

  // ── Core templates ─────────────────────────────────────────────────────────
  templateFiles.push({
    templateName: 'core/exceptions.py.hbs',
    outputPath: 'app/core/exceptions.py',
    context: {},
  })
  if (plan.authRequired) {
    templateFiles.push({
      templateName: 'core/security.py.hbs',
      outputPath: 'app/core/security.py',
      context: {},
    })
  }

  // ── Test conftest template ─────────────────────────────────────────────────
  templateFiles.push({
    templateName: 'tests/conftest.py.hbs',
    outputPath: 'tests/conftest.py',
    context: {},
  })

  // ── Alembic templates ──────────────────────────────────────────────────────
  templateFiles.push(
    { templateName: 'alembic/alembic.ini.hbs', outputPath: 'alembic.ini', context: {} },
    { templateName: 'alembic/env.py.hbs', outputPath: 'alembic/env.py', context: {} },
    // Empty versions directory marker
    { templateName: 'init.py.stub', outputPath: 'alembic/versions/.gitkeep', context: {} },
  )

  // ── LLM service files ──────────────────────────────────────────────────────
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    const pascal = toPascalCase(entity.name)
    llmFiles.push({
      outputPath: `app/services/${snake}_service.py`,
      purpose: `Business logic for ${pascal}: get-or-404, list, create, update, delete`,
      dependencies: [], // depends only on template files (already generated)
      context: { entityName: entity.name },
    })
  }

  // ── LLM route files (depend on corresponding service) ─────────────────────
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    const pascal = toPascalCase(entity.name)
    llmFiles.push({
      outputPath: `app/api/routes/${snake}.py`,
      purpose: `REST endpoint handlers for ${pascal}: list, get, create, update, delete`,
      dependencies: [`app/services/${snake}_service.py`],
      context: { entityName: entity.name },
    })
  }

  // ── LLM auth route (depends on user service if User entity exists) ─────────
  if (plan.authRequired) {
    const userEntity = plan.entities.find(e => e.name.toLowerCase() === 'user')
    const userServicePath = userEntity
      ? `app/services/${toSnakeCase(userEntity.name)}_service.py`
      : (llmFiles[0]?.outputPath ?? '')

    llmFiles.push({
      outputPath: 'app/api/routes/auth.py',
      purpose: 'Authentication endpoints: login, register, token refresh',
      dependencies: userServicePath ? [userServicePath] : [],
      context: { entityName: 'User' },
    })
  }

  // ── LLM test files (depend on corresponding route) ────────────────────────
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    const pascal = toPascalCase(entity.name)
    llmFiles.push({
      outputPath: `tests/test_${snake}.py`,
      purpose: `API integration tests for ${pascal} endpoints`,
      dependencies: [`app/api/routes/${snake}.py`],
      context: { entityName: entity.name },
    })
  }

  const allPaths = [
    ...templateFiles.map(f => f.outputPath),
    ...llmFiles.map(f => f.outputPath),
  ]

  return { templateFiles, llmFiles, allPaths }
}
