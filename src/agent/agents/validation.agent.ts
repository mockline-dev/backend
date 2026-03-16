import { BaseAgent } from '../framework/base-agent'
import type { PipelineContext } from '../types'

type RequestedArea = 'authentication' | 'database' | 'validation' | 'testing' | 'realtime'

export class ValidationAgent extends BaseAgent {
  constructor(app: any) {
    super(app, 'generate_validation')
  }

  protected async execute(context: PipelineContext) {
    const missingTests = context.files.every(
      file => !file.path.includes('test') && !file.path.includes('spec')
    )

    const hasRoutes = context.files.some(file => /(route|router|controller|api)/i.test(file.path))
    const hasServices = context.files.some(file => /(service)/i.test(file.path))
    const hasValidation = context.files.some(file => /(schema|validator|validation)/i.test(file.path))
    const placeholderFiles = context.files
      .filter(file => /TODO|implement later|placeholder/i.test(file.content))
      .map(file => file.path)

    const requestedAreas = this.detectRequestedAreas(context.prompt)
    const areaCoverageMap: Record<RequestedArea, boolean> = {
      authentication: context.files.some(file => /(auth|jwt|oauth|login)/i.test(file.path + file.content)),
      database: context.files.some(file =>
        /(model|schema|database|migration|sql)/i.test(file.path + file.content)
      ),
      validation: hasValidation,
      testing: !missingTests,
      realtime: context.files.some(file => /(socket|websocket|realtime)/i.test(file.path + file.content))
    }

    const warnings = [...context.warnings]
    if (missingTests) {
      warnings.push('Generated output does not include explicit test files yet')
    }
    if (!hasRoutes) {
      warnings.push('Generated output does not include explicit route/controller files')
    }
    if (!hasServices) {
      warnings.push('Generated output does not include explicit service-layer files')
    }
    if (!hasValidation) {
      warnings.push('Generated output does not include explicit schema/validation files')
    }
    if (placeholderFiles.length > 0) {
      warnings.push(`Generated output contains placeholder content in: ${placeholderFiles.join(', ')}`)
    }

    const uncoveredRequestedAreas = requestedAreas.filter(area => !areaCoverageMap[area])
    if (uncoveredRequestedAreas.length > 0) {
      warnings.push(
        `Generated output may not fully cover requested areas: ${uncoveredRequestedAreas.join(', ')}`
      )
    }

    return {
      context: {
        ...context,
        warnings,
        metadata: {
          ...context.metadata,
          validation: {
            hasRoutes,
            hasServices,
            hasValidation,
            missingTests,
            placeholderFiles,
            uncoveredRequestedAreas
          }
        }
      },
      summary: 'Validation checks applied'
    }
  }

  private detectRequestedAreas(prompt: string): RequestedArea[] {
    const content = prompt.toLowerCase()
    const areas: RequestedArea[] = []

    if (/(auth|jwt|oauth|login)/.test(content)) areas.push('authentication')
    if (/(database|schema|migration|model|sql|postgres|mongo)/.test(content)) areas.push('database')
    if (/(validation|validator|constraints)/.test(content)) areas.push('validation')
    if (/(test|testing|unit|integration|spec)/.test(content)) areas.push('testing')
    if (/(socket|websocket|realtime)/.test(content)) areas.push('realtime')

    return areas
  }
}
