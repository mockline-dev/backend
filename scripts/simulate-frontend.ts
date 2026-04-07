/**
 * Frontend simulation script — end-to-end flow test against a running backend.
 *
 * Simulates exactly what the frontend does:
 *   1. Register or login
 *   2. Create a project
 *   3. Connect Socket.IO + join project channel
 *   4. Send a user message → watch all orchestration events
 *   5. Verify files were generated with proper names
 *   6. Start a session (run backend)
 *   7. Wait for status: 'running'
 *   8. Hit the API-test proxy
 *   9. Tear down
 *
 * Usage:
 *   pnpm run sim                                    # uses defaults (requires SIM_TOKEN)
 *   SIM_TOKEN=eyJ... pnpm run sim                   # pass existing JWT (recommended)
 *   SIM_TOKEN=eyJ... SIM_USER_ID=abc pnpm run sim   # with known userId
 *   SIM_PROMPT="Build a FastAPI todo app" SIM_TOKEN=eyJ... pnpm run sim
 *   SIM_SKIP_SESSION=1 SIM_TOKEN=eyJ... pnpm run sim  # skip session/proxy steps
 *
 * Get a token: POST /authentication { strategy: 'firebase', idToken: '<firebase_id_token>' }
 * Or copy the accessToken from your browser's network tab after login.
 */

import axios, { type AxiosInstance } from 'axios'
import { io, type Socket } from 'socket.io-client'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL ?? 'http://localhost:3030'
const SIM_TOKEN = process.env.SIM_TOKEN ?? ''           // required: JWT from POST /authentication
const SIM_USER_ID = process.env.SIM_USER_ID ?? ''       // optional: skip /users lookup
const SIM_PROMPT = process.env.SIM_PROMPT ?? 'Create a simple FastAPI todo app with SQLite and basic CRUD'
const SIM_FRAMEWORK = process.env.SIM_FRAMEWORK ?? 'fast-api'
const SIM_LANGUAGE = process.env.SIM_LANGUAGE ?? 'python'
const SKIP_SESSION = !!process.env.SIM_SKIP_SESSION
const GENERATION_TIMEOUT = Number(process.env.SIM_TIMEOUT ?? 120_000)  // 2 min
const SESSION_TIMEOUT = Number(process.env.SIM_SESSION_TIMEOUT ?? 60_000)  // 1 min

