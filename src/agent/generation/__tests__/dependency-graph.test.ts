import { describe, it, expect } from 'vitest'

import { topologicalSort } from '../dependency-graph'
import type { LLMFileSpec } from '../file-planner'

// ─── Fixture builder ──────────────────────────────────────────────────────────

function makeSpec(outputPath: string, dependencies: string[] = []): LLMFileSpec {
  return { outputPath, purpose: 'test', dependencies, context: {} }
}

// Full project file set: 2 entities (User, Post) + auth
const userService = makeSpec('app/services/user_service.py')
const postService = makeSpec('app/services/post_service.py')
const userRoute = makeSpec('app/api/routes/user.py', ['app/services/user_service.py'])
const postRoute = makeSpec('app/api/routes/post.py', ['app/services/post_service.py'])
const authRoute = makeSpec('app/api/routes/auth.py', ['app/services/user_service.py'])
const testUser = makeSpec('tests/test_user.py', ['app/api/routes/user.py'])
const testPost = makeSpec('tests/test_post.py', ['app/api/routes/post.py'])

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('topologicalSort', () => {
  const allFiles = [
    userService, postService, userRoute, postRoute, authRoute, testUser, testPost,
  ]

  it('returns all files', () => {
    const sorted = topologicalSort(allFiles)
    expect(sorted).toHaveLength(allFiles.length)
  })

  it('service files come before route files', () => {
    const sorted = topologicalSort(allFiles)
    const paths = sorted.map(f => f.outputPath)

    const userSvcIdx = paths.indexOf('app/services/user_service.py')
    const userRouteIdx = paths.indexOf('app/api/routes/user.py')
    const postSvcIdx = paths.indexOf('app/services/post_service.py')
    const postRouteIdx = paths.indexOf('app/api/routes/post.py')

    expect(userSvcIdx).toBeLessThan(userRouteIdx)
    expect(postSvcIdx).toBeLessThan(postRouteIdx)
  })

  it('auth route comes after user service', () => {
    const sorted = topologicalSort(allFiles)
    const paths = sorted.map(f => f.outputPath)

    const userSvcIdx = paths.indexOf('app/services/user_service.py')
    const authIdx = paths.indexOf('app/api/routes/auth.py')

    expect(userSvcIdx).toBeLessThan(authIdx)
  })

  it('test files come after their route files', () => {
    const sorted = topologicalSort(allFiles)
    const paths = sorted.map(f => f.outputPath)

    const userRouteIdx = paths.indexOf('app/api/routes/user.py')
    const testUserIdx = paths.indexOf('tests/test_user.py')
    const postRouteIdx = paths.indexOf('app/api/routes/post.py')
    const testPostIdx = paths.indexOf('tests/test_post.py')

    expect(userRouteIdx).toBeLessThan(testUserIdx)
    expect(postRouteIdx).toBeLessThan(testPostIdx)
  })

  it('test files come last overall (no route or service after tests)', () => {
    const sorted = topologicalSort(allFiles)
    const paths = sorted.map(f => f.outputPath)
    const lastTest = Math.max(
      paths.indexOf('tests/test_user.py'),
      paths.indexOf('tests/test_post.py')
    )
    const firstRoute = Math.min(
      paths.indexOf('app/api/routes/user.py'),
      paths.indexOf('app/api/routes/post.py'),
      paths.indexOf('app/api/routes/auth.py')
    )
    expect(firstRoute).toBeLessThan(lastTest)
  })

  it('handles an empty array', () => {
    expect(topologicalSort([])).toEqual([])
  })

  it('handles files with no dependencies (services only)', () => {
    const sorted = topologicalSort([userService, postService])
    expect(sorted).toHaveLength(2)
    // Both have in-degree 0, order among them is stable but not guaranteed
  })

  it('gracefully handles a cycle (both files returned)', () => {
    const a = makeSpec('a.py', ['b.py'])
    const b = makeSpec('b.py', ['a.py'])
    const sorted = topologicalSort([a, b])
    expect(sorted).toHaveLength(2)
  })

  it('ignores dependencies on template files (not in llmFiles set)', () => {
    // Models and schemas are template files — not in the LLM set
    const svc = makeSpec('app/services/user_service.py', [
      'app/models/user.py',   // template file — should be ignored for ordering
      'app/schemas/user.py',  // template file — should be ignored for ordering
    ])
    const sorted = topologicalSort([svc])
    expect(sorted).toHaveLength(1)
    expect(sorted[0].outputPath).toBe('app/services/user_service.py')
  })
})
