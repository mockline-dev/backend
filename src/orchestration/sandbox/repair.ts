import { createModuleLogger } from '../../logging'
import { orchestrate } from '../pipeline/orchestrator'
import { persistFiles } from '../pipeline/persist-files'
import { createRouter } from '../providers/router'
import { GroqProvider } from '../providers/groq.provider'
import { getVectorStore } from '../rag/chroma.client'
import { extractCodeBlocks } from './code-extractor'
import { startProjectExecution, stopProjectExecution } from './execution'
import { r2Client } from '../../storage/r2.client'
import { sessionsPath } from '../../services/sessions/sessions.shared'

const log = createModuleLogger('sandbox-repair')

type EmitFn = (event: string, projectId: string, payload: unknown) => void

/**
 * Reads all current project files from R2 and formats them as fenced code blocks
 * so the LLM can see exactly what it generated before.
 */
async function readProjectFilesFromR2(projectId: string): Promise<string> {
  try {
    const objects = await r2Client.listObjects(`projects/${projectId}/`)
    if (objects.length === 0) return '(no files found in storage)'

    const fileParts: string[] = []
    for (const obj of objects.slice(0, 20)) {
      try {
        const stream = await r2Client.getObject(obj.key)
        if (!stream) continue
        const chunks: Buffer[] = []
        for await (const chunk of stream as any) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const content = Buffer.concat(chunks).toString('utf8')
        const relativePath = obj.key.replace(`projects/${projectId}/`, '')
        const ext = relativePath.split('.').pop() ?? 'txt'
        // Truncate very large files to keep prompt manageable
        const truncated = content.length > 4000 ? content.slice(0, 4000) + '\n... (truncated)' : content
        fileParts.push(`\`\`\`${ext}\n# filepath: ${relativePath}\n${truncated}\n\`\`\``)
      } catch { /* skip unreadable files */ }
    }
    return fileParts.join('\n\n')
  } catch (err: unknown) {
    log.warn('Failed to read project files from R2', { projectId, error: err instanceof Error ? err.message : String(err) })
    return '(could not read project files)'
  }
}

function buildRepairPrompt(serverLog: string, projectFiles: string): string {
  return `The backend server you generated failed to start. Please fix the code.

SERVER STARTUP LOG:
\`\`\`
${serverLog.slice(-2000)}
\`\`\`

CURRENT PROJECT FILES:
${projectFiles}

Fix the server startup failure. Common causes:
- Server not binding to 0.0.0.0 — must use host="0.0.0.0", not "127.0.0.1"
- Missing package in requirements.txt that is imported in the code
- Wrong PyPI package name (e.g. PyJWT not jwt, python-dotenv not dotenv, PyYAML not yaml)
- Runtime crash — use os.environ.get("PORT", 8000) with defaults (no .env file in sandbox)
- Wrong uvicorn module reference — module path must match the file's location

Return only the files that need to change. Provide complete file contents with filepath comments.`
}

export interface RepairParams {
  sessionId: string
  session: any
  failedSandbox: any
  serverLog: string
  app: any
  emit: EmitFn
  activeSandboxes: Map<string, any>
  maxAttempts: number
}

/**
 * Execution-time self-healing loop.
 *
 * When a server fails to start in the execution sandbox, this function:
 *  1. Reads current project files from R2
 *  2. Builds a fix prompt (server log + all files)
 *  3. Calls orchestrate() to get LLM-generated fix
 *  4. Persists fixed files back to R2
 *  5. Kills failed sandbox, restarts execution
 *  6. Repeats up to maxAttempts
 */