// ─── Console helpers ─────────────────────────────────────────────────────────

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', M = '\x1b[35m'
const D = '\x1b[2m', B = '\x1b[1m', RESET = '\x1b[0m'

const ts = () => `${D}[${new Date().toISOString().slice(11, 23)}]${RESET}`

function ok(label: string, detail?: string) {
  console.log(`${ts()} ${G}✓${RESET} ${label}${detail ? `  ${D}${detail}${RESET}` : ''}`)
}
function fail(label: string, detail?: unknown) {
  const msg = detail instanceof Error ? detail.message
    : typeof detail === 'object' ? JSON.stringify(detail)
    : String(detail ?? '')
  console.log(`${ts()} ${R}✗${RESET} ${B}${label}${RESET}  ${D}${msg}${RESET}`)
}
function info(label: string, detail?: string) {
  console.log(`${ts()} ${C}→${RESET} ${label}${detail ? `  ${D}${detail}${RESET}` : ''}`)
}
function warn(label: string, detail?: string) {
  console.log(`${ts()} ${Y}⚠${RESET} ${label}${detail ? `  ${D}${detail}${RESET}` : ''}`)
}
function event(name: string, payload: Record<string, unknown>) {
  const short = JSON.stringify(payload).slice(0, 120)
  console.log(`${ts()} ${M}⚡${RESET} ${B}${name}${RESET}  ${D}${short}${RESET}`)
}
function section(title: string) {
  console.log(`\n${B}${C}── ${title} ──${RESET}`)
}
function banner(title: string) {
  const line = '─'.repeat(60)
  console.log(`\n${B}${line}\n  ${title}\n${line}${RESET}`)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeClient(token?: string): AxiosInstance {
  return axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
}

function waitForEvent<T = any>(
  socket: Socket,
  eventName: string,
  predicate: (data: T) => boolean,
  timeoutMs: number,
  description: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler)
      reject(new Error(`Timeout waiting for ${description} (${timeoutMs}ms)`))
    }, timeoutMs)

    function handler(data: T) {
      if (predicate(data)) {
        clearTimeout(timer)
        socket.off(eventName, handler)
        resolve(data)
      }
    }

    socket.on(eventName, handler)
  })
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function step1_auth(): Promise<{ token: string; userId: string }> {
  section('Step 1 · Authentication')

  // If a token is provided directly, verify it and extract the userId
  if (SIM_TOKEN) {
    info('Using provided SIM_TOKEN', `${SIM_TOKEN.slice(0, 20)}...`)

    if (SIM_USER_ID) {
      ok('Using provided SIM_USER_ID', SIM_USER_ID)
      return { token: SIM_TOKEN, userId: SIM_USER_ID }
    }

    // Decode userId from JWT payload (no verification needed — server will validate)
    try {
      const payload = JSON.parse(Buffer.from(SIM_TOKEN.split('.')[1], 'base64').toString())
      const userId = payload.sub ?? payload.userId ?? payload._id ?? ''
      if (userId) {
        ok('Decoded userId from JWT', userId)
        return { token: SIM_TOKEN, userId }
      }
      warn('Could not decode userId from JWT — set SIM_USER_ID env var')
    } catch {
      warn('Could not parse JWT payload — set SIM_USER_ID env var')
    }

    // Fall back: fetch current user from /users with this token
    try {
      const client = makeClient(SIM_TOKEN)
      const res = await client.get('/users?$limit=1')
      const users = res.data?.data ?? res.data ?? []
      if (users.length > 0) {
        ok('Fetched userId via GET /users', users[0]._id)
        return { token: SIM_TOKEN, userId: users[0]._id }
      }
    } catch (err: any) {
      warn('Could not fetch userId via /users', err?.response?.data?.message ?? err.message)
    }

    fail('Could not determine userId. Set SIM_USER_ID=<your_user_id> env var.')
    process.exit(1)
  }

  // No token provided
  fail(
    'No SIM_TOKEN provided.',
    'The backend uses Firebase auth — local strategy has no passwords in the DB. ' +
    'Get a token by authenticating in the frontend (copy accessToken from network tab) ' +
    'or run: curl -X POST http://localhost:3030/authentication -d \'{"strategy":"firebase","idToken":"<firebase_id_token>"}\' ' +
    'Then re-run: SIM_TOKEN=<token> pnpm run sim'
  )
  process.exit(1)
}

async function step2_createProject(client: AxiosInstance, userId: string): Promise<string> {
  section('Step 2 · Create Project')

  try {
    const res = await client.post('/projects', {
      userId,
      name: `sim-project-${Date.now()}`,
      description: SIM_PROMPT,
      framework: SIM_FRAMEWORK,
      language: SIM_LANGUAGE,
      model: 'llama-3.3-70b-versatile',
      status: 'initializing'
    })
    ok('Project created', `id=${res.data._id}  framework=${res.data.framework}  language=${res.data.language}`)
    return res.data._id
  } catch (err: any) {
    fail('Project creation failed', err?.response?.data ?? err)
    throw err
  }
}

async function step3_connectSocket(token: string, projectId: string): Promise<Socket> {
  section('Step 3 · Socket.IO Connection')

  return new Promise((resolve, reject) => {
    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling']
    })

    const timer = setTimeout(() => reject(new Error('Socket connect timeout (10s)')), 10_000)

    socket.on('connect', () => {
      clearTimeout(timer)
      ok('Connected', `id=${socket.id}`)
      socket.emit('join', `projects/${projectId}`)
      ok('Joined project channel', `projects/${projectId}`)
      resolve(socket)
    })

    socket.on('connect_error', (err) => {
      clearTimeout(timer)
      fail('Socket connect error', err)
      reject(err)
    })
  })
}

