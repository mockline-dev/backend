import config from 'config'

import type { LLMRole } from '../../ai/llm-router'
import { LLMRouter } from '../../ai/llm-router'
import { PromptEngine } from '../../ai/prompt-engine'
import type { Application } from '../../declarations'
import { ollamaClient } from '../../llm/ollama.client'
import { logger } from '../../logger'
import type { AgentExecutionResult, AgentStepName, PipelineContext } from '../types'

interface GenerationOptions {
  role?: LLMRole
  extraSections?: string[]
}

export abstract class BaseAgent {
  constructor(
    protected readonly app: Application,
    protected readonly step: AgentStepName
  ) {}

  protected abstract execute(context: PipelineContext): Promise<{ context: PipelineContext; summary: string }>

  async run(context: PipelineContext): Promise<AgentExecutionResult> {
    logger.info('Agent step started: %s (%s)', this.step, context.generationId)
    const result = await this.execute(context)
    logger.info('Agent step completed: %s (%s)', this.step, context.generationId)

    return {
      step: this.step,
      context: result.context,
      summary: result.summary
    }
  }

  protected async generateStructuredText(
    task: string,
    instruction: string,
    context: PipelineContext,
    options: GenerationOptions = {}
  ) {
    const router = new LLMRouter(this.app)
    const promptEngine = new PromptEngine()

    const route = router.route(task, {
      step: this.step,
      framework: context.framework,
      language: context.language,
      preferredModel: context.targetModel,
      prompt: context.prompt,
      complexity: context.metadata?.complexity,
      role: options.role
    })

    const ollamaConfig = config.get<{
      fallbacks?: Partial<Record<LLMRole, string[]>>
    }>('ollama')

    const resolvedModel = await ollamaClient.ensureModelAvailable(
      route.model,
      options.role ? ollamaConfig.fallbacks?.[options.role] || [] : []
    )

    context.metadata = {
      ...context.metadata,
      [this.step]: {
        task,
        model: resolvedModel,
        temperature: route.temperature,
        complexity: route.complexity,
        role: options.role || null
      },
      complexity: route.complexity
    }

    logger.info(
      'Routing step=%s task=%s model=%s temp=%s complexity=%s',
      this.step,
      task,
      resolvedModel,
      route.temperature,
      route.complexity.level
    )

    const systemPrompt = promptEngine.buildAgentSystemPrompt(this.step, resolvedModel, options.role)
    const userPrompt = [
      `Task: ${task}`,
      `Instruction: ${instruction}`,
      `Framework: ${context.framework}`,
      `Language: ${context.language}`,
      `Project prompt: ${context.prompt}`,
      context.intentSummary ? `Intent summary: ${context.intentSummary}` : '',
      context.architecturePlan ? `Architecture plan: ${context.architecturePlan}` : '',
      context.taskPlan?.length
        ? `Task plan:\n${context.taskPlan.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
        : '',
      ...(options.extraSections || [])
    ]
      .filter(Boolean)
      .join('\n\n')

    const rawOutput = await route.provider.generate(systemPrompt, userPrompt, {
      model: resolvedModel,
      temperature: route.temperature,
      num_ctx: route.numCtx,
      num_predict: route.numPredict,
      top_p: route.topP
    })

    return this.sanitizeModelOutput(rawOutput)
  }

  private sanitizeModelOutput(text: string): string {
    if (!text) {
      return text
    }

    let sanitized = text

    sanitized = sanitized.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

    if (sanitized.startsWith('<think>')) {
      const endTagIndex = sanitized.indexOf('</think>')
      if (endTagIndex >= 0) {
        sanitized = sanitized.slice(endTagIndex + '</think>'.length).trim()
      }
    }

    sanitized = sanitized.replace(/^(Reasoning|Thought process|Internal analysis)\s*:\s*[\s\S]*?\n\n/i, '')

    return sanitized.trim()
  }
}
