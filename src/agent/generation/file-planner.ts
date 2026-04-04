import type { ProjectPlan } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateFileSpec {
  templateName: string
  outputPath: string
  context: Record<string, unknown>
}

/** Kept for backward compatibility — always empty in template-first generation */
export interface LLMFileSpec {
  outputPath: string
  purpose: string
  dependencies: string[]
  context: Record<string, unknown>
}

export interface FilePlan {
  templateFiles: TemplateFileSpec[]
  /** Always empty — all files are now generated from templates */
  llmFiles: LLMFileSpec[]
  /** Union of all output paths */
  allPaths: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

// ─── Planner ──────────────────────────────────────────────────────────────────

/**
 * Deterministically computes the complete file plan from a ProjectPlan.
 * All files are now generated from Handlebars templates — no LLM calls.
 */
export function planFiles(plan: ProjectPlan): FilePlan {
  const templateFiles: TemplateFileSpec[] = []

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
  const stubDirs = ['app', 'app/core', 'app/api', 'app/api/routes', 'app/services', 'tests']
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
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    templateFiles.push({
      templateName: 'api/routes/entity.py.hbs',
      outputPath: `app/api/routes/${snake}.py`,
      context: { entityName: entity.name },
    })
  }
  if (plan.authRequired) {
    templateFiles.push({
      templateName: 'api/routes/auth.py.hbs',
      outputPath: 'app/api/routes/auth.py',
      context: {},
    })
  }

  // ── Service templates ──────────────────────────────────────────────────────
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    templateFiles.push({
      templateName: 'services/entity_service.py.hbs',
      outputPath: `app/services/${snake}_service.py`,
      context: { entityName: entity.name },
    })
  }

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

  // ── Test templates ─────────────────────────────────────────────────────────
  templateFiles.push({
    templateName: 'tests/conftest.py.hbs',
    outputPath: 'tests/conftest.py',
    context: {},
  })
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    templateFiles.push({
      templateName: 'tests/test_entity.py.hbs',
      outputPath: `tests/test_${snake}.py`,
      context: { entityName: entity.name },
    })
  }

  // ── Alembic templates ──────────────────────────────────────────────────────
  templateFiles.push(
    { templateName: 'alembic/alembic.ini.hbs', outputPath: 'alembic.ini', context: {} },
    { templateName: 'alembic/env.py.hbs', outputPath: 'alembic/env.py', context: {} },
    { templateName: 'init.py.stub', outputPath: 'alembic/versions/.gitkeep', context: {} },
  )

  return {
    templateFiles,
    llmFiles: [],
    allPaths: templateFiles.map(f => f.outputPath),
  }
}