async function step4_sendMessageAndWatch(
  client: AxiosInstance,
  socket: Socket,
  projectId: string
): Promise<{ filesGenerated: string[]; intent: string }> {
  section('Step 4 · Send Message & Watch Orchestration')

  // Collect everything
  let tokenCount = 0
  let streamedChars = 0
  const eventsReceived: string[] = []
  let filesGenerated: string[] = []
  let detectedIntent = 'unknown'

  // Attach all listeners before sending
  socket.on('orchestration:started', (d) => {
    event('orchestration:started', d)
    eventsReceived.push('started')
  })
  socket.on('orchestration:intent', (d) => {
    event('orchestration:intent', d)
    eventsReceived.push('intent')
    detectedIntent = d.intent ?? 'unknown'
  })
  socket.on('orchestration:enhanced', (d) => {
    event('orchestration:enhanced', d)
    eventsReceived.push('enhanced')
  })
  socket.on('orchestration:context', (d) => {
    event('orchestration:context', d)
    eventsReceived.push('context')
  })
  socket.on('orchestration:token', (d: { token: string }) => {
    tokenCount++
    streamedChars += (d.token ?? '').length
    if (tokenCount === 1) process.stdout.write(`${ts()} ${M}⚡${RESET} ${B}orchestration:token${RESET}  ${D}streaming`)
    else if (tokenCount % 50 === 0) process.stdout.write('.')
  })
  socket.on('orchestration:completed', (d) => {
    if (tokenCount > 0) console.log(`  (${tokenCount} chunks, ${streamedChars} chars)${RESET}`)
    event('orchestration:completed', d)
    eventsReceived.push('completed')
  })
  socket.on('orchestration:error', (d) => {
    event('orchestration:error', d)
    eventsReceived.push('error')
    fail('Orchestration pipeline error', d.error)
  })
  socket.on('sandbox:started', (d) => { event('sandbox:started', d); eventsReceived.push('sandbox:started') })
  socket.on('sandbox:executing', (d) => { event('sandbox:executing', d) })
  socket.on('sandbox:retry', (d) => { warn(`Sandbox retry attempt ${d.attempt}`, d.error) })
  socket.on('sandbox:result', (d) => {
    event('sandbox:result', d)
    if (!d.success) warn('Sandbox validation failed (pipeline continues)', d.compilationOutput)
  })
  socket.on('sandbox:error', (d) => { warn('Sandbox error (non-fatal)', d.error) })
  socket.on('files:persisted', (d) => {
    event('files:persisted', d)
    filesGenerated = d.filePaths ?? []
    eventsReceived.push('files:persisted')
  })
  socket.on('indexing:completed', (d) => { event('indexing:completed', d) })

  // Send the message
  info('Sending message', `"${SIM_PROMPT.slice(0, 80)}..."`)
  try {
    await client.post('/messages', { projectId, role: 'user', content: SIM_PROMPT })
    ok('Message accepted by REST API')
  } catch (err: any) {
    fail('POST /messages failed', err?.response?.data ?? err)
    throw err
  }

  // Wait for project to reach 'ready' or 'error'
  info(`Waiting for generation to complete (timeout: ${GENERATION_TIMEOUT / 1000}s)...`)

  const finalProject: any = await waitForEvent(
    socket,
    'projects patched',
    (p: any) => p.status === 'ready' || p.status === 'error',
    GENERATION_TIMEOUT,
    "project status 'ready' or 'error'"
  )

  if (finalProject.status === 'error') {
    fail('Project ended in error state', finalProject.errorMessage)
    throw new Error(finalProject.errorMessage ?? 'Generation failed')
  }

  ok('Generation complete', `status=${finalProject.status}  progress=${finalProject.generationProgress?.percentage}%`)
  ok('Events received', eventsReceived.join(' → '))
  ok('Intent classified as', detectedIntent)

  // Verify file names
  section('Step 4b · File Name Verification')
  if (filesGenerated.length === 0) {
    warn('No files were persisted (check if intent was code-generating)')
  } else {
    ok(`${filesGenerated.length} file(s) generated`)
    let badNames = 0
    for (const f of filesGenerated) {
      const isBad = /^file_\d+\.\w+$/.test(f)
      if (isBad) {
        fail(`Bad filename detected: ${f}`, 'Filepath comment was missing from LLM output')
        badNames++
      } else {
        ok(`  ${f}`)
      }
    }
    if (badNames === 0) ok('All filenames look correct')
  }

  // Also fetch via REST to double-check DB records
  try {
    const filesRes = await client.get(`/files?projectId=${projectId}&$sort[name]=1`)
    const dbFiles = filesRes.data?.data ?? filesRes.data ?? []
    ok(`Files in DB: ${dbFiles.length}`, dbFiles.map((f: any) => f.name).join(', '))
  } catch (err: any) {
    warn('Could not fetch /files', err?.response?.data?.message ?? err.message)
  }

  return { filesGenerated, intent: detectedIntent }
}

