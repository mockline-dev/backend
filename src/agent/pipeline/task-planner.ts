import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { createUniversalPromptBuilder } from '../../llm/prompts/universal-prompts'
import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'
import type { IntentSchema } from './intent-analyzer'

export interface TaskPlan {
  path: string
  description: string
}

const REQUIRED_FASTAPI_FILES: TaskPlan[] = [
  { path: 'requirements.txt', description: 'Python dependencies' },
  { path: '.env.example', description: 'Environment variables template' },
  { path: 'app/__init__.py', description: 'App package initialization' },
  { path: 'app/core/config.py', description: 'Configuration management' },
  { path: 'app/core/security.py', description: 'Security utilities (password hashing, JWT)' },
  { path: 'app/core/database.py', description: 'Database connection and session management' },
  { path: 'main.py', description: 'FastAPI app entrypoint' }
]

const REQUIRED_NESTJS_FILES: TaskPlan[] = [
  { path: 'package.json', description: 'Node.js dependencies' },
  { path: '.env.example', description: 'Environment variables template' },
  { path: 'tsconfig.json', description: 'TypeScript configuration' },
  { path: 'nest-cli.json', description: 'NestJS CLI configuration' },
  { path: 'src/main.ts', description: 'NestJS app entrypoint' },
  { path: 'src/app.module.ts', description: 'Root application module' }
]

const REQUIRED_GO_FILES: TaskPlan[] = [
  { path: 'go.mod', description: 'Go module definition' },
  { path: '.env.example', description: 'Environment variables template' },
  { path: 'main.go', description: 'Go application entrypoint' }
]

const REQUIRED_RUST_FILES: TaskPlan[] = [
  { path: 'Cargo.toml', description: 'Rust package configuration' },
  { path: '.env.example', description: 'Environment variables template' },
  { path: 'src/main.rs', description: 'Rust application entrypoint' }
]

const REQUIRED_JAVA_FILES: TaskPlan[] = [
  { path: 'pom.xml', description: 'Maven dependencies' },
  { path: '.env.example', description: 'Environment variables template' },
  {
    path: 'src/main/java/com/example/app/Application.java',
    description: 'Spring Boot application entrypoint'
  }
]

function getRequiredFilesForStack(stackId: string): TaskPlan[] {
  switch (stackId) {
    case 'nodejs-nestjs':
      return REQUIRED_NESTJS_FILES
    case 'go-gin':
      return REQUIRED_GO_FILES
    case 'rust-actix':
      return REQUIRED_RUST_FILES
    case 'java-springboot':
      return REQUIRED_JAVA_FILES
    case 'python-fastapi':
    default:
      return REQUIRED_FASTAPI_FILES
  }
}

export class TaskPlanner {
  async plan(prompt: string, schema: IntentSchema, stackId?: string): Promise<TaskPlan[]> {
    logger.debug(
      'TaskPlanner: planning file structure for project "%s" with stack %s',
      schema.projectName,
      stackId || 'default'
    )

    const provider = getProvider()
    let responseText = ''

    // Use universal prompt builder if stackId is provided, otherwise use old prompts for backward compatibility
    const useUniversalPrompts = !!stackId
    let planPrompt: string

    if (useUniversalPrompts) {
      const promptBuilder = createUniversalPromptBuilder()
      planPrompt = promptBuilder.buildFilePlanningPrompt(prompt, schema, stackId || 'python-fastapi')
    } else {
      planPrompt = buildGenerationPrompts.filePlan(prompt, schema)
    }

    for await (const chunk of provider.chatStream([{ role: 'user', content: planPrompt }], undefined, {
      temperature: 0.1
    })) {
      responseText += chunk.message.content
    }

    const raw = parseJson(responseText, 'file plan')

    if (!Array.isArray(raw)) {
      throw new Error('TaskPlanner: file plan is not an array')
    }

    const normalized: TaskPlan[] = raw
      .filter((item: any) => typeof item === 'object' && item !== null)
      .map((item: any) => ({
        path: String(item.path ?? '').trim(),
        description: String(item.description ?? 'Generated file').trim()
      }))
      .filter(item => item.path.length > 0)

    if (normalized.length === 0) {
      throw new Error('TaskPlanner: file plan is empty')
    }

    return this.ensureRequiredFiles(normalized, stackId)
  }

  private ensureRequiredFiles(plan: TaskPlan[], stackId?: string): TaskPlan[] {
    const existing = new Set(plan.map(f => f.path))
    const result = [...plan]
    const requiredFiles = getRequiredFilesForStack(stackId || 'python-fastapi')

    for (const required of requiredFiles) {
      if (!existing.has(required.path)) {
        logger.warn('TaskPlanner: injecting missing required file: %s', required.path)
        result.unshift(required)
      }
    }
    return result
  }
}

function parseJson(text: string, context: string): any {
  const match = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  try {
    return JSON.parse((match?.[1] || text).trim())
  } catch (err) {
    logger.error('TaskPlanner: failed to parse %s JSON: %s', context, text.slice(0, 300))
    throw new Error(
      `TaskPlanner: failed to parse ${context}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
