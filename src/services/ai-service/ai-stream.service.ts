import { authenticate } from '@feathersjs/authentication'
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors'
import config from 'config'
import { ProjectMemory } from '../../agent/memory/project-memory'
import { ContextRetriever } from '../../agent/rag/retriever'
import { getProvider } from '../../llm/providers/registry'
import { r2Client } from '../../storage/r2.client'
import { applySearchReplace } from './diff-utils'

const MAX_CONTEXT_FILE_TREE_ENTRIES = 300
const MAX_ALLOWED_EDIT_FILES = 40
const PENDING_UPDATES_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface PendingUpdate {
  filename: string
  action: 'create' | 'modify' | 'delete'
  content: string
  description: string
  language: string
  /** Full new content after applying SEARCH/REPLACE (for modify) or raw content (for create) */
  preview?: string
}

// In-memory pending updates per project: projectId → Map<filename, update>
const pendingUpdates = new Map<string, Map<string, PendingUpdate>>()
const pendingTimers = new Map<string, NodeJS.Timeout>()

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

=== FILE UPDATE FORMAT ===

When suggesting file changes, use this EXACT format:

FILE_UPDATE: [filename]
ACTION: [create|modify|delete]
DESCRIPTION: [brief description of change]
\`\`\`[language]
[For create: complete file content. For modify: ONLY SEARCH/REPLACE blocks]
\`\`\`

=== DETAILED FILE UPDATE INSTRUCTIONS ===

For ACTION: modify:
- ALWAYS use targeted SEARCH/REPLACE blocks. Do not return full-file content for modify.
- Use this block format for targeted modifications:
  <<<<<<< SEARCH
  [exact existing code snippet]
  =======
  [new replacement snippet]
  >>>>>>> REPLACE
- You can include multiple SEARCH/REPLACE blocks in one modify update.
- Each SEARCH/REPLACE block must match the exact existing code (including indentation, whitespace).
- Include enough context in the SEARCH block to make it unique (at least 3-5 lines).
- The SEARCH block must exist exactly as shown in the file.
- The REPLACE block should contain only the changed portion, not the entire file.
- Order SEARCH/REPLACE blocks from top to bottom in the file (earlier changes first).
- For dependency files (such as requirements.txt), preserve existing lines and only change the specific dependency lines requested.
- For config files (.env.example), preserve existing entries and only add/modify requested entries.

For ACTION: create:
- Return the complete file content.
- Include all necessary imports and dependencies.
- Follow the existing code style and patterns in the project.
- Add appropriate docstrings and comments.

For ACTION: delete:
- No code content is needed, just the filename and description.
- Only delete files that are explicitly requested or are clearly obsolete.

=== COMPLEX REFACTOR HANDLING ===

When handling complex refactors:
- Break down large refactors into smaller, manageable steps.
- Use multiple FILE_UPDATE blocks if needed, but keep them logically grouped.
- Maintain backward compatibility when possible:
   * Don't break existing API endpoints without explicit request.
   * Keep old function signatures if they're used elsewhere.
   * Add deprecation warnings if removing functionality.
- Consider the impact on other files:
   * Check if the refactor affects imports in other files.
   * Update all references to renamed/moved code.
   * Update tests if necessary.
- Test the refactor mentally:
   * Will this break existing functionality?
   * Are all imports and dependencies correct?
   * Is the new code consistent with the project patterns?
- Document the changes:
   * Add comments explaining why the refactor was done.
   * Update docstrings if the function signature changes.
   * Note any breaking changes in the description.

=== DEPENDENCY MANAGEMENT UPDATES ===

When updating dependencies:
- For requirements.txt:
   * Use specific version pinning for critical dependencies (e.g., fastapi==0.104.1).
   * Use compatible version ranges for less critical dependencies (e.g., pydantic>=2.0.0,<3.0.0).
   * Preserve existing dependency versions unless explicitly requested to change.
   * Only add new dependencies that are actually needed for the requested changes.
   * Remove dependencies only if they're clearly unused.
   * Keep dependencies alphabetically sorted for readability.
- For other dependency files (package.json, go.mod, etc.):
   * Follow the same principles as requirements.txt.
   * Use the appropriate versioning scheme for the language/framework.
- Consider dependency conflicts:
   * Check if new dependencies conflict with existing ones.
   * Ensure all dependencies are compatible with each other.
   * Update multiple related dependencies together if needed.

=== MULTIPLE FILE CHANGES ===

When handling multiple file changes:
- Order FILE_UPDATE blocks by dependency:
   * Core files first (config, utilities, base classes).
   * Then models and schemas.
   * Then services and business logic.
   * Finally, API routers and controllers.
- Group related changes together:
   * All changes for one feature in consecutive blocks.
   * Keep related files close together in the update sequence.
- Ensure consistency across files:
   * Use the same naming conventions across all files.
   * Maintain consistent error handling patterns.
   * Keep the same code style and formatting.
- Update all affected files:
   * Don't forget to update imports when moving/renaming code.
   * Update tests when changing implementation.
   * Update documentation when changing APIs.
- Consider atomicity:
   * If possible, make changes that can be applied independently.
   * Avoid creating intermediate broken states.
   * Ensure each FILE_UPDATE block is valid on its own.

=== ERROR HANDLING IN UPDATES ===

When implementing error handling:
- Use specific exception types:
   * SQLAlchemyError for database errors.
   * IntegrityError for constraint violations.
   * HTTPException for API errors.
   * ValidationError for input validation errors.
- Provide clear error messages:
   * Be specific about what went wrong.
   * Include helpful context for debugging.
   * Don't expose sensitive information.
- Log errors appropriately:
   * Use appropriate log levels (ERROR, WARNING, INFO).
   * Include context in log messages (user IDs, request IDs).
   * Log the full error details server-side.
- Handle edge cases:
   * Null/None values for optional fields.
   * Empty lists or strings.
   * Invalid input data types.
   * Missing or invalid foreign keys.
- Validate user input:
   * Use Pydantic models for request validation.
   * Add custom validators when needed.
   * Validate relationships and constraints.

=== BACKWARD COMPATIBILITY ===

When maintaining backward compatibility:
- Don't break existing APIs without explicit request:
   * Keep existing endpoint paths.
   * Keep existing request/response formats.
   * Keep existing function signatures.
- Add new features without breaking old ones:
   * Add new endpoints instead of modifying existing ones.
   * Add optional parameters instead of changing required ones.
   * Add new fields to responses without removing old ones.
- Use deprecation warnings when removing functionality:
   * Add warnings in docstrings.
   * Log deprecation notices.
   * Provide migration guidance.
- Consider versioning:
   * Use API versioning if making breaking changes.
   * Document version differences.
   * Provide upgrade guides.

=== TESTING CONSIDERATIONS ===

When making changes, consider testing:
- Write testable code:
   * Keep functions small and focused.
   * Use dependency injection for external dependencies.
   * Avoid hard-coded values.
   * Make business logic separate from I/O operations.
- Consider test scenarios:
   * Happy path (successful operations).
   * Error cases (invalid input, missing data).
   * Edge cases (boundary conditions).
   * Integration cases (multiple components working together).
- Suggest tests when appropriate:
   * Unit tests for business logic.
   * Integration tests for API endpoints.
   * Tests for error handling.
   * Tests for edge cases.
- Update existing tests:
   * Update tests when changing implementation.
   * Add tests for new functionality.
   * Remove tests for removed functionality.

=== GENERAL RULES ===

- EXTREMELY STRICT: Do exactly what is asked, no more, no less.
- EXTREMELY STRICT: DO NOT proactively modify main.py, README.md, or any other files unless the user explicitly asks you to update them. If the user asks to "add a file", ONLY output the new file block, and do NOT output an update to main.py.
- EXTREMELY STRICT: For modify actions, if you output the full file content instead of a SEARCH/REPLACE block, the system will REJECT your answer. You MUST use SEARCH/REPLACE.
- One FILE_UPDATE block per file.
- Only modify files directly required by the request. Do not refactor or touch unrelated files.
- If a file is currently selected, treat it as the primary edit target and avoid changes outside it unless explicitly requested.
- Keep explanations brief and put file update blocks exactly as specified.
- Do not wrap FILE_UPDATE/ACTION/DESCRIPTION labels in markdown formatting.
- Consider the existing project structure.
- Prioritize the user's exact prompt intent and avoid unrelated refactors or formatting-only rewrites.
- Keep edits minimal, safe, and scoped to only what the user requested.
- Reason step-by-step about the smallest safe patch before writing FILE_UPDATE blocks.
- If the user provides logs/errors, diagnose the concrete root cause from those logs first and propose targeted fixes; do not reply with generic clarification prompts.
- Follow FastAPI best practices (Pydantic v2, dependency injection, proper error handling, and minimal safe changes that satisfy the request).
- Maintain consistency with existing code style and patterns.
- Think about the impact of changes on other parts of the system.
- Consider security implications of changes (input validation, authorization, etc.).
- Consider performance implications (database queries, API responses, etc.).`

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
        if (!resolvedContext.selectedContent) {
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
          num_ctx: config.get<number>('ollama.numCtx')
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

          // Emit batch summary
          aiStreamService.emit('file-updates', {
            projectId,
            updates: fileUpdates.map(u => ({ filename: u.filename, action: u.action, description: u.description }))
          })

          // Build pending map for this project and emit per-file diff events
          const projectPending = new Map<string, PendingUpdate>()

          for (const update of fileUpdates) {
            const pending: PendingUpdate = {
              filename: update.filename,
              action: update.action,
              content: update.content,
              description: update.description,
              language: update.language
            }

            if (update.action === 'create') {
              pending.preview = update.content
              aiStreamService.emit('file-diff', {
                projectId,
                action: 'create',
                filename: update.filename,
                newContent: update.content,
                description: update.description
              })
            } else if (update.action === 'modify') {
              // Read current file from R2 and apply SEARCH/REPLACE to build preview
              try {
                const r2Key = `projects/${projectId}/${update.filename}`
                const originalContent = await r2Client.getObject(r2Key)
                const { newContent, hunks, unapplied } = applySearchReplace(originalContent, update.content)
                pending.preview = newContent
                aiStreamService.emit('file-diff', {
                  projectId,
                  action: 'modify',
                  filename: update.filename,
                  hunks,
                  unapplied,
                  preview: newContent,
                  description: update.description
                })
              } catch {
                // File not in R2 yet — emit raw SEARCH/REPLACE content
                pending.preview = update.content
                aiStreamService.emit('file-diff', {
                  projectId,
                  action: 'modify',
                  filename: update.filename,
                  hunks: [],
                  unapplied: [],
                  preview: update.content,
                  description: update.description
                })
              }
            } else if (update.action === 'delete') {
              aiStreamService.emit('file-diff', {
                projectId,
                action: 'delete',
                filename: update.filename,
                description: update.description
              })
            }

            projectPending.set(update.filename, pending)
          }

          // Store pending updates with TTL
          pendingUpdates.set(projectId, projectPending)
          const existingTimer = pendingTimers.get(projectId)
          if (existingTimer) clearTimeout(existingTimer)
          pendingTimers.set(
            projectId,
            setTimeout(() => {
              pendingUpdates.delete(projectId)
              pendingTimers.delete(projectId)
            }, PENDING_UPDATES_TTL_MS)
          )
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
      },

      // patch handles apply / accept / reject / accept-all actions
      async patch(
        _id: null,
        data: {
          action: 'apply' | 'accept' | 'reject' | 'accept-all'
          projectId: string
          filename?: string
          updates?: Array<{ filename: string; action: 'create' | 'modify' | 'delete'; content: string; description?: string; language?: string }>
        },
        params: any
      ) {
        const { action, projectId } = data
        if (!projectId) throw new BadRequest('projectId is required')

        const userId = params.user?._id?.toString?.()
        let project: any
        try {
          project = await app.service('projects').get(projectId)
        } catch {
          throw new NotFound('Project not found')
        }
        if (project.userId?.toString?.() !== userId) throw new Forbidden('Not your project')

        const aiStreamService = app.service('ai-stream')

        if (action === 'apply') {
          if (!Array.isArray(data.updates) || data.updates.length === 0) {
            throw new BadRequest('updates array is required for apply action')
          }
          for (const upd of data.updates) {
            await applyUpdateToProject(app, projectId, upd, aiStreamService)
          }
          return { success: true, applied: data.updates.length }
        }

        if (action === 'accept') {
          const { filename } = data
          if (!filename) throw new BadRequest('filename is required for accept action')
          const pending = pendingUpdates.get(projectId)?.get(filename)
          if (!pending) throw new NotFound(`No pending update for file: ${filename}`)
          await applyUpdateToProject(app, projectId, pending, aiStreamService)
          pendingUpdates.get(projectId)?.delete(filename)
          return { success: true, filename }
        }

        if (action === 'reject') {
          const { filename } = data
          if (!filename) throw new BadRequest('filename is required for reject action')
          pendingUpdates.get(projectId)?.delete(filename)
          aiStreamService.emit('file-rejected', { projectId, filename })
          return { success: true, filename }
        }

        if (action === 'accept-all') {
          const pending = pendingUpdates.get(projectId)
          if (!pending || pending.size === 0) return { success: true, applied: 0 }
          const filenames = Array.from(pending.keys())
          for (const filename of filenames) {
            const upd = pending.get(filename)!
            await applyUpdateToProject(app, projectId, upd, aiStreamService)
            pending.delete(filename)
          }
          return { success: true, applied: filenames.length }
        }

        throw new BadRequest(`Unknown action: ${action}`)
      }
    },
    {
      methods: ['create', 'patch'],
      events: ['chunk', 'file-updates', 'agent-step', 'write-preview', 'file-diff', 'file-applied', 'file-rejected']
    }
  )

  app.service('ai-stream').hooks({
    before: {
      create: [authenticate('jwt')],
      patch: [authenticate('jwt')]
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

/**
 * Applies a single pending update to the project:
 * - Writes/overwrites the file in R2
 * - Upserts the file record in MongoDB
 * - Emits 'file-applied' event
 */
async function applyUpdateToProject(
  app: any,
  projectId: string,
  update: { filename: string; action: 'create' | 'modify' | 'delete'; content: string; preview?: string; description?: string },
  aiStreamService: any
): Promise<void> {
  const { filename, action } = update
  const r2Key = `projects/${projectId}/${filename}`

  try {
    if (action === 'delete') {
      await r2Client.deleteObject(r2Key)
      // Remove file record from MongoDB
      const existing = await app.service('files').find({ query: { projectId, key: r2Key, $limit: 1 } }) as any
      if (existing.total > 0) {
        await app.service('files').remove(existing.data[0]._id)
      }
      aiStreamService.emit('file-applied', { projectId, filename, action, success: true })
      return
    }

    // For create: use raw content. For modify: prefer the pre-computed preview.
    let finalContent: string
    if (action === 'modify') {
      if (update.preview) {
        finalContent = update.preview
      } else {
        // Apply SEARCH/REPLACE live if no preview was pre-computed
        try {
          const original = await r2Client.getObject(r2Key)
          finalContent = applySearchReplace(original, update.content).newContent
        } catch {
          finalContent = update.content
        }
      }
    } else {
      finalContent = update.content
    }

    await r2Client.putObject(r2Key, finalContent)
    const size = Buffer.byteLength(finalContent)

    // Upsert file record
    const existing = await app.service('files').find({ query: { projectId, key: r2Key, $limit: 1 } }) as any
    if (existing.total > 0) {
      await app.service('files').patch(existing.data[0]._id, { size, updatedAt: Date.now() })
    } else {
      await app.service('files').create({
        projectId,
        name: filename,
        key: r2Key,
        fileType: filename.split('.').pop() || 'text',
        size
      })
    }

    aiStreamService.emit('file-applied', { projectId, filename, action, success: true })
  } catch (err: any) {
    aiStreamService.emit('file-applied', { projectId, filename, action, success: false, error: err.message })
    throw err
  }
}