async function step5_startSession(
  client: AxiosInstance,
  socket: Socket,
  projectId: string,
  userId: string
): Promise<string | null> {
  section('Step 5 · Start Session (Run Backend)')

  if (SKIP_SESSION) {
    warn('Skipping session step (SIM_SKIP_SESSION=1)')
    return null
  }

  // Pre-check: warn if sandbox is not configured (API key empty)
  try {
    // We check by attempting POST and watching the event — but set up the listener FIRST
    // to avoid the race condition where the 'sessions patched' event fires during the
    // after-create hook (before the HTTP response returns)
  } catch { /* ignore */ }

  let sessionId: string

  // ── Set up event listener BEFORE the POST so we never miss a fast 'error' patch ──
  let resolveSessionEvent!: (s: any) => void
  let rejectSessionEvent!: (err: Error) => void
  const sessionEventPromise = new Promise<any>((res, rej) => {
    resolveSessionEvent = res
    rejectSessionEvent = rej
  })

  const sessionTimer = setTimeout(() => {
    rejectSessionEvent(new Error(`Timeout waiting for session status 'running' or 'error' (${SESSION_TIMEOUT / 1000}s)`))
  }, SESSION_TIMEOUT)

  function sessionPatchHandler(s: any) {
    if (sessionId && (s._id === sessionId || s.id === sessionId) &&
        (s.status === 'running' || s.status === 'error')) {
      clearTimeout(sessionTimer)
      socket.off('sessions patched', sessionPatchHandler)
      resolveSessionEvent(s)
    }
  }
  // Attach listener now — before POST
  socket.on('sessions patched', sessionPatchHandler)

  try {
    const res = await client.post('/sessions', {
      projectId,
      userId,
      language: SIM_LANGUAGE
    })
    sessionId = res.data._id
    ok('Session created', `id=${sessionId}  status=${res.data.status}`)

    // Now wire the sessionId into the already-attached handler (needed because
    // sessionId wasn't known when we attached the listener)
    // Also handle the edge case where the event fired before we had sessionId —
    // re-check any buffered data via REST
    const currentSession = await client.get(`/sessions/${sessionId}`).then(r => r.data).catch(() => null)
    if (currentSession && (currentSession.status === 'running' || currentSession.status === 'error')) {
      clearTimeout(sessionTimer)
      socket.off('sessions patched', sessionPatchHandler)
      resolveSessionEvent(currentSession)
    }
  } catch (err: any) {
    clearTimeout(sessionTimer)
    socket.off('sessions patched', sessionPatchHandler)
    const body = err?.response?.data
    fail('POST /sessions failed', body ?? err)
    return null
  }

  info(`Waiting for session to reach 'running' (timeout: ${SESSION_TIMEOUT / 1000}s)...`)

  try {
    const patchedSession: any = await sessionEventPromise

    if (patchedSession.status === 'error') {
      fail('Session ended in error state', patchedSession.errorMessage)
      if (patchedSession.errorMessage?.includes('Sandbox not configured')) {
        warn('Sandbox API key is not configured in config/default.json → sandbox.opensandbox.apiKey')
        warn('Set it up to enable session/execution features')
      }
      return null
    }

    ok('Session running!', `containerId=${patchedSession.containerId}  proxyUrl=${patchedSession.proxyUrl}`)
    return sessionId
  } catch (err) {
    fail('Session never reached running status', err)

    // Fetch current session state for diagnosis
    try {
      const s = await client.get(`/sessions/${sessionId}`)
      info('Current session state (for diagnosis)', JSON.stringify(s.data))
    } catch { /* ignore */ }

    return null
  }
}

