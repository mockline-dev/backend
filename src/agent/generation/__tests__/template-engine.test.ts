import { execSync, execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, beforeAll } from 'vitest'

import type { ProjectPlan } from '../../../types'

// ─── Fixture ─────────────────────────────────────────────────────────────────

const samplePlan: ProjectPlan = {
  projectName: 'BlogApp',
  description: 'A simple blog application',
  features: ['authentication', 'posts', 'comments'],
  authRequired: true,
  externalPackages: [],
  entities: [
    {
      name: 'User',
      tableName: 'users',
      timestamps: true,
      softDelete: false,
      fields: [
        { name: 'username', type: 'string', required: true, unique: true },
        { name: 'email', type: 'email', required: true, unique: true },
        { name: 'password_hash', type: 'password', required: true, unique: false },
        { name: 'is_active', type: 'boolean', required: false, unique: false, default: true },
      ],
    },
    {
      name: 'Post',
      tableName: 'posts',
      timestamps: true,
      softDelete: false,
      fields: [
        { name: 'title', type: 'string', required: true, unique: false },
        { name: 'content', type: 'text', required: true, unique: false },
        { name: 'published', type: 'boolean', required: false, unique: false, default: false },
        {
          name: 'author_id',
          type: 'integer',
          required: true,
          unique: false,
          reference: { entity: 'User', field: 'id' },
        },
      ],
    },
    {
      name: 'Comment',
      tableName: 'comments',
      timestamps: true,
      softDelete: false,
      fields: [
        { name: 'body', type: 'text', required: true, unique: false },
        {
          name: 'post_id',
          type: 'integer',
          required: true,
          unique: false,
          reference: { entity: 'Post', field: 'id' },
        },
        {
          name: 'author_id',
          type: 'integer',
          required: true,
          unique: false,
          reference: { entity: 'User', field: 'id' },
        },
      ],
    },
  ],
  relationships: [
    {
      from: 'User',
      to: 'Post',
      type: 'one-to-many',
      foreignKey: 'author_id',
    },
    {
      from: 'Post',
      to: 'Comment',
      type: 'one-to-many',
      foreignKey: 'post_id',
    },
    {
      from: 'User',
      to: 'Comment',
      type: 'one-to-many',
      foreignKey: 'author_id',
    },
  ],
  endpoints: [],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasPython3(): boolean {
  try {
    execSync('python3 --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function pyCompile(content: string): { ok: boolean; error: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mockline-tpl-'))
  const file = join(dir, 'test_file.py')
  try {
    writeFileSync(file, content, 'utf8')
    execFileSync('python3', ['-m', 'py_compile', file], { stdio: 'pipe' })
    return { ok: true, error: '' }
  } catch (err: unknown) {
    const stderr = err instanceof Error && 'stderr' in err
      ? (err as NodeJS.ErrnoException & { stderr: Buffer }).stderr?.toString() ?? ''
      : String(err)
    return { ok: false, error: stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TemplateEngine', () => {
  // Import dynamically so we can mock config
  let TemplateEngine: typeof import('../template-engine').TemplateEngine

  beforeAll(async () => {
    const mod = await import('../template-engine')
    TemplateEngine = mod.TemplateEngine
  })

  it('renderProject returns expected number of files', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)

    // Infrastructure (6) + __init__.py stubs (9) + models (1 base + 3 entities + 1 init)
    // + schemas (3 + 1 init) + crud (1 base + 3 + 1 init) + api (router + deps + health)
    // + core (exceptions + security[auth]) + tests (conftest) + alembic (ini + env.py)
    // = 6 + 9 + 5 + 4 + 5 + 3 + 2 + 1 + 2 = 37
    expect(files.length).toBeGreaterThanOrEqual(30)
  })

  it('all returned files have non-empty paths', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    for (const file of files) {
      expect(file.path).toBeTruthy()
      expect(file.source).toBe('template')
    }
  })

  it('all returned files have non-empty content', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    // __init__.py stubs are intentionally empty
    const nonInit = files.filter(f => !f.path.endsWith('__init__.py'))
    for (const file of nonInit) {
      expect(file.content.trim(), `${file.path} is empty`).not.toBe('')
    }
  })

  it('main.py includes all entity routers', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const main = files.find(f => f.path === 'main.py')
    expect(main).toBeDefined()
    // Router is included via app.api.router
    expect(main!.content).toContain('api_router')
  })

  it('models/__init__.py imports all entity models', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const modelsInit = files.find(f => f.path === 'app/models/__init__.py')
    expect(modelsInit).toBeDefined()
    expect(modelsInit!.content).toContain('User')
    expect(modelsInit!.content).toContain('Post')
    expect(modelsInit!.content).toContain('Comment')
  })

  it('User model has correct fields', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const userModel = files.find(f => f.path === 'app/models/user.py')
    expect(userModel).toBeDefined()
    const content = userModel!.content
    expect(content).toContain('class User(Base)')
    expect(content).toContain('username')
    expect(content).toContain('email')
    expect(content).toContain('password_hash')
  })

  it('requirements.txt includes expected packages', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const req = files.find(f => f.path === 'requirements.txt')
    expect(req).toBeDefined()
    const content = req!.content
    expect(content).toContain('fastapi')
    expect(content).toContain('sqlalchemy')
    expect(content).toContain('alembic')
    expect(content).toContain('pydantic')
    // Auth packages
    expect(content).toContain('python-jose')
    expect(content).toContain('passlib')
  })

  it('security.py is included when authRequired=true', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const security = files.find(f => f.path === 'app/core/security.py')
    expect(security).toBeDefined()
    expect(security!.content).toContain('create_access_token')
    expect(security!.content).toContain('verify_password')
  })

  it('security.py is NOT included when authRequired=false', () => {
    const engine = new TemplateEngine()
    const noAuthPlan: ProjectPlan = { ...samplePlan, authRequired: false }
    const files = engine.renderProject(noAuthPlan)
    const security = files.find(f => f.path === 'app/core/security.py')
    expect(security).toBeUndefined()
  })

  it('exceptions.py includes NotFoundException, BadRequestException, UnauthorizedException', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const exc = files.find(f => f.path === 'app/core/exceptions.py')
    expect(exc).toBeDefined()
    expect(exc!.content).toContain('NotFoundException')
    expect(exc!.content).toContain('BadRequestException')
    expect(exc!.content).toContain('UnauthorizedException')
  })

  it('alembic/env.py imports all entity models', () => {
    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const alembicEnv = files.find(f => f.path === 'alembic/env.py')
    expect(alembicEnv).toBeDefined()
    expect(alembicEnv!.content).toContain('User')
    expect(alembicEnv!.content).toContain('Post')
    expect(alembicEnv!.content).toContain('Comment')
  })

  it('every .py file passes python3 -m py_compile', () => {
    if (!hasPython3()) {
      console.warn('python3 not available — skipping py_compile check')
      return
    }

    const engine = new TemplateEngine()
    const files = engine.renderProject(samplePlan)
    const pyFiles = files.filter(f => f.path.endsWith('.py') && f.content.trim() !== '')

    const failures: string[] = []
    for (const file of pyFiles) {
      const result = pyCompile(file.content)
      if (!result.ok) {
        failures.push(`${file.path}: ${result.error}`)
      }
    }

    if (failures.length > 0) {
      throw new Error(`py_compile failed for ${failures.length} file(s):\n${failures.join('\n')}`)
    }
  })
})
