import { createModuleLogger } from '../../logging'
import { persistFiles } from '../pipeline/persist-files'
import { createRouter } from '../providers/router'
import { extractCodeBlocks } from './code-extractor'
import { startProjectExecution, stopProjectExecution } from './execution'
import type { HealthCheckFailure } from './execution'
import { r2Client } from '../../storage/r2.client'
import { sessionsPath } from '../../services/sessions/sessions.shared'
import type { LLMMessage } from '../types'

const log = createModuleLogger('sandbox-repair')

type EmitFn = (event: string, projectId: string, payload: unknown) => void

// ─── System prompt for repair LLM call ────────────────────────────────────────
// Bypasses orchestrate() entirely — no intent classification, no RAG, no prompt
// enhancement. We know exactly what we need: fix the startup failure.

const REPAIR_SYSTEM_PROMPT = `You are debugging a server startup failure.

YOUR TASK:
1. Read the server log to identify why the server failed to start
2. Fix only what is broken — do not restructure the project
3. Return ALL project files using the EXACT SAME file paths as provided — do not rename or move files

RUNTIME REQUIREMENTS:
- Server MUST bind to 0.0.0.0 on port 8000 (read from PORT env var with default)
- FastAPI: uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
- Flask: app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
- Always use os.environ.get("PORT", 8000) — there is no .env file in the sandbox
- Every import must have a matching entry in requirements.txt

DATABASE CONSTRAINT:
- The sandbox has NO external database — if you see a DB connection error, switch to SQLite
- SQLAlchemy: change DATABASE_URL to "sqlite:///./app.db", remove psycopg2/pg from requirements.txt
- Plain sqlite3 is in Python stdlib — import sqlite3 (no requirements.txt entry needed)
- NEVER use psycopg2, pg, mysql-connector-python, pymongo, motor, asyncpg, redis

DEPENDENCY RULES:
- Use bare package names in requirements.txt (e.g. "fastapi", not "fastapi==0.99")
- Correct name mappings: jwt→PyJWT, dotenv→python-dotenv, yaml→PyYAML, bs4→beautifulsoup4
- For Python packages with subdirectories (models/, routes/, schemas/, etc.), ALWAYS include an empty __init__.py in each package directory

CODE OUTPUT FORMAT:
- Wrap each file in a fenced code block with the correct language identifier
- The FIRST LINE inside EVERY code block MUST be a filepath comment:
  Python/Shell/YAML: # filepath: path/to/file.ext
  JavaScript/TypeScript: // filepath: path/to/file.ext
- Use the EXACT SAME file paths as shown in the current files below
- Return EVERY file in the project (complete contents, not diffs)`

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads all project files from R2 and returns:
 *   - `files`: array of { path, content } for stale-cleanup comparison
 *   - `prompt`: formatted as fenced code blocks for the LLM prompt
 *
 * Strips any existing `# filepath:` first-line comment from the content before
 * re-adding it as the code block header — prevents the double-comment bug that
 * caused the LLM to generate duplicate/renamed files.
 */