async function step6_testProxy(client: AxiosInstance, sessionId: string | null): Promise<void> {
  section('Step 6 · API-Test Proxy')

  if (!sessionId) {
    warn('Skipping proxy test — no running session')
    return
  }

  const testPaths = ['/', '/docs', '/health', '/items', '/users']

  for (const path of testPaths) {
    try {
      const res = await client.get(`/api-test/${sessionId}${path}`)
      ok(`GET ${path}`, `status=${res.status}  body=${JSON.stringify(res.data).slice(0, 80)}`)
      break  // Stop at first success
    } catch (err: any) {
      const status = err?.response?.status
      const body = err?.response?.data
      if (status === 409) {
        fail(`GET ${path} → 409 Session not running`, body?.message)
      } else if (status === 502) {
        warn(`GET ${path} → 502 Container unreachable`, body?.details ?? body?.error)
      } else if (status === 404) {
        info(`GET ${path} → 404 (endpoint doesn't exist in generated app, expected)`)
      } else {
        warn(`GET ${path} → ${status}`, JSON.stringify(body).slice(0, 100))
      }
    }
  }
}

async function step7_cleanup(
  client: AxiosInstance,
  socket: Socket,
  sessionId: string | null,
  projectId: string
): Promise<void> {
  section('Step 7 · Cleanup')

  if (sessionId) {
    try {
      await client.delete(`/sessions/${sessionId}`)
      ok('Session stopped')
    } catch (err: any) {
      warn('Session stop failed (non-fatal)', err?.response?.data?.message ?? err.message)
    }
  }

  try {
    await client.delete(`/projects/${projectId}`)
    ok('Project deleted')
  } catch (err: any) {
    warn('Project deletion failed (non-fatal)', err?.response?.data?.message ?? err.message)
  }

  socket.disconnect()
  ok('Socket disconnected')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Mockline Frontend Simulation')
  console.log(`${D}  API: ${API_URL}`)
  console.log(`  Token: ${SIM_TOKEN ? SIM_TOKEN.slice(0, 20) + '...' : '(none — will fail)'}`)
  console.log(`  Prompt: "${SIM_PROMPT.slice(0, 70)}..."`)
  console.log(`  Framework: ${SIM_FRAMEWORK}  Language: ${SIM_LANGUAGE}${RESET}\n`)

  // Step 1: Auth
  let token: string, userId: string
  try {
    ;({ token, userId } = await step1_auth())
  } catch {
    process.exit(1)
  }

  const client = makeClient(token)

  // Step 2: Create project
  let projectId: string
  try {
    projectId = await step2_createProject(client, userId)
  } catch {
    process.exit(1)
  }

  // Step 3: Connect socket
  let socket: Socket
  try {
    socket = await step3_connectSocket(token, projectId)
  } catch {
    process.exit(1)
  }

  // Step 4: Generate
  let sessionId: string | null = null
  try {
    await step4_sendMessageAndWatch(client, socket, projectId)
  } catch (err) {
    fail('Generation step failed', err)
    await step7_cleanup(client, socket, null, projectId)
    process.exit(1)
  }

  // Step 5: Start session
  sessionId = await step5_startSession(client, socket, projectId, userId)

  // Step 6: Test proxy
  await step6_testProxy(client, sessionId)

  // Step 7: Cleanup
  await step7_cleanup(client, socket, sessionId, projectId)

  // Final summary
  const line = '─'.repeat(60)
  console.log(`\n${B}${line}`)
  console.log(`  Simulation complete`)
  console.log(`${line}${RESET}\n`)
}

main().catch(err => {
  console.error(`\n${R}Fatal:${RESET}`, err.message)
  process.exit(1)
})
