import assert from 'assert'
import { describe, it } from 'mocha'

import { CodeGenerationAgent } from '../../src/agent/agents/code-generation.agent'
import type { PipelineContext } from '../../src/agent/types'

function createContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    generationId: 'gen-1',
    projectId: 'project-12345678',
    userId: 'user-1',
    prompt: 'Build backend with auth, validation and tests',
    framework: 'fast-api',
    language: 'python',
    files: [],
    warnings: [],
    metadata: {},
    ...overrides
  }
}

describe('CodeGenerationAgent regressions', () => {
  it('parses FILE and markdown-style file blocks', () => {
    const agent = new CodeGenerationAgent({} as any, 'generate_services')
    const parseGeneratedFiles = (agent as any).parseGeneratedFiles.bind(agent) as (
      text: string
    ) => Array<{ path: string; content: string }>

    const response = [
      'FILE: app/services/users.py',
      '```python',
      'def list_users():',
      '    return []',
      '```',
      '',
      '### File: app/routes/users.py',
      '```python',
      'from fastapi import APIRouter',
      'router = APIRouter()',
      '```'
    ].join('\n')

    const files = parseGeneratedFiles(response)

    assert.strictEqual(files.length, 2)
    assert.ok(files.some(file => file.path === 'app/services/users.py'))
    assert.ok(files.some(file => file.path === 'app/routes/users.py'))
  })

  it('uses step-aware fallback when parsing returns no files', async () => {
    const agent = new CodeGenerationAgent({} as any, 'generate_services')
    ;(agent as any).generateStructuredText = async () => 'No file blocks in this answer'

    const result = await agent.run(createContext())

    const generatedPaths = result.context.files.map(file => file.path)
    assert.ok(generatedPaths.includes('app/services/health_service.py'))
    assert.ok(generatedPaths.includes('main.py'))
    assert.ok(generatedPaths.includes('requirements.txt'))
    assert.ok(result.summary.includes('fallback'))
  })
})
