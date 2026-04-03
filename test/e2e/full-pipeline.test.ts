/**
 * Full pipeline end-to-end test.
 *
 * Requires: Ollama running with qwen3:8b, MongoDB, Redis, Python 3.
 * Run with: npm run test:e2e
 *
 * This test is skipped by default — remove .skip to run manually.
 */
import assert from 'assert'
import { execSync, spawn } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { app } from '../../src/app'

const BASE_URL = `http://localhost:${app.get('port')}`

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status} ${path}: ${text}`)
  }
  return res.json()
}

/**
 * Poll project status until it reaches one of the expected statuses.
 * Throws after timeout.
 */
async function waitForStatus(
  projectId: string,
  expected: string[],
  timeoutMs = 120_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const project = await apiCall('GET', `/projects/${projectId}`) as Record<string, unknown>
    if (expected.includes(project.status as string)) return project
    if (project.status === 'error') {
      throw new Error(`Project ${projectId} entered error state`)
    }
    await new Promise(r => setTimeout(r, 3_000))
  }
  throw new Error(`Timeout waiting for project ${projectId} to reach ${expected.join('|')}`)
}

// ─── E2E Suite ────────────────────────────────────────────────────────────────

describe.skip('Full pipeline E2E', function () {
  this.timeout(300_000)

  let projectId: string
  let tmpDir: string

  before(async () => {
    // Ensure app is listening
    await app.listen(app.get('port'))
  })

  after(async () => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('1. Creates a project and generates a todo API', async () => {
    // Create project
    const project = await apiCall('POST', '/projects', {
      name: 'e2e-todo-api',
      description: 'E2E test project'
    }) as Record<string, unknown>
    projectId = project._id as string
    assert.ok(projectId, 'Project should have an ID')

    // Trigger AI generation
    await apiCall('POST', '/ai-service', {
      projectId,
      action: 'generate',
      message:
        'Build a simple todo API with users and tasks. ' +
        'Users can create tasks with title, description, and due date. ' +
        'Tasks can be marked as complete.'
    })

    // Wait for project to be ready
    const done = await waitForStatus(projectId, ['ready'])
    assert.strictEqual(done.status, 'ready', 'Project should be ready')
  })

  it('2. Asserts required files exist in R2', async () => {
    const files = await apiCall('GET', `/files?projectId=${projectId}`) as { data: Array<Record<string, unknown>> }
    const paths = files.data.map(f => f.name as string)

    const required = ['main.py', 'database.py']
    for (const req of required) {
      assert.ok(
        paths.some(p => p.includes(req)),
        `Expected file ${req} in project files`
      )
    }
  })

  it('3. Asserts validation passed', async () => {
    const runs = await apiCall('GET', `/validation-runs?projectId=${projectId}&$sort[createdAt]=-1&$limit=1`) as { data: Array<Record<string, unknown>> }
    assert.ok(runs.data.length > 0, 'Should have at least one validation run')
    assert.ok(runs.data[0].passed, 'Last validation run should have passed')
  })

  it('4. Fetches files and runs the FastAPI server', async () => {
    const files = await apiCall('GET', `/files?projectId=${projectId}&$limit=100`) as { data: Array<Record<string, unknown>> }
    tmpDir = mkdtempSync(join(tmpdir(), 'mockline-e2e-'))

    // Write all files to temp dir
    for (const file of files.data) {
      const filePath = join(tmpDir, file.name as string)
      const dir = filePath.substring(0, filePath.lastIndexOf('/'))
      execSync(`mkdir -p "${dir}"`)
      // Fetch content from R2
      const content = await apiCall('GET', `/files/${file._id as string}/content`) as { content: string }
      writeFileSync(filePath, content.content, 'utf8')
    }

    // Start uvicorn in background
    const proc = spawn('python3', ['-m', 'uvicorn', 'src.main:app', '--port', '9876', '--host', '0.0.0.0'], {
      cwd: tmpDir,
      detached: true,
      stdio: 'ignore'
    })
    proc.unref()

    // Wait for server to start
    await new Promise(r => setTimeout(r, 5_000))

    try {
      const healthRes = await fetch('http://localhost:9876/health')
      assert.strictEqual(healthRes.status, 200, 'Health endpoint should return 200')

      const docsRes = await fetch('http://localhost:9876/docs')
      assert.strictEqual(docsRes.status, 200, 'Docs endpoint should return 200')
    } finally {
      // Kill uvicorn
      try { execSync('pkill -f "uvicorn src.main:app"') } catch { /* ignore */ }
    }
  })

  it('5. Edits project to add priority field to tasks', async () => {
    await apiCall('POST', '/ai-service', {
      projectId,
      action: 'edit',
      message: 'Add a priority field to tasks (low, medium, high)'
    })

    const done = await waitForStatus(projectId, ['ready'])
    assert.strictEqual(done.status, 'ready', 'Project should be ready after edit')
  })

  it('6. Asserts task model has priority field', async () => {
    const files = await apiCall('GET', `/files?projectId=${projectId}&$limit=100`) as { data: Array<Record<string, unknown>> }
    const taskModelFile = files.data.find(f => (f.name as string).includes('task') && (f.name as string).endsWith('.py'))
    assert.ok(taskModelFile, 'Should have a task model file')

    const content = await apiCall('GET', `/files/${taskModelFile._id as string}/content`) as { content: string }
    assert.ok(
      content.content.includes('priority'),
      'Task model should contain priority field'
    )
  })
})
