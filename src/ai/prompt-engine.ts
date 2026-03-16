import type { AgentStepName } from '../agent/types'
import type { LLMRole } from './llm-router'

export class PromptEngine {
  buildAgentSystemPrompt(step: AgentStepName, model: string, role?: LLMRole): string {
    return [
      'You are a senior backend generation agent operating in a deterministic multi-step pipeline.',
      `Active step: ${step}`,
      `Target model: ${model}`,
      role ? `Execution role: ${role}` : '',
      'Rules:',
      '- Return implementation-ready output with professional structure.',
      '- Output final answer only. Do not include reasoning traces, chain-of-thought, or analysis preambles.',
      '- Never output <think>...</think> blocks or internal deliberation sections.',
      '- Preserve prior context and avoid contradicting previous steps.',
      '- Favor deterministic, testable, and production-safe design choices.',
      '- Include explicit assumptions when context is incomplete.',
      '- Avoid placeholders, TODO-only stubs, and pseudo-code responses.',
      '- Include practical validation and error-handling patterns where relevant.'
    ].join('\n')
  }
}
