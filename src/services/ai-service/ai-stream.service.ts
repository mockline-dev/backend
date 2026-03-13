import { authenticate } from '@feathersjs/authentication'
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors'
import { ProjectMemory } from '../../agent/memory/project-memory'
import { ContextRetriever } from '../../agent/rag/retriever'
import { getProvider } from '../../llm/providers/registry'

const MAX_CONTEXT_FILE_TREE_ENTRIES = 300
const MAX_ALLOWED_EDIT_FILES = 40

type ContextSource = 'user-selected' | 'user-tree' | 'retrieved' | 'architecture'

interface AIContextFileTreeEntry {
  path: string
  size?: number
  fileType?: string
}

interface AIContextSelectionRange {
  startLine: number
  endLine: number
}

interface AIStreamContextInput {
  files?: string[]
  fileTree?: AIContextFileTreeEntry[]
  selectedFile?: string
  selectedContent?: string
  selectedRange?: AIContextSelectionRange
  pinnedFiles?: string[]
  allowedEditFiles?: string[]
  [key: string]: unknown
}

interface AIResolvedContext extends AIStreamContextInput {
  files: string[]
  sourceTags: ContextSource[]
  architectureSummary?: string
}

const MOCKY_ASSISTANT_PROMPT = `You are Mocky, an expert backend developer assistant for the Mockline platform.
Your role is to help users improve, debug, and extend their AI-generated FastAPI backends.

When suggesting file changes, use this EXACT format:

FILE_UPDATE: [filename]
ACTION: [create|modify|delete]
DESCRIPTION: [brief description of change]
\`\`\`[language]
[updated code content]
\`\`\`

Rules:
- For ACTION: modify, ALWAYS use targeted SEARCH/REPLACE blocks. Do not return full-file content for modify.
- Use this block format for targeted modifications:
  <<<<<<< SEARCH
  [exact existing code snippet]
  =======
  [new replacement snippet]
  >>>>>>> REPLACE
- You can include multiple SEARCH/REPLACE blocks in one modify update.
- For dependency files (such as requirements.txt), preserve existing lines and only change the specific dependency lines requested.
- Only return full-file content for ACTION: create.
- One FILE_UPDATE block per file
- Only modify files directly required by the request. Do not refactor or touch unrelated files.
- If a file is currently selected, treat it as the primary edit target and avoid changes outside it unless explicitly requested.
- Keep explanations brief and put file update blocks exactly as specified
- Do not wrap FILE_UPDATE/ACTION/DESCRIPTION labels in markdown formatting
- Consider the existing project structure
- Prioritize the user's exact prompt intent and avoid unrelated refactors or formatting-only rewrites.
- Keep edits minimal, safe, and scoped to only what the user requested.
- Reason step-by-step about the smallest safe patch before writing FILE_UPDATE blocks.
- If the user provides logs/errors, diagnose the concrete root cause from those logs first and propose targeted fixes; do not reply with generic clarification prompts.
- Follow FastAPI best practices (Pydantic v2, dependency injection, proper error handling, and minimal safe changes that satisfy the request)`

