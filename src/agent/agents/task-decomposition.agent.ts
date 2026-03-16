import { BaseAgent } from '../framework/base-agent'
import type { PipelineContext } from '../types'

export class TaskDecompositionAgent extends BaseAgent {
  constructor(app: any) {
    super(app, 'decompose_tasks')
  }

  protected async execute(context: PipelineContext) {
    const decomposition = await this.generateStructuredText(
      'generate_backend_code',
      'Create a deterministic ordered checklist for database, services, routes, validation, tests, and integration.',
      context,
      { role: 'planner' }
    )

    const taskPlan = decomposition
      .split('\n')
      .map(line => line.replace(/^[-*\d\.\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 20)

    return {
      context: {
        ...context,
        taskPlan
      },
      summary: 'Tasks decomposed'
    }
  }
}
