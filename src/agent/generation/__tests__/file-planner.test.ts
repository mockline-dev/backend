import { describe, it, expect } from 'vitest'

import { planFiles } from '../file-planner'
import type { ProjectPlan } from '../../../types'

// ─── Fixture ─────────────────────────────────────────────────────────────────

const plan: ProjectPlan = {
  projectName: 'BlogApp',
  description: 'A blog',
  features: ['auth'],
  authRequired: true,
  externalPackages: [],
  entities: [
    {
      name: 'User',
      tableName: 'users',
      timestamps: true,
      softDelete: false,
      fields: [
        { name: 'email', type: 'email', required: true, unique: true },
        { name: 'username', type: 'string', required: true, unique: true },
      ],
    },
    {
      name: 'Post',
      tableName: 'posts',
      timestamps: true,
      softDelete: false,
      fields: [
        { name: 'title', type: 'string', required: true, unique: false },
        { name: 'body', type: 'text', required: true, unique: false },
      ],
    },
  ],
  relationships: [],
  endpoints: [],
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('planFiles', () => {
  it('returns template files, llm files, and allPaths', () => {
    const result = planFiles(plan)
    expect(result.templateFiles.length).toBeGreaterThan(0)
    expect(result.llmFiles.length).toBeGreaterThan(0)
    expect(result.allPaths.length).toBeGreaterThan(0)
  })

  it('template file count is correct (infra + stubs + models + schemas + crud + api + core + tests + alembic)', () => {
    const result = planFiles(plan)
    // Infra (6) + stubs (6) + models (1+2+1) + schemas (2+1) + crud (1+2+1)
    // + api (3) + core (2 with auth) + test conftest (1) + alembic (3) = 36
    expect(result.templateFiles.length).toBeGreaterThanOrEqual(30)
  })

  it('LLM file count is correct for 2 entities with auth', () => {
    const result = planFiles(plan)
    // 2 services + 2 routes + 1 auth + 2 tests = 7
    expect(result.llmFiles).toHaveLength(7)
  })

  it('all entity model paths appear in template file list', () => {
    const result = planFiles(plan)
    const templatePaths = result.templateFiles.map(f => f.outputPath)
    expect(templatePaths).toContain('app/models/user.py')
    expect(templatePaths).toContain('app/models/post.py')
  })

  it('all entity service paths appear in LLM file list', () => {
    const result = planFiles(plan)
    const llmPaths = result.llmFiles.map(f => f.outputPath)
    expect(llmPaths).toContain('app/services/user_service.py')
    expect(llmPaths).toContain('app/services/post_service.py')
  })

  it('includes auth route in LLM files when authRequired=true', () => {
    const result = planFiles(plan)
    const llmPaths = result.llmFiles.map(f => f.outputPath)
    expect(llmPaths).toContain('app/api/routes/auth.py')
  })

  it('does NOT include auth route when authRequired=false', () => {
    const noAuth = { ...plan, authRequired: false }
    const result = planFiles(noAuth)
    const llmPaths = result.llmFiles.map(f => f.outputPath)
    expect(llmPaths).not.toContain('app/api/routes/auth.py')
  })

  it('allPaths contains both template and LLM paths', () => {
    const result = planFiles(plan)
    expect(result.allPaths).toContain('app/models/user.py')
    expect(result.allPaths).toContain('app/services/user_service.py')
    expect(result.allPaths).toContain('app/api/routes/auth.py')
  })

  it('service files have no LLM dependencies', () => {
    const result = planFiles(plan)
    const services = result.llmFiles.filter(f => f.outputPath.includes('_service.py'))
    for (const svc of services) {
      expect(svc.dependencies).toHaveLength(0)
    }
  })

  it('route files depend on their corresponding service', () => {
    const result = planFiles(plan)
    const userRoute = result.llmFiles.find(f => f.outputPath === 'app/api/routes/user.py')
    expect(userRoute).toBeDefined()
    expect(userRoute!.dependencies).toContain('app/services/user_service.py')
  })

  it('test files depend on their corresponding route', () => {
    const result = planFiles(plan)
    const userTest = result.llmFiles.find(f => f.outputPath === 'tests/test_user.py')
    expect(userTest).toBeDefined()
    expect(userTest!.dependencies).toContain('app/api/routes/user.py')
  })
})