export default function (app: any) {
  app.use(
    '/ai-stream',
    {
      async create(
        data: {
          projectId: string
          message: string
          conversationHistory?: Array<{ role: string; content: string }>
          context?: AIStreamContextInput
        },
        params: any
      ) {
        const { projectId, message, conversationHistory = [], context } = data

        if (!projectId) {
          throw new BadRequest('projectId is required')
        }

        if (!message?.trim()) {
          throw new BadRequest('message is required')
        }

        const userId = params.user?._id?.toString?.()
        let project: any
        try {
          project = await app.service('projects').get(projectId)
        } catch {
          throw new NotFound('Project not found')
        }

        if (project.userId?.toString?.() !== userId) {
          throw new Forbidden('Not your project')
        }

        const sanitizedHistory = (conversationHistory || [])
          .filter(
            item =>
              item && typeof item.content === 'string' && ['system', 'user', 'assistant'].includes(item.role)
          )
          .slice(-30)

        let resolvedContext = normalizeContext(context)
        if (!resolvedContext.selectedContent && resolvedContext.files.length === 0) {
          const retriever = new ContextRetriever(app)
          const relevant = await retriever.getRelevantFiles(projectId, message, 8)
          if (relevant.length > 0) {
            resolvedContext = {
              ...resolvedContext,
              files: relevant.map(f => f.path),
              selectedContent: relevant.map(f => `=== ${f.path} ===\n${f.content}`).join('\n\n'),
              sourceTags: dedupeSources([...resolvedContext.sourceTags, 'retrieved'])
            }
          }
        }

        const architectureSummary = await getArchitectureSummary(app, projectId)
        if (architectureSummary) {
          resolvedContext = {
            ...resolvedContext,
            architectureSummary,
            sourceTags: dedupeSources([...resolvedContext.sourceTags, 'architecture'])
          }
        }

        // Load project memory and build context block for system prompt
        const projectMemory = new ProjectMemory(app)
        await projectMemory.recordPrompt(projectId, message)
        const memoryData = await projectMemory.load(projectId)
        const memoryBlock = projectMemory.buildContextBlock(memoryData)

        const messages = [
          { role: 'system', content: buildSystemPrompt(resolvedContext, memoryBlock, message) },
          ...sanitizedHistory,
          { role: 'user', content: message }
        ]

        const aiStreamService = app.service('ai-stream')
        aiStreamService.emit('agent-step', {
          projectId,
          type: 'status',
          title: 'Analyzing request',
          detail: 'Preparing context and conversation state',
          createdAt: Date.now()
        })

        let fullContent = ''

        const provider = getProvider()
        aiStreamService.emit('agent-step', {
          projectId,
          type: 'thinking',
          title: 'Generating response',
          detail: 'Streaming assistant output',
          createdAt: Date.now()
        })

        for await (const chunk of provider.chatStream(messages as any, undefined, {
          temperature: 0.4,
          num_ctx: 32768
        })) {
          fullContent += chunk.message.content

          // Emit streaming chunk as a custom service event.
          aiStreamService.emit('chunk', {
            projectId,
            content: chunk.message.content,
            fullContent,
            done: chunk.done
          })
        }

        // Save the complete assistant message
        const assistantMessage = await app.service('messages').create({
          projectId,
          role: 'assistant',
          type: 'text',
          content: fullContent
        })

        // Parse for file updates and handle them
        const parsedFileUpdates = parseFileUpdates(fullContent)
        const scopeResult = enforceEditScope(parsedFileUpdates, resolvedContext, message)
        const fileUpdates = scopeResult.allowed

        if (scopeResult.blocked.length > 0) {
          aiStreamService.emit('agent-step', {
            projectId,
            type: 'status',
            title: 'Blocked out-of-scope edits',
            detail: `Filtered ${scopeResult.blocked.length} update(s) outside allowed scope`,
            createdAt: Date.now()
          })
        }

        if (fileUpdates.length > 0) {
          // Auto-snapshot before applying AI-suggested changes
          try {
            aiStreamService.emit('agent-step', {
              projectId,
              type: 'status',
              title: 'Creating safety snapshot',
              detail: 'Saving rollback point before edits',
              createdAt: Date.now()
            })

            await app.service('snapshots').create({
              projectId,
              label: `Before AI edit: ${message.substring(0, 50)}`,
              trigger: 'auto-ai-edit'
            })
          } catch (snapErr: any) {
            console.error('Failed to create pre-edit snapshot:', snapErr.message)
          }

          aiStreamService.emit('file-updates', {
            projectId,
            updates: fileUpdates
          })

          for (const update of fileUpdates) {
            aiStreamService.emit('write-preview', {
              projectId,
              filename: update.filename,
              action: update.action,
              newContent: update.content,
              description: update.description
            })
          }
        }

        aiStreamService.emit('agent-step', {
          projectId,
          type: 'status',
          title: 'Response ready',
          detail:
            fileUpdates.length > 0
              ? `Prepared ${fileUpdates.length} file update preview(s)`
              : 'No file edits suggested',
          createdAt: Date.now()
        })

        return {
          success: true,
          messageId: assistantMessage?._id?.toString?.() ?? assistantMessage?._id
        }
      }
    },
    {
      methods: ['create'],
      events: ['chunk', 'file-updates', 'agent-step', 'write-preview']
    }
  )

  app.service('ai-stream').hooks({
    before: {
      create: [authenticate('jwt')]
    }
  })
}