async function readProjectFilesFromR2(
  projectId: string
): Promise<{ files: { path: string; content: string }[]; prompt: string }> {
  const objects = await r2Client.listObjects(`projects/${projectId}/`)
  if (objects.length === 0) {
    return { files: [], prompt: '(no files found in storage)' }
  }

  const files: { path: string; content: string }[] = []
  const fileParts: string[] = []

  for (const obj of objects.slice(0, 20)) {
    try {
      // r2Client.getObject returns a string directly — no stream iteration needed
      const content = await r2Client.getObject(obj.key)
      const relativePath = obj.key.replace(`projects/${projectId}/`, '')

      // Strip the leading # filepath: line if present — we add our own header below.
      // Without this, the prompt would contain double filepath comments like:
      //   ```py
      //   # filepath: main.py   ← our header
      //   # filepath: main.py   ← already in file content
      //   from fastapi import FastAPI
      const lines = content.split('\n')
      const hasFilepathLine = /^(?:#|\/\/|<!--)\s*filepath:/i.test(lines[0]?.trim() ?? '')
      const cleanContent = hasFilepathLine ? lines.slice(1).join('\n') : content

      files.push({ path: relativePath, content })

      const ext = relativePath.split('.').pop() ?? 'txt'
      const truncated =
        cleanContent.length > 3000 ? cleanContent.slice(0, 3000) + '\n... (truncated)' : cleanContent
      fileParts.push(`\`\`\`${ext}\n# filepath: ${relativePath}\n${truncated}\n\`\`\``)
    } catch {
      /* skip unreadable files */
    }
  }

  return { files, prompt: fileParts.join('\n\n') }
}

/**
 * Delete R2 files that were present before repair but were effectively renamed
 * by the LLM (same base filename, different directory path).
 *
 * Only deletes a file when a new file with the same base name exists at a
 * different path — this is a rename, not an omission. Files the LLM simply
 * didn't return (unchanged files) are left in R2.
 */
async function cleanupRenamedFiles(
  projectId: string,
  oldFiles: { path: string; content: string }[],
  newFiles: { path: string; content?: string }[]
): Promise<void> {
  const oldPaths = new Set(oldFiles.map(f => f.path))
  const newPaths = new Set(newFiles.map(f => f.path))

  // Find paths that appear in newFiles but not in oldFiles (potential renames)
  const addedPaths = [...newPaths].filter(p => !oldPaths.has(p))

  for (const addedPath of addedPaths) {
    const baseName = addedPath.split('/').pop()!
    // Find an old file with the same base name at a different path
    const staleCounterpart = [...oldPaths].find(
      p => p.split('/').pop() === baseName && p !== addedPath
    )
    if (staleCounterpart) {
      log.info('Deleting stale renamed file from R2', {
        projectId,
        from: staleCounterpart,
        to: addedPath
      })
      await r2Client.deleteObject(`projects/${projectId}/${staleCounterpart}`).catch((err: unknown) => {
        log.warn('Failed to delete stale R2 file', {
          projectId,
          key: `projects/${projectId}/${staleCounterpart}`,
          error: err instanceof Error ? err.message : String(err)
        })
      })
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RepairParams {
  sessionId: string
  session: any
  failedSandbox: any
  serverLog: string
  failureType?: HealthCheckFailure
  app: any
  emit: EmitFn
  activeSandboxes: Map<string, any>
  maxAttempts: number
}

function getFailureDiagnostic(failureType?: HealthCheckFailure): string {
  switch (failureType) {
    case 'port_never_opened':
      return 'DIAGNOSTIC: The server process died before binding to the port — likely an import error or syntax error.\nFocus: imports, module names, requirements.txt correctness.\n\n'
    case 'process_crashed':
      return 'DIAGNOSTIC: The server process is alive but never opened port 8000 — it may be hanging on a blocking call, waiting for a DB connection, or crashing silently before binding.\nFocus: switch to SQLite if any DB connection errors, add missing __init__.py in package directories, fix import errors, remove blocking initialization code.\n\n'
    case 'http_not_serving':
      return 'DIAGNOSTIC: The port is open but the server is not responding to HTTP — likely a binding or routing issue.\nFocus: app binding address (must be 0.0.0.0), route configuration.\n\n'
    case 'timeout':
      return 'DIAGNOSTIC: The server timed out during startup.\nFocus: blocking calls, heavy initialization, slow imports.\n\n'
    default:
      return ''
  }
}

/**
 * Execution-time self-healing loop.
 *
 * When a server fails to start in the execution sandbox:
 *  1. Reads current project files from R2 (stripped of duplicate filepath comments)
 *  2. Calls the LLM DIRECTLY (bypassing orchestrate() to avoid intent misclassification)
 *  3. Cleans up any renamed R2 files to prevent stale duplicates in the workspace
 *  4. Persists fixed files to R2
 *  5. Kills failed sandbox, restarts execution
 *  6. Repeats up to maxAttempts
 */
export async function repairExecutionSandbox(params: RepairParams): Promise<void> {
  const { sessionId, session, failedSandbox, serverLog, failureType, app, emit, activeSandboxes, maxAttempts } = params
  const projectId = session.projectId.toString()
  const sandboxConfig = app.get('sandbox')

  // Kill the failed sandbox immediately
  activeSandboxes.delete(sessionId)
  await stopProjectExecution(failedSandbox)

  let currentServerLog = serverLog

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info('Starting execution repair attempt', { sessionId, projectId, attempt, maxAttempts })

    emit('terminal:stdout', projectId, {
      phase: 'repair',
      text: `\n\x1b[33m[Auto-repair ${attempt}/${maxAttempts}]\x1b[0m Server failed — asking AI to fix the code...\n`
    })

    await app
      .service(sessionsPath)
      .patch(sessionId, {
        status: 'repairing',
        errorMessage: `Auto-repair in progress (attempt ${attempt}/${maxAttempts})`
      })
      .catch(() => {})

    try {
      // ── Step 1: Read project files from R2 ──────────────────────────────────
      const { files: existingFiles, prompt: projectFilesPrompt } = await readProjectFilesFromR2(projectId)

      if (existingFiles.length === 0) {
        log.warn('No project files found in R2, cannot repair', { sessionId })
        emit('terminal:stdout', projectId, {
          phase: 'repair',
          text: `[Auto-repair ${attempt}/${maxAttempts}] No project files found — cannot repair.\n`
        })
        break
      }

      // ── Step 2: Call LLM directly (no orchestrate overhead) ─────────────────
      // Bypassing orchestrate() avoids:
      //   - Intent misclassification (long prompts with code ≈ GenerateProject)
      //   - Unnecessary RAG retrieval
      //   - Prompt enhancement that could distort the fix request
      //   - Spurious orchestration:* socket events on the project

      emit('terminal:stdout', projectId, {
        phase: 'repair',
        text: `[Auto-repair ${attempt}/${maxAttempts}] Generating fix (${existingFiles.length} files)...\n`
      })

      const router = createRouter(app)
      const failureDiagnostic = getFailureDiagnostic(failureType)
      const messages: LLMMessage[] = [
        { role: 'system', content: REPAIR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${failureDiagnostic}SERVER STARTUP LOG:\n\`\`\`\n${currentServerLog.slice(-2000)}\n\`\`\`\n\nCURRENT PROJECT FILES:\n${projectFilesPrompt}\n\nFix the server startup failure and return ALL files with the exact same file paths.`
        }
      ]

      let fullContent = ''
      for await (const chunk of router.chatStream(messages)) {
        if (chunk.content) fullContent += chunk.content
      }

      // ── Step 3: Extract files from LLM response ──────────────────────────────
      const newFiles = extractCodeBlocks(fullContent)
      if (newFiles.length === 0) {
        log.warn('LLM repair returned no code files', { sessionId, attempt })
        emit('terminal:stdout', projectId, {
          phase: 'repair',
          text: `[Auto-repair ${attempt}/${maxAttempts}] LLM did not return any code files.\n`
        })
        continue
      }

      log.info('LLM repair generated files', {
        sessionId,
        attempt,
        files: newFiles.map(f => f.path)
      })

      // ── Step 4: Clean up renamed R2 files before persisting ─────────────────
      // Prevents the workspace from having both `main.py` and `src/main.py`
      // when the LLM moved the entry point to a subdirectory.
      await cleanupRenamedFiles(projectId, existingFiles, newFiles)

      // ── Step 5: Persist fixed files to R2 ───────────────────────────────────
      emit('terminal:stdout', projectId, {
        phase: 'repair',
        text: `[Auto-repair ${attempt}/${maxAttempts}] Applying ${newFiles.length} fixed file(s): ${newFiles.map(f => f.path).join(', ')}\n`
      })
      await persistFiles(projectId, newFiles, null, app)

      // ── Step 6: Restart execution sandbox ───────────────────────────────────
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

        await app
          .service(sessionsPath)
          .patch(sessionId, {
            status: 'running',
            containerId: execResult.containerId,
            proxyUrl: execResult.proxyUrl,
            endpointHeaders: execResult.endpointHeaders,
            port: execResult.port,
            serverLog: execResult.serverLog.slice(-2000),
            startedAt: Date.now(),
            errorMessage: ''  // clear any previous repair error message
          })
          .catch(() => {})

        await app.service('projects').patch(projectId, { status: 'running' }).catch(() => {})
        return
      }

      // Server still failed — update log and try again
      log.warn('Repair attempt did not fix server startup', { sessionId, attempt })
      currentServerLog = execResult.serverLog

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

  await app
    .service(sessionsPath)
    .patch(sessionId, {
      status: 'error',
      serverLog: currentServerLog.slice(-2000),
      errorMessage: `Server failed to start after ${maxAttempts} auto-repair attempt(s). Check the terminal for details.`
    })
    .catch(() => {})
}
