import { BaseAgent } from '../framework/base-agent'
import type { PipelineContext } from '../types'

export class IntentAnalyzerAgent extends BaseAgent {
  constructor(app: any) {
    super(app, 'analyze_requirements')
  }

  protected async execute(context: PipelineContext) {
    const intentSummary = await this.generateStructuredText(
      'generate_backend_code',
      'Extract backend intent, required domain entities, and API goals in a short paragraph.',
      context,
      { role: 'intent' }
    )

    return {
      context: {
        ...context,
        intentSummary
      },
      summary: 'Intent analyzed'
    }
  }
}
