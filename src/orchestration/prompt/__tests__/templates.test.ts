import { describe, it, expect } from 'vitest'
import { getSystemPrompt } from '../templates'
import { Intent } from '../../types'

describe('getSystemPrompt', () => {
  it('returns a non-empty string for every intent', () => {
    for (const intent of Object.values(Intent)) {
      const prompt = getSystemPrompt(intent)
      expect(prompt).toBeTruthy()
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(20)
    }
  })

  it('interpolates {{framework}} placeholder', () => {
    const prompt = getSystemPrompt(Intent.GenerateProject, { framework: 'FastAPI' })
    expect(prompt).toContain('FastAPI')
    expect(prompt).not.toContain('{{framework}}')
  })

  it('interpolates {{language}} placeholder', () => {
    const prompt = getSystemPrompt(Intent.ExplainCode, { language: 'Python' })
    expect(prompt).toContain('Python')
    expect(prompt).not.toContain('{{language}}')
  })

  it('interpolates {{name}} placeholder', () => {
    const prompt = getSystemPrompt(Intent.AddFeature, { name: 'MyProject' })
    expect(prompt).toContain('MyProject')
    expect(prompt).not.toContain('{{name}}')
  })

  it('leaves no unresolved placeholders when context is provided', () => {
    const prompt = getSystemPrompt(Intent.FixBug, {
      framework: 'FeathersJS',
      language: 'TypeScript',
      name: 'backend'
    })
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })

  it('returns different prompts for different intents', () => {
    const generate = getSystemPrompt(Intent.GenerateProject)
    const fix = getSystemPrompt(Intent.FixBug)
    const explain = getSystemPrompt(Intent.ExplainCode)
    expect(generate).not.toBe(fix)
    expect(fix).not.toBe(explain)
  })

  it('code-producing intents include filepath format instructions', () => {
    const codeIntents = [Intent.GenerateProject, Intent.EditCode, Intent.FixBug, Intent.AddFeature]
    for (const intent of codeIntents) {
      const prompt = getSystemPrompt(intent)
      expect(prompt).toContain('filepath')
      expect(prompt).toContain('MANDATORY CODE OUTPUT FORMAT')
    }
  })

  it('ExplainCode and General do NOT include filepath format instructions', () => {
    expect(getSystemPrompt(Intent.ExplainCode)).not.toContain('MANDATORY CODE OUTPUT FORMAT')
    expect(getSystemPrompt(Intent.General)).not.toContain('MANDATORY CODE OUTPUT FORMAT')
  })
})