function buildSystemPrompt(context?: AIResolvedContext, memoryBlock?: string, userMessage?: string): string {
  let prompt = MOCKY_ASSISTANT_PROMPT
  if (userMessage?.trim()) {
    prompt += `\n\nUser intent (latest message): ${userMessage.trim()}`
  }
  if (memoryBlock) {
    prompt += `\n\n${memoryBlock}`
  }
  if (context?.sourceTags?.length) {
    prompt += `\n\nContext sources used: ${context.sourceTags.join(', ')}`
  }
  if (context?.fileTree?.length) {
    const treeEntries = context.fileTree
      .slice(0, MAX_CONTEXT_FILE_TREE_ENTRIES)
      .map((entry: AIContextFileTreeEntry) => {
        const suffix = entry.size ? ` (${entry.size} bytes)` : ''
        return `${entry.path}${suffix}`
      })
    prompt += `\n\nProject file tree snapshot:\n- ${treeEntries.join('\n- ')}`
  } else if (context?.files?.length) {
    prompt += `\n\nCurrent project files: ${context.files.join(', ')}`
  }
  if (context?.allowedEditFiles?.length) {
    prompt += `\n\nAllowed edit scope (strict): ${context.allowedEditFiles.join(', ')}`
    prompt +=
      '\nOnly suggest FILE_UPDATE blocks for files in this scope unless the user explicitly asks for multi-file changes.'
  }
  if (context?.pinnedFiles?.length) {
    prompt += `\n\nUser-pinned files: ${context.pinnedFiles.join(', ')}`
  }
  if (context?.selectedFile) {
    prompt += `\n\nPrimary file in focus: ${context.selectedFile}`
  }
  if (context?.selectedRange) {
    prompt += `\n\nPrimary selection range: lines ${context.selectedRange.startLine}-${context.selectedRange.endLine}`
  }
  if (context?.selectedContent) {
    prompt += `\n\nSelected/retrieved file content:\n${context.selectedContent}`
  }
  if (context?.architectureSummary) {
    prompt += `\n\nProject architecture summary:\n${context.architectureSummary}`
  }
  return prompt
}

function normalizeContext(input?: AIStreamContextInput): AIResolvedContext {
  const selectedFile = normalizePath(input?.selectedFile)
  const fileTree = (input?.fileTree || [])
    .map(entry => ({
      path: normalizePath(entry?.path),
      size: typeof entry?.size === 'number' ? entry.size : undefined,
      fileType: typeof entry?.fileType === 'string' ? entry.fileType : undefined
    }))
    .filter(entry => !!entry.path)
    .slice(0, MAX_CONTEXT_FILE_TREE_ENTRIES)

  const fileTreePaths = fileTree.map(entry => entry.path)
  const files = dedupePaths([...(input?.files || []), ...fileTreePaths])
  const pinnedFiles = dedupePaths(input?.pinnedFiles || [])
  const explicitAllowed = dedupePaths(input?.allowedEditFiles || []).slice(0, MAX_ALLOWED_EDIT_FILES)
  const allowedEditFiles = explicitAllowed.length > 0 ? explicitAllowed : selectedFile ? [selectedFile] : []

  const sourceTags: ContextSource[] = []
  if (selectedFile || input?.selectedContent) {
    sourceTags.push('user-selected')
  }
  if (fileTree.length > 0 || files.length > 0) {
    sourceTags.push('user-tree')
  }

  return {
    files,
    fileTree,
    selectedFile,
    selectedContent: typeof input?.selectedContent === 'string' ? input.selectedContent : undefined,
    selectedRange: normalizeRange(input?.selectedRange),
    pinnedFiles,
    allowedEditFiles,
    sourceTags
  }
}

function normalizePath(path?: string): string {
  if (!path || typeof path !== 'string') return ''
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim()
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const path of paths) {
    const next = normalizePath(path)
    if (!next || seen.has(next)) continue
    seen.add(next)
    normalized.push(next)
  }
  return normalized
}

function dedupeSources(sources: ContextSource[]): ContextSource[] {
  return Array.from(new Set(sources))
}

function normalizeRange(range?: AIContextSelectionRange): AIContextSelectionRange | undefined {
  if (!range) return undefined
  const startLine = Number(range.startLine)
  const endLine = Number(range.endLine)
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return undefined
  if (startLine <= 0 || endLine < startLine) return undefined
  return { startLine, endLine }
}