export async function repairExecutionSandbox(params: RepairParams): Promise<void> {
  const { sessionId, session, failedSandbox, serverLog, app, emit, activeSandboxes, maxAttempts } = params
  const projectId = session.projectId.toString()
  const sandboxConfig = app.get('sandbox')
  const llmConfig = app.get('llm')

  // Kill the failed sandbox immediately
  activeSandboxes.delete(sessionId)
  await stopProjectExecution(failedSandbox)

  let currentServerLog = serverLog

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info('Starting execution repair attempt', { sessionId, projectId, attempt, maxAttempts })

    emit('terminal:stdout', projectId, {
      phase: 'repair',
      text: `\n\x1b[33m[Auto-repair ${attempt}/${maxAttempts}]\x1b[0m Server failed to start — asking AI to fix the code...\n`
    })

    // Mark session as repairing so frontend shows appropriate state
    await app.service(sessionsPath).patch(sessionId, {
      status: 'repairing',
      errorMessage: `Auto-repair in progress (attempt ${attempt}/${maxAttempts})`
    }).catch(() => {})

    try {
      // Read current project files from R2 to include in fix prompt
      const projectFiles = await readProjectFilesFromR2(projectId)

      // Build repair prompt and call LLM
      const repairPrompt = buildRepairPrompt(currentServerLog, projectFiles)

      const router = createRouter(app)
      const classifierProvider = new GroqProvider({
        apiKey: llmConfig.groq.apiKey,
        defaultModel: llmConfig.groq.classifierModel
      })
      const vectorStore = getVectorStore(app)

      emit('terminal:stdout', projectId, {
        phase: 'repair',
        text: `[Auto-repair ${attempt}/${maxAttempts}] Generating fix...\n`
      })

      const fixResult = await orchestrate(
        {
          projectId,
          userId: session.userId.toString(),
          prompt: repairPrompt,
          conversationHistory: []
        },
        {
          router,
          classifierProvider,
          classifierModel: llmConfig.groq.classifierModel,
          vectorStore,
          app,
          emit
        }
      )

      const newFiles = extractCodeBlocks(fixResult.content)
      if (newFiles.length === 0) {
        log.warn('LLM repair returned no code files', { sessionId, attempt })
        emit('terminal:stdout', projectId, {
          phase: 'repair',
          text: `[Auto-repair ${attempt}/${maxAttempts}] LLM did not return any code files.\n`
        })
        continue
      }

      // Persist fixed files to R2 (upsert — only changes what the LLM returned)
      emit('terminal:stdout', projectId, {
        phase: 'repair',
        text: `[Auto-repair ${attempt}/${maxAttempts}] Applying ${newFiles.length} fixed file(s)...\n`
      })
      await persistFiles(projectId, newFiles, null, app)

      // Restart execution sandbox with updated files
      emit('terminal:stdout', projectId, {
        phase: 'repair',
        text: `[Auto-repair ${attempt}/${maxAttempts}] Restarting server...\n`
      })

      const execResult = await startProjectExecution(projectId, session.language, sandboxConfig, emit)
      activeSandboxes.set(sessionId, execResult.sandbox)

      if (execResult.serverReady) {
        log.info('Execution repair succeeded', { sessionId, projectId, attempt })
        emit('terminal:stdout', projectId, {
          phase: 'repair',
          text: `\x1b[32m[Auto-repair ${attempt}/${maxAttempts}] Server is running!\x1b[0m\n`
        })

        await app.service(sessionsPath).patch(sessionId, {
          status: 'running',
          containerId: execResult.containerId,
          proxyUrl: execResult.proxyUrl,
          endpointHeaders: execResult.endpointHeaders,
          port: execResult.port,
          serverLog: execResult.serverLog.slice(-2000),
          startedAt: Date.now(),
          errorMessage: undefined
        }).catch(() => {})

        await app.service('projects').patch(projectId, { status: 'running' }).catch(() => {})
        return
      }

      // Server still failed — update log and loop
      log.warn('Repair attempt did not fix server startup', { sessionId, attempt })
      currentServerLog = execResult.serverLog

      // Kill this sandbox before next attempt
      activeSandboxes.delete(sessionId)
      await stopProjectExecution(execResult.sandbox)

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Repair attempt threw', { sessionId, attempt, error: message })
      emit('terminal:stdout', projectId, {
        phase: 'repair',
        text: `[Auto-repair ${attempt}/${maxAttempts}] Error: ${message}\n`
      })
    }
  }

  // All attempts exhausted
  log.error('All execution repair attempts exhausted', { sessionId, projectId, maxAttempts })
  emit('terminal:stdout', projectId, {
    phase: 'repair',
    text: `\x1b[31m[Auto-repair] Could not fix the server after ${maxAttempts} attempt(s). See errors above.\x1b[0m\n`
  })

  await app.service(sessionsPath).patch(sessionId, {
    status: 'error',
    serverLog: currentServerLog.slice(-2000),
    errorMessage: `Server failed to start after ${maxAttempts} auto-repair attempt(s). Check the terminal for details.`
  }).catch(() => {})
}
