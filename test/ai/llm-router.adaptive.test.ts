import assert from 'assert'
import { describe, it } from 'mocha'

import { LLMRouter } from '../../src/ai/llm-router'

describe('LLMRouter adaptive routing', () => {
  const app = {
    get(key: string) {
      if (key !== 'ollama') {
        return {}
      }
      return {
        model: 'qwen2.5-coder:7b',
        models: {
          fast: 'qwen2.5-coder:7b',
          smart: 'phi3:mini'
        },
        roleModels: {
          planner: 'phi3:mini',
          generator: 'qwen2.5-coder:7b',
          fixer: 'deepseek-coder:6.7b',
          critic: 'deepseek-coder:6.7b',
          utility: 'qwen2.5:3b',
          intent: 'qwen2.5:3b',
          reflection: 'qwen2.5-coder:7b'
        },
        temperature: 0.3,
        numCtx: 16384,
        numPredict: 4096,
        topP: 0.9
      }
    }
  }

  it('uses fast model for low-complexity generation steps', () => {
    const router = new LLMRouter(app as any)

    const route = router.route('generate_backend_code', {
      step: 'generate_services',
      prompt: 'Create a simple health API endpoint',
      framework: 'fast-api',
      language: 'python'
    })

    assert.strictEqual(route.model, 'qwen2.5-coder:7b')
    assert.strictEqual(route.complexity.level, 'low')
  })

  it('keeps generator model for complex prompts and raises temperature', () => {
    const router = new LLMRouter(app as any)

    const route = router.route('generate_backend_code', {
      step: 'generate_services',
      prompt:
        'Build backend with JWT auth, role permissions, websocket realtime updates, queue workers, third-party webhook integration and full test coverage',
      framework: 'fast-api',
      language: 'python'
    })

    assert.strictEqual(route.model, 'qwen2.5-coder:7b')
    assert.strictEqual(route.complexity.level, 'high')
    assert.ok(route.temperature >= 0.3)
  })
})
