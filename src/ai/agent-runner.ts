import { ArchitecturePlannerAgent } from '../agent/agents/architecture-planner.agent'
import { CodeGenerationAgent } from '../agent/agents/code-generation.agent'
import { IntegrationAgent } from '../agent/agents/integration.agent'
import { IntentAnalyzerAgent } from '../agent/agents/intent-analyzer.agent'
import { TaskDecompositionAgent } from '../agent/agents/task-decomposition.agent'
import { ValidationAgent } from '../agent/agents/validation.agent'
import type { AgentExecutionInput, AgentExecutionResult } from '../agent/types'
import type { Application } from '../declarations'

export async function runAgentStep(
  app: Application,
  input: AgentExecutionInput
): Promise<AgentExecutionResult> {
  const { step, context } = input

  switch (step) {
    case 'analyze_requirements':
      return new IntentAnalyzerAgent(app).run(context)
    case 'generate_architecture':
      return new ArchitecturePlannerAgent(app).run(context)
    case 'decompose_tasks':
      return new TaskDecompositionAgent(app).run(context)
    case 'create_db_schema':
      return new CodeGenerationAgent(app, 'create_db_schema').run(context)
    case 'generate_services':
      return new CodeGenerationAgent(app, 'generate_services').run(context)
    case 'generate_routes':
      return new CodeGenerationAgent(app, 'generate_routes').run(context)
    case 'generate_validation':
      return new ValidationAgent(app).run(context)
    case 'generate_tests':
      return new CodeGenerationAgent(app, 'generate_tests').run(context)
    case 'assemble_project':
      return new IntegrationAgent(app).run(context)
    default:
      throw new Error(`Unsupported agent step: ${step as string}`)
  }
}
