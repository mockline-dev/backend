import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

import type { ProjectPlan } from '../../src/types/index'
import { TemplateEngine } from '../../src/agent/generation/template-engine'

const blogPlan: ProjectPlan = {
  projectName: 'test-blog',
  description: 'A blog API',
  features: ['user auth', 'CRUD posts', 'comments'],
  entities: [
    {
      name: 'User',
      tableName: 'users',
      fields: [
        { name: 'email', type: 'email', required: true, unique: true },
        { name: 'username', type: 'string', required: true, unique: true },
        { name: 'hashed_password', type: 'string', required: true },
        { name: 'bio', type: 'text', required: false }
      ],
      timestamps: true,
      softDelete: false
    },
    {
      name: 'Post',
      tableName: 'posts',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'content', type: 'text', required: true },
        { name: 'published', type: 'boolean', required: false, default: 'false' },
        { name: 'author_id', type: 'number', required: true, reference: { entity: 'User', field: 'id' } }
      ],
      timestamps: true,
      softDelete: false
    },
    {
      name: 'Comment',
      tableName: 'comments',
      fields: [
        { name: 'body', type: 'text', required: true },
        { name: 'user_id', type: 'number', required: true, reference: { entity: 'User', field: 'id' } },
        { name: 'post_id', type: 'number', required: true, reference: { entity: 'Post', field: 'id' } }
      ],
      timestamps: true,
      softDelete: false
    }
  ],
  relationships: [
    { from: 'User', to: 'Post', type: 'one-to-many', foreignKey: 'author_id' },
    { from: 'User', to: 'Comment', type: 'one-to-many', foreignKey: 'user_id' },
    { from: 'Post', to: 'Comment', type: 'one-to-many', foreignKey: 'post_id' }
  ],
  endpoints: [
    { path: '/users', methods: ['GET', 'POST'], auth: { GET: false, POST: false }, description: 'User CRUD' },
    { path: '/users/{id}', methods: ['GET', 'PUT', 'DELETE'], auth: { GET: false, PUT: true, DELETE: true }, description: 'User by ID' },
    { path: '/posts', methods: ['GET', 'POST'], auth: { GET: false, POST: true }, description: 'Post CRUD' },
    { path: '/posts/{id}', methods: ['GET', 'PUT', 'DELETE'], auth: { GET: false, PUT: true, DELETE: true }, description: 'Post by ID' },
    { path: '/posts/{id}/comments', methods: ['GET', 'POST'], auth: { GET: false, POST: true }, description: 'Comments on post' },
    { path: '/auth/register', methods: ['POST'], auth: { POST: false }, description: 'Register' },
    { path: '/auth/login', methods: ['POST'], auth: { POST: false }, description: 'Login' }
  ],
  authRequired: true,
  externalPackages: []
}

const outDir = '/tmp/mockline/test-templates'

async function main() {
  console.log('=== Test 5B: Template Engine ===\n')

  // Render all templates
  const engine = new TemplateEngine()
  const files = await engine.renderProject(blogPlan)

  console.log(`Rendered ${files.length} files`)

  // Write to disk
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  for (const f of files) {
    const fullPath = path.join(outDir, f.path)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, f.content)
  }

  console.log(`Written to ${outDir}`)

  // Run py_compile on all .py files
  const pyFiles = files.filter(f => f.path.endsWith('.py'))
  console.log(`\nChecking ${pyFiles.length} Python files with py_compile...\n`)

  let passed = 0
  let failed = 0
  const failures: { path: string; error: string }[] = []

  for (const f of pyFiles) {
    const fullPath = path.join(outDir, f.path)
    try {
      execSync(`python3 -m py_compile "${fullPath}"`, { stdio: 'pipe' })
      console.log(`  ✓ ${f.path}`)
      passed++
    } catch (err: unknown) {
      const error = err instanceof Error ? (err as NodeJS.ErrnoError & { stderr?: Buffer }).stderr?.toString() ?? err.message : String(err)
      console.log(`  ✗ ${f.path}`)
      console.log(`    Error: ${error.trim().slice(0, 200)}`)
      failed++
      failures.push({ path: f.path, error })
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`)

  if (failures.length > 0) {
    console.log('\n=== FAILURES ===')
    for (const f of failures) {
      console.log(`\n--- ${f.path} ---`)
      const content = fs.readFileSync(path.join(outDir, f.path), 'utf-8')
      console.log('Content:')
      console.log(content.slice(0, 500))
      console.log('Error:', f.error.slice(0, 200))
    }
    process.exit(1)
  } else {
    console.log('\n✓ ALL Python files pass py_compile')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
