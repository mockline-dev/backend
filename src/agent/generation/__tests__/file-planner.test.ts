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
      features: [],
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
      features: [],
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
  it('returns template files and allPaths (llmFiles is always empty)', () => {
    const result = planFiles(plan)
    expect(result.templateFiles.length).toBeGreaterThan(0)
    expect(result.llmFiles).toHaveLength(0)
    expect(result.allPaths.length).toBeGreaterThan(0)
  })

  it('all paths come from templateFiles (template-first generation)', () => {
    const result = planFiles(plan)
    expect(result.allPaths).toEqual(result.templateFiles.map(f => f.outputPath))
  })

  it('template file count covers all file types for 2 entities with auth', () => {
    const result = planFiles(plan)
    // All files are template files now — should be substantial
    expect(result.templateFiles.length).toBeGreaterThanOrEqual(30)
  })

  it('all entity model paths appear in template file list', () => {
    const result = planFiles(plan)
    const templatePaths = result.templateFiles.map(f => f.outputPath)
    expect(templatePaths).toContain('app/models/user.py')
    expect(templatePaths).toContain('app/models/post.py')
  })

  it('all entity service paths appear in template file list', () => {
    const result = planFiles(plan)
    const paths = result.templateFiles.map(f => f.outputPath)
    expect(paths).toContain('app/services/user_service.py')
    expect(paths).toContain('app/services/post_service.py')
  })

  it('all entity route paths appear in template file list', () => {
    const result = planFiles(plan)
    const paths = result.templateFiles.map(f => f.outputPath)
    expect(paths).toContain('app/api/routes/user.py')
    expect(paths).toContain('app/api/routes/post.py')
  })

  it('all entity test paths appear in template file list', () => {
    const result = planFiles(plan)
    const paths = result.templateFiles.map(f => f.outputPath)
    expect(paths).toContain('tests/test_user.py')
    expect(paths).toContain('tests/test_post.py')
  })

  it('includes auth route in template files when authRequired=true', () => {
    const result = planFiles(plan)
    const paths = result.templateFiles.map(f => f.outputPath)
    expect(paths).toContain('app/api/routes/auth.py')
  })

  it('does NOT include auth route when authRequired=false', () => {
    const noAuth = { ...plan, authRequired: false }
    const result = planFiles(noAuth)
    const paths = result.templateFiles.map(f => f.outputPath)
    expect(paths).not.toContain('app/api/routes/auth.py')
  })

  it('allPaths contains model, service, route and test paths', () => {
    const result = planFiles(plan)
    expect(result.allPaths).toContain('app/models/user.py')
    expect(result.allPaths).toContain('app/services/user_service.py')
    expect(result.allPaths).toContain('app/api/routes/user.py')
    expect(result.allPaths).toContain('tests/test_user.py')
    expect(result.allPaths).toContain('app/api/routes/auth.py')
  })
})
