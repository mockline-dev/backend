import { logger } from '../logger'
interface ParsedFile {
  filename: string
  content: string
  type: string
}

interface ParsedProjectResponse {
  name: string
  explanation: string
  files: Array<ParsedFile>
}

interface ParsedEnhancePromptResponse {
  enhancedPrompt: string
}

interface ParsedInferProjectMetaResponse {
  name: string
  description: string
}

export const parseProjectResponse = (markdown: string): ParsedProjectResponse => {
  logger.info('Parsing key-value format response...')

  const result: ParsedProjectResponse = {
    name: '',
    explanation: '',
    files: [] as Array<ParsedFile>
  }

  const nameMatch: RegExpMatchArray | null = markdown.match(/PROJECT_NAME:\s*(.*?)(?=\n|$)/)
  if (nameMatch) {
    result.name = nameMatch[1].trim()
  } else {
    logger.info('Warning: PROJECT_NAME not found, trying fallback...')
    const firstHeaderMatch: RegExpMatchArray | null = markdown.match(/^##\s+([^\n]+?)(?=\n##|$)/s)
    if (firstHeaderMatch) {
      const headerText: string = firstHeaderMatch[1].trim()
      if (!headerText.match(/^(Explanation|Files)$/i)) {
        result.name = headerText
      }
    }
  }

  const explanationMatch: RegExpMatchArray | null = markdown.match(
    /PROJECT_EXPLANATION:\s*(.*?)(?=\nPROJECT_FILES:|\n### File:|$)/s
  )
  if (explanationMatch) {
    result.explanation = explanationMatch[1].trim()
  } else {
    logger.info('Warning: PROJECT_EXPLANATION not found, trying fallback...')
    const fallbackExplanationMatch: RegExpMatchArray | null = markdown.match(
      /## Explanation\s*\n+(.*?)(?=\n##|\n### File:|$)/s
    )
    if (fallbackExplanationMatch) {
      result.explanation = fallbackExplanationMatch[1].trim()
    }
  }

  let filesContent: string = ''
  const filesMatch: RegExpMatchArray | null = markdown.match(/PROJECT_FILES:\s*([\s\S]*)/)
  if (filesMatch) {
    filesContent = filesMatch[1]
  } else {
    logger.info('Warning: PROJECT_FILES not found, using entire content for file extraction...')
    filesContent = markdown
  }

  const filePattern: RegExp = /### File:\s*([^\n]+)\s*\n+```(\w*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = filePattern.exec(filesContent)) !== null) {
    const filename: string = match[1].trim()
    const language: string = match[2] || 'text'
    const content: string = match[3]

    logger.info(`Extracted file: ${filename} (${language}), content length: ${content.length}`)

    result.files.push({
      filename,
      content,
      type: determineFileType(filename, language)
    })
  }

  if (result.files.length === 0) {
    logger.info('No files found with primary pattern, trying alternatives...')

    const altPattern: RegExp = /### File:\s*([^\n]+)\s*\n+```\n([\s\S]*?)```/g
    while ((match = altPattern.exec(filesContent)) !== null) {
      const filename: string = match[1].trim()
      const content: string = match[2]

      logger.info(`Extracted file (alt pattern): ${filename}, content length: ${content.length}`)

      result.files.push({
        filename,
        content,
        type: determineFileType(filename)
      })
    }
  }

  if (result.files.length === 0) {
    logger.info('Still no files, trying to extract code blocks...')

    const codeBlockPattern: RegExp = /```(\w*)\n([\s\S]*?)```/g
    const commonFiles: Array<string> = ['main.py', 'requirements.txt', '.env.example', 'README.md']
    let fileIndex: number = 0

    while ((match = codeBlockPattern.exec(filesContent)) !== null) {
      const language: string = match[1] || 'text'
      const content: string = match[2]

      let filename: string = commonFiles[fileIndex] || `file_${fileIndex}.${language}`

      if (language === 'python' && !filename.endsWith('.py')) {
        filename = 'main.py'
      } else if (language === 'bash' || language === 'sh') {
        filename = 'script.sh'
      }

      logger.info(`Extracted file (code block): ${filename}, content length: ${content.length}`)

      result.files.push({
        filename,
        content,
        type: determineFileType(filename, language)
      })

      fileIndex++
    }
  }

  logger.info(
    `Parsing complete. Name: "${result.name}", Explanation: "${result.explanation.substring(0, 50)}...", Files: ${result.files.length}`
  )
  return result
}

export function determineFileType(filename: string, language?: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''

  const typeMap: Record<string, string> = {
    py: 'python',
    pyi: 'python',
    txt: 'text',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    cfg: 'ini',
    env: 'env',
    'env.example': 'env',
    dockerfile: 'dockerfile',
    sh: 'shell',
    bash: 'shell',
    html: 'html',
    css: 'css',
    js: 'javascript',
    ts: 'typescript',
    sql: 'sql',
    gitignore: 'gitignore',
    requirements: 'requirements',
    lock: 'lock'
  }

  if (typeMap[extension]) {
    return typeMap[extension]
  }

  if (language) {
    const languageMap: Record<string, string> = {
      python: 'python',
      bash: 'shell',
      sh: 'shell',
      javascript: 'javascript',
      typescript: 'typescript',
      html: 'html',
      css: 'css',
      sql: 'sql',
      json: 'json',
      yaml: 'yaml',
      markdown: 'markdown',
      dockerfile: 'dockerfile'
    }

    if (languageMap[language.toLowerCase()]) {
      return languageMap[language.toLowerCase()]
    }
  }

  return 'text'
}

export const parseEnhancePromptResponse = (jsonString: string): ParsedEnhancePromptResponse => {
  const result: ParsedEnhancePromptResponse = {
    enhancedPrompt: ''
  }

  try {
    const fenceMatch: RegExpMatchArray | null = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/)
    const clean: string = fenceMatch ? fenceMatch[1].trim() : jsonString.trim()
    const parsed = JSON.parse(clean)
    result.enhancedPrompt = parsed.enhancedPrompt || ''
  } catch (error) {
    logger.error('Failed to parse JSON enhance-prompt response:', error)
  }

  return result
}

export const parseInferProjectMetaResponse = (jsonString: string): ParsedInferProjectMetaResponse => {
  const result: ParsedInferProjectMetaResponse = {
    name: '',
    description: ''
  }

  try {
    const fenceMatch: RegExpMatchArray | null = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/)
    const clean: string = fenceMatch ? fenceMatch[1].trim() : jsonString.trim()
    const parsed = JSON.parse(clean)

    result.name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 60) : ''
    result.description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
  } catch (error) {
    logger.error('Failed to parse JSON infer-project-meta response:', error)
  }

  return result
}
