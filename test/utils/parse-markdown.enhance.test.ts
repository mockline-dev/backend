import assert from 'assert'

import { parseEnhancePromptResponse } from '../../src/utils/parseMarkdown'

describe('parseEnhancePromptResponse', () => {
  it('parses fenced JSON with assumptions and clarifications', () => {
    const input = [
      '```json',
      '{',
      '  "enhancedPrompt": "Build a modular FastAPI backend",',
      '  "assumptions": ["Use JWT auth"],',
      '  "clarifications": ["Confirm database engine"]',
      '}',
      '```'
    ].join('\n')

    const parsed = parseEnhancePromptResponse(input)

    assert.strictEqual(parsed.enhancedPrompt, 'Build a modular FastAPI backend')
    assert.deepStrictEqual(parsed.assumptions, ['Use JWT auth'])
    assert.deepStrictEqual(parsed.clarifications, ['Confirm database engine'])
  })

  it('falls back to raw text when JSON is invalid', () => {
    const input = '```json\nnot-a-valid-json\n```'

    const parsed = parseEnhancePromptResponse(input)

    assert.strictEqual(parsed.enhancedPrompt, 'not-a-valid-json')
  })
})
