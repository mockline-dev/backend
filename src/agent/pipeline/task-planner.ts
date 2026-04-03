import type { Logger } from 'winston'

import { llmClient, getModelConfig } from '../../llm/client'
import { stripThinkTags } from '../../llm/structured-output'
import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { logger } from '../../logger'
import { DependencyAnalyzer, type DependencyGraph } from './dependency-analyzer'
import type { IntentSchema } from './intent-analyzer'
import { parseJson, withRetry } from './utils'

export interface TaskPlan {
  path: string
  description: string
}

const REQUIRED_FASTAPI_FILES: TaskPlan[] = [
  { path: 'requirements.txt', description: 'Python dependencies' },
  { path: '.env', description: 'Local environment variables (SQLite DATABASE_URL etc.)' },
  { path: 'main.py', description: 'FastAPI app entrypoint' },
  { path: 'app/__init__.py', description: 'App package init' },
  { path: 'app/core/__init__.py', description: 'Core package init' },
  { path: 'app/models/__init__.py', description: 'Models package init' },
  { path: 'app/schemas/__init__.py', description: 'Schemas package init' },
  { path: 'app/services/__init__.py', description: 'Services package init' },
  { path: 'app/api/__init__.py', description: 'API package init' },
  { path: 'app/core/deps.py', description: 'Dependency injection for auth (get_db, get_current_user)' }
]

export class TaskPlanner {
  private dependencyAnalyzer = new DependencyAnalyzer()

  async plan(prompt: string, schema: IntentSchema, log: Logger = logger): Promise<TaskPlan[]> {
    log.debug('TaskPlanner: planning file structure for project "%s"', schema.projectName)

    const plan = await withRetry(
      () => this.callLLM(prompt, schema, log),
      2,
      [1000, 2000],
      'TaskPlanner'
    )

    // Build dependency graph and order files
    const graph = this.dependencyAnalyzer.analyzeDependencies(plan, schema)
    const orderedPlan = this.dependencyAnalyzer.getOrderedFiles(graph, plan)

    log.debug('TaskPlanner: ordered %d files with dependency awareness', orderedPlan.length)

    return orderedPlan
  }

  private async callLLM(prompt: string, schema: IntentSchema, log: Logger): Promise<TaskPlan[]> {
    const modelCfg = getModelConfig('planning')
    const systemPrompt = 'You are a FastAPI expert. Always respond with a valid JSON array of file objects only. No markdown, no explanation.'
    const userPrompt = buildGenerationPrompts.filePlan(prompt, schema)

    log.debug('TaskPlanner: LLM call — model=%s, system=%d chars, user=%d chars', modelCfg.name, systemPrompt.length, userPrompt.length)

    const response = await llmClient.chat({
      model: modelCfg.name,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: modelCfg.temperature,
      think: modelCfg.think,
      format: 'json'
    })

    const raw = stripThinkTags(response.content)
    log.debug('TaskPlanner: LLM response — %d chars (first 200: %s)', raw.length, raw.slice(0, 200))
    const rawParsed = parseJson(raw, 'file plan')

    if (!Array.isArray(rawParsed)) {
      throw new Error('TaskPlanner: file plan is not an array')
    }

    const normalized: TaskPlan[] = rawParsed
      .filter((item: any) => typeof item === 'object' && item !== null)
      .map((item: any) => ({
        path: String(item.path ?? '').trim(),
        description: String(item.description ?? 'Generated file').trim()
      }))
      .filter(item => item.path.length > 0)

    if (normalized.length === 0) {
      throw new Error('TaskPlanner: file plan is empty')
    }

    return this.ensureRequiredFiles(normalized)
  }

  private ensureRequiredFiles(plan: TaskPlan[]): TaskPlan[] {
    const existing = new Set(plan.map(f => f.path))
    const result = [...plan]

    for (const required of REQUIRED_FASTAPI_FILES) {
      if (!existing.has(required.path)) {
        logger.warn('TaskPlanner: injecting missing required file: %s', required.path)
        result.unshift(required)
        existing.add(required.path)
      }
    }

    // Ensure __init__.py exists for every Python package directory found in the plan
    const packageDirs = new Set<string>()
    for (const task of result) {
      if (!task.path.endsWith('.py')) continue
      const parts = task.path.split('/')
      // Accumulate each directory segment that isn't already a __init__.py
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/')
        if (dir) packageDirs.add(dir)
      }
    }

    for (const dir of packageDirs) {
      const initPath = `${dir}/__init__.py`
      if (!existing.has(initPath)) {
        logger.warn('TaskPlanner: injecting missing __init__.py for package: %s', dir)
        result.push({ path: initPath, description: `${dir} package init` })
        existing.add(initPath)
      }
    }

    return result
  }

  /**
   * Returns the dependency graph for external use (e.g., by file generator).
   */
  getDependencyGraph(plan: TaskPlan[], schema: IntentSchema): DependencyGraph {
    return this.dependencyAnalyzer.analyzeDependencies(plan, schema)
  }
}
