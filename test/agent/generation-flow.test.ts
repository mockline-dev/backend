import assert from 'assert'
import { execFile } from 'child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import { GenerationPipeline } from '../../src/agent/pipeline/pipeline'
import { r2Client } from '../../src/storage/r2.client'

const execFileAsync = promisify(execFile)

type ProjectRecord = {
  _id: string
  language: 'python'
  framework: 'fast-api'
  status: string
  generationProgress?: Record<string, unknown>
}

type FileRecord = {
  _id: string
  projectId: string
  name: string
  key: string
  fileType: string
  size: number
  updatedAt?: number
}

class InMemoryProjectsService {
  private project: ProjectRecord

  constructor(initial: ProjectRecord) {
    this.project = initial
  }

  async get(id: string) {
    if (id !== this.project._id) {
      throw new Error('Project not found')
    }
    return this.project
  }

  async patch(id: string, data: any) {
    if (id !== this.project._id) {
      throw new Error('Project not found')
    }
    this.project = {
      ...this.project,
      ...data,
      generationProgress: {
        ...(this.project.generationProgress || {}),
        ...(data.generationProgress || {})
      }
    }
    return this.project
  }

  getCurrent() {
    return this.project
  }
}

class InMemoryFilesService {
  private files: FileRecord[] = []

  async find(params: any) {
    const query = params?.query || {}
    const filtered = this.files.filter(file => {
      const matchesProject = query.projectId ? file.projectId === query.projectId : true
      const matchesKey = query.key ? file.key === query.key : true
      return matchesProject && matchesKey
    })

    return {
      total: filtered.length,
      data: filtered.slice(0, query.$limit || filtered.length)
    }
  }

  async create(data: Omit<FileRecord, '_id'>) {
    const created: FileRecord = { ...data, _id: `file-${this.files.length + 1}` }
    this.files.push(created)
    return created
  }

  async patch(id: string, data: Partial<FileRecord>) {
    const index = this.files.findIndex(file => file._id === id)
    if (index < 0) {
      throw new Error('File not found')
    }
    this.files[index] = { ...this.files[index], ...data }
    return this.files[index]
  }

  getAll() {
    return this.files
  }
}

class InMemoryArchitectureService {
  private created: any[] = []

  async create(data: any) {
    const record = { _id: `arch-${this.created.length + 1}`, ...data }
    this.created.push(record)
    return record
  }

  getLatest() {
    return this.created[this.created.length - 1]
  }
}

function createTestApp() {
  const projects = new InMemoryProjectsService({
    _id: 'project-1',
    language: 'python',
    framework: 'fast-api',
    status: 'generating'
  })
  const files = new InMemoryFilesService()
  const architecture = new InMemoryArchitectureService()

  return {
    app: {
      service(name: string) {
        if (name === 'projects') return projects
        if (name === 'files') return files
        if (name === 'architecture') return architecture
        throw new Error(`Unknown service: ${name}`)
      }
    },
    projects,
    files,
    architecture
  }
}

const minimalSchema = {
  projectName: 'mini_backend',
  description: 'Minimal backend for flow test',
  entities: [
    {
      name: 'User',
      fields: [
        { name: 'id', type: 'str', required: true, indexed: true },
        { name: 'email', type: 'str', required: true, indexed: true }
      ],
      endpoints: ['list', 'get']
    }
  ],
  features: [],
  authType: 'none' as const,
  relationships: []
}

const generatedFiles = [
  {
    path: 'requirements.txt',
    content: 'fastapi\nuvicorn\n'
  },
  {
    path: 'main.py',
    content: `class DummyApp:\n    def get(self, _path):\n        def decorator(fn):\n            return fn\n\n        return decorator\n\n\napp = DummyApp()\n\n\n@app.get('/users')\ndef list_users():\n    return [{'id': '1', 'email': 'user@example.com'}]\n\n\nif __name__ == '__main__':\n    print('mockline-test-backend running')\n`
  }
]

describe('generation flow smoke tests', () => {
  it('generates minimal backend files and stores architecture metadata', async () => {
    const { app, architecture, files } = createTestApp()
    const pipeline = new GenerationPipeline(app as any)

    ;(pipeline as any).memory = {
      initialize: async () => {},
      recordPrompt: async () => {},
      load: async () => null,
      buildContextBlock: () => '',
      recordDecisions: async () => {}
    }
    ;(pipeline as any).retriever = {
      indexProject: async () => {},
      getRelevantFiles: async () => []
    }
    ;(pipeline as any).intentAnalyzer = {
      analyze: async () => minimalSchema
    }
    ;(pipeline as any).schemaValidator = {
      validate: () => ({ isValid: true, errors: [], warnings: [], relationships: [] })
    }
    ;(pipeline as any).taskPlanner = {
      plan: async () => [
        { path: 'requirements.txt', description: 'deps' },
        { path: 'main.py', description: 'entry' }
      ]
    }
    ;(pipeline as any).fileGenerator = {
      generateAll: async () => generatedFiles
    }
    ;(pipeline as any).crossFileValidator = {
      validate: () => ({ isValid: true, errors: [], warnings: [] })
    }

    const originalPutObject = r2Client.putObject.bind(r2Client)
    ;(r2Client as any).putObject = async () => {}

    try {
      const result = await pipeline.run({
        projectId: 'project-1',
        prompt: 'create a tiny backend with users endpoint',
        userId: 'user-1',
        onProgress: async () => {}
      })

      assert.strictEqual(result.fileCount, 2)
      assert.strictEqual(result.files.length, 2)
      assert.ok(result.files.some(file => file.path === 'main.py'))
      assert.ok(result.files.some(file => file.path === 'requirements.txt'))

      const persistedFiles = files.getAll()
      assert.strictEqual(persistedFiles.length, 2)
      assert.ok(persistedFiles.some(file => file.name === 'main.py'))

      const createdArchitecture = architecture.getLatest()
      assert.ok(createdArchitecture)
      assert.strictEqual(createdArchitecture.projectId, 'project-1')
      assert.ok(Array.isArray(createdArchitecture.models))
      assert.ok(createdArchitecture.models.some((model: any) => model.name === 'User'))
      assert.ok(Array.isArray(createdArchitecture.routes))
      assert.ok(createdArchitecture.routes.some((route: any) => route.path === '/users'))
    } finally {
      ;(r2Client as any).putObject = originalPutObject
    }
  })

  it('runs generated minimal backend entrypoint', async function () {
    try {
      await execFileAsync('python3', ['--version'])
    } catch {
      this.skip()
      return
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'mockline-flow-'))
    const backendDir = join(tempRoot, 'generated-backend')

    await mkdir(backendDir, { recursive: true })
    await writeFile(join(backendDir, 'main.py'), generatedFiles[1].content, 'utf-8')

    try {
      const syntaxCheck = await execFileAsync('python3', ['-m', 'py_compile', 'main.py'], {
        cwd: backendDir
      })
      assert.strictEqual(syntaxCheck.stderr, '')

      const runResult = await execFileAsync('python3', ['main.py'], { cwd: backendDir })
      assert.ok(runResult.stdout.includes('mockline-test-backend running'))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