async function getArchitectureSummary(app: any, projectId: string): Promise<string | undefined> {
  try {
    const result = await app.service('architecture').find({
      query: {
        projectId,
        $limit: 1
      }
    })

    const record = result?.data?.[0]
    if (!record) return undefined

    const services = Array.isArray(record.services)
      ? record.services.slice(0, 8).map((service: any) => {
          const routes = Array.isArray(service.routes) ? service.routes.slice(0, 4).join(', ') : ''
          const deps = Array.isArray(service.dependencies) ? service.dependencies.join(', ') : ''
          const routePart = routes ? ` routes: ${routes}` : ''
          const depPart = deps ? ` deps: ${deps}` : ''
          return `- ${service.name}${routePart}${depPart}`
        })
      : []

    const models = Array.isArray(record.models)
      ? record.models.slice(0, 8).map((model: any) => `- ${model.name}`)
      : []

    const routes = Array.isArray(record.routes)
      ? record.routes.slice(0, 12).map((route: any) => `- ${route.method} ${route.path} -> ${route.service}`)
      : []

    const lines: string[] = []
    if (services.length > 0) {
      lines.push('Services:')
      lines.push(...services)
    }
    if (models.length > 0) {
      lines.push('Models:')
      lines.push(...models)
    }
    if (routes.length > 0) {
      lines.push('Routes:')
      lines.push(...routes)
    }

    return lines.length > 0 ? lines.join('\n') : undefined
  } catch {
    return undefined
  }
}

function enforceEditScope(
  updates: Array<{
    filename: string
    action: 'create' | 'modify' | 'delete'
    description: string
    content: string
    language: string
  }>,
  context: AIResolvedContext,
  userMessage: string
): {
  allowed: Array<{
    filename: string
    action: 'create' | 'modify' | 'delete'
    description: string
    content: string
    language: string
  }>
  blocked: Array<{
    filename: string
    action: 'create' | 'modify' | 'delete'
    description: string
    content: string
    language: string
  }>
} {
  if (!context.allowedEditFiles?.length) {
    return { allowed: updates, blocked: [] }
  }

  if (isExplicitMultiFileRequest(userMessage)) {
    return { allowed: updates, blocked: [] }
  }

  const scope = new Set(context.allowedEditFiles.map(path => normalizePath(path)))
  const allowed: typeof updates = []
  const blocked: typeof updates = []

  for (const update of updates) {
    const normalized = normalizePath(update.filename)
    if (scope.has(normalized)) {
      allowed.push(update)
    } else {
      blocked.push(update)
    }
  }

  return { allowed, blocked }
}

function isExplicitMultiFileRequest(message: string): boolean {
  const normalized = message.toLowerCase()
  return /(multiple files|across files|several files|whole project|entire project|project-wide|refactor)/.test(
    normalized
  )
}

function parseFileUpdates(content: string): Array<{
  filename: string
  action: 'create' | 'modify' | 'delete'
  description: string
  content: string
  language: string
}> {
  const updates: any[] = []
  const normalized = content.replace(/\r\n/g, '\n')

  // Accept slightly noisy markdown output while still requiring structured fields.
  const pattern =
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[-*]\s*)?\*{0,2}\s*FILE_UPDATE\s*:\s*(.+?)\s*\*{0,2}\s*\n\s*(?:#{1,6}\s*)?(?:[-*]\s*)?\*{0,2}\s*ACTION\s*:\s*(create|modify|delete)\s*\*{0,2}\s*\n\s*(?:#{1,6}\s*)?(?:[-*]\s*)?\*{0,2}\s*DESCRIPTION\s*:\s*(.+?)\s*\*{0,2}\s*\n```([\w+-]*)\n([\s\S]*?)```/gi

  const clean = (value: string) =>
    value
      .trim()
      .replace(/^\*+|\*+$/g, '')
      .replace(/^`+|`+$/g, '')
      .trim()

  let match
  while ((match = pattern.exec(normalized)) !== null) {
    const rawFilename = clean(match[1])
    const filename = rawFilename
      .replace(/^\[\s*/, '')
      .replace(/\s*\]$/, '')
      .trim()
    const action = clean(match[2]).toLowerCase() as 'create' | 'modify' | 'delete'
    const description = clean(match[3])
    const language = clean(match[4]) || 'text'
    const fileContent = match[5] ?? ''

    if (!filename) continue

    if (action === 'modify' && !SEARCH_REPLACE_BLOCK_PATTERN.test(fileContent)) {
      SEARCH_REPLACE_BLOCK_PATTERN.lastIndex = 0
      continue
    }

    SEARCH_REPLACE_BLOCK_PATTERN.lastIndex = 0

    updates.push({
      filename,
      action,
      description,
      language,
      content: fileContent
    })
  }

  return updates
}

const SEARCH_REPLACE_BLOCK_PATTERN =
  /<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*REPLACE/g
