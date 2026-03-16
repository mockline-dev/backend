export interface ValidationResult {
  path: string
  valid: boolean
  errors: string[]
}

export interface ValidationSummary {
  passCount: number
  failCount: number
  results: ValidationResult[]
}

function validateJsonFile(path: string, content: string): string[] {
  if (!path.endsWith('.json')) {
    return []
  }

  try {
    JSON.parse(content)
    return []
  } catch (error: any) {
    return [`Invalid JSON: ${error.message}`]
  }
}

function validateTypeScriptBasics(path: string, content: string): string[] {
  if (!path.endsWith('.ts') && !path.endsWith('.tsx')) {
    return []
  }

  const errors: string[] = []
  if (content.includes('TODO_IMPLEMENT_ME')) {
    errors.push('Contains unresolved TODO_IMPLEMENT_ME marker')
  }

  if (content.includes('any') && !content.includes('as any')) {
    errors.push('Contains loose any usage without explicit cast')
  }

  return errors
}

export async function validateGeneratedFiles(
  files: Array<{ path: string; content: string }>,
  _projectId: string,
  _app: any,
  _onProgress?: (step: string, progress: number) => Promise<void>
): Promise<ValidationSummary> {
  const results: ValidationResult[] = []

  for (const file of files) {
    const errors = [
      ...validateJsonFile(file.path, file.content),
      ...validateTypeScriptBasics(file.path, file.content)
    ]
    results.push({
      path: file.path,
      valid: errors.length === 0,
      errors
    })
  }

  const passCount = results.filter(item => item.valid).length
  const failCount = results.length - passCount

  return {
    passCount,
    failCount,
    results
  }
}
