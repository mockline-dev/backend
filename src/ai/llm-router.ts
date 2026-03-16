import type { PromptComplexityProfile } from '../agent/types'
import type { Application } from '../declarations'
import { getProvider } from '../llm/providers/registry'
import type { LLMProvider } from '../llm/providers/types'

export type LLMRole = 'planner' | 'generator' | 'fixer' | 'critic' | 'utility' | 'intent' | 'reflection'

export interface LLMRoute {
  provider: LLMProvider
  model: string
  temperature: number
  numCtx: number
  numPredict: number
  topP: number
  complexity: PromptComplexityProfile
}

export interface LLMRouteHints {
  step?: string
  framework?: 'fast-api' | 'feathers'
  language?: 'python' | 'typescript'
  preferredModel?: string
  prompt?: string
  complexity?: PromptComplexityProfile
  role?: LLMRole
}

interface OllamaRoutingConfig {
  model?: string
  models?: {
    fast?: string
    smart?: string
  }
  roleModels?: Partial<Record<LLMRole, string>>
  numCtx?: number
  numPredict?: number
  topP?: number
  temperature?: number
}

export class LLMRouter {
  constructor(private readonly app: Application) {}

  private analyzeComplexity(prompt: string): PromptComplexityProfile {
    const text = prompt.toLowerCase()
    const signals = [
      ['authentication', /(auth|jwt|oauth|permission|role)/],
      ['database modeling', /(database|schema|migration|entity|model)/],
      ['asynchronous workloads', /(queue|worker|job|cron|event)/],
      ['integrations', /(webhook|third-party|integration|external api)/],
      ['realtime', /(socket|websocket|realtime|stream)/],
      ['testing requirements', /(test|integration test|unit test|e2e)/],
      ['security constraints', /(rate limit|encryption|rbac|security)/]
    ] as const

    const reasons = signals.filter(([, rule]) => rule.test(text)).map(([label]) => label)
    const longPromptBonus = prompt.length > 700 ? 1 : 0
    const score = reasons.length + longPromptBonus

    const level: PromptComplexityProfile['level'] = score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low'

    return {
      score,
      level,
      reasons
    }
  }

  route(task: string, hints: LLMRouteHints = {}): LLMRoute {
    const provider = getProvider()
    const ollamaConfig = this.app.get('ollama') as OllamaRoutingConfig

    const defaultModel = ollamaConfig.model || 'qwen2.5-coder:7b'
    const roleModels = ollamaConfig.roleModels || {}
    const fastModel = roleModels.generator || ollamaConfig.models?.fast || 'qwen2.5-coder:7b'
    const smartModel = roleModels.planner || ollamaConfig.models?.smart || 'phi3:mini'

    const explicitPreferred = hints.preferredModel?.trim()
    const complexity = hints.complexity || this.analyzeComplexity(hints.prompt || '')
    const inferredRole = hints.role || this.inferRole(task, hints.step)

    const allowPreferredForRole = new Set<LLMRole>(['generator', 'reflection', 'fixer'])
    const preferredForRole = allowPreferredForRole.has(inferredRole) ? explicitPreferred : undefined

    const selectedModel =
      preferredForRole ||
      roleModels[inferredRole] ||
      (inferredRole === 'planner' ? smartModel : fastModel) ||
      defaultModel

    const roleTemperatures: Record<LLMRole, number> = {
      planner: 0.2,
      generator: complexity.level === 'high' ? 0.3 : 0.25,
      fixer: 0.12,
      critic: 0.1,
      utility: 0.2,
      intent: 0.15,
      reflection: 0.15
    }

    const globalNumPredict = ollamaConfig.numPredict ?? 8192
    const roleNumPredictCaps: Record<LLMRole, number> = {
      planner: 4096,
      generator: 8192,
      fixer: 3072,
      critic: 2048,
      utility: 1536,
      intent: 1200,
      reflection: 6144
    }

    const numPredict = Math.max(512, Math.min(globalNumPredict, roleNumPredictCaps[inferredRole]))

    return {
      provider,
      model: selectedModel,
      temperature: roleTemperatures[inferredRole] ?? ollamaConfig.temperature ?? 0.2,
      numCtx: ollamaConfig.numCtx ?? 32768,
      numPredict,
      topP: ollamaConfig.topP ?? 0.9,
      complexity
    }
  }

  private inferRole(task: string, step?: string): LLMRole {
    if (task === 'architecture_planning') return 'planner'
    if (task === 'debugging') return 'fixer'
    if (task === 'small_edits') return 'utility'

    if (step === 'analyze_requirements') return 'intent'
    if (step === 'generate_architecture' || step === 'decompose_tasks') return 'planner'
    if (step === 'create_db_schema' || step === 'generate_services' || step === 'generate_routes') {
      return 'generator'
    }
    if (step === 'generate_validation') return 'critic'
    if (step === 'generate_tests') return 'generator'
    if (step === 'assemble_project') return 'utility'

    return 'generator'
  }
}
