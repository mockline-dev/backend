import { BaseAgent } from '../framework/base-agent'
import type { PipelineContext } from '../types'

export class ArchitecturePlannerAgent extends BaseAgent {
  constructor(app: any) {
    super(app, 'generate_architecture')
  }

  protected async execute(context: PipelineContext) {
    const stackDescription =
      context.framework === 'feathers'
        ? 'FeathersJS v5 + TypeScript service-oriented backend'
        : 'FastAPI + Python backend'

    const architecturePlan = await this.generateStructuredText(
      'architecture_planning',
      `Design a scalable ${stackDescription} architecture with queue workers, versioning, and validation.`,
      context,
      { role: 'planner' }
    )

    try {
      await this.app.service('architecture').create({
        projectId: context.projectId,
        services: [],
        models: [],
        relations: [],
        routes: [],
        summary: architecturePlan,
        updatedAt: Date.now()
      } as any)
    } catch {
      context.warnings.push('Failed to persist architecture summary')
    }

    return {
      context: {
        ...context,
        architecturePlan
      },
      summary: 'Architecture planned'
    }
  }
}
