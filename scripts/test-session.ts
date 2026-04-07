/**
 * Session lifecycle smoke test — start session → running → proxy → cleanup.
 *
 * Tests the session flow independently of code generation:
 *   1. Authenticate (requires SIM_TOKEN)
 *   2. Use existing project (SIM_PROJECT_ID) or create a minimal one
 *   3. Connect Socket.IO + join project channel
 *   4. POST /sessions → wait for status 'running' via socket event
 *   5. Verify session fields (containerId, proxyUrl, endpoint headers)
 *   6. Hit the API-test proxy on common paths
 *   7. Cleanup (stop session, optionally delete project)
 *
 * Usage:
 *   SIM_TOKEN=eyJ... pnpm run test:session
 *   SIM_TOKEN=eyJ... SIM_PROJECT_ID=<id> pnpm run test:session   # skip project creation
 *   SIM_TOKEN=eyJ... SIM_LANGUAGE=python pnpm run test:session
 *
 * Env vars:
 *   SIM_TOKEN        required — JWT from POST /authentication
 *   SIM_USER_ID      optional — skip /users lookup
 *   SIM_PROJECT_ID   optional — use existing project (skips creation + deletion)
 *   SIM_LANGUAGE     optional — language for the session (default: python)
 *   API_URL          optional — backend URL (default: http://localhost:3030)
 *   SIM_SESSION_TIMEOUT  optional — ms to wait for session 'running' (default: 90000)
 */

import axios, { type AxiosInstance } from 'axios'
import { io, type Socket } from 'socket.io-client'

// ─── Config ───────────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL ?? 'http://localhost:3030'
const SIM_TOKEN = process.env.SIM_TOKEN ?? ''
const SIM_USER_ID = process.env.SIM_USER_ID ?? ''
const SIM_PROJECT_ID = process.env.SIM_PROJECT_ID ?? ''   // if set, skip create + delete
const SIM_LANGUAGE = process.env.SIM_LANGUAGE ?? 'python'
const SESSION_TIMEOUT = Number(process.env.SIM_SESSION_TIMEOUT ?? 90_000)

// ─── Console helpers ──────────────────────────────────────────────────────────

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', M = '\x1b[35m'
const D = '\x1b[2m', B = '\x1b[1m', RESET = '\x1b[0m'

const ts = () => `${D}[${new Date().toISOString().slice(11, 23)}]${RESET}`

let passCount = 0, failCount = 0, warnCount = 0

function ok(label: string, detail?: string) {
  passCount++
  console.log(`${ts()} ${G}✓${RESET} ${label}${detail ? `  ${D}${detail}${RESET}` : ''}`)
}
function fail(label: string, detail?: unknown) {
  failCount++
  const msg = detail instanceof Error ? detail.message
    : typeof detail === 'object' ? JSON.stringify(detail)
    : String(detail ?? '')
  console.log(`${ts()} ${R}✗${RESET} ${B}${label}${RESET}  ${D}${msg}${RESET}`)
}
function info(label: string, detail?: string) {
  console.log(`${ts()} ${C}→${RESET} ${label}${detail ? `  ${D}${detail}${RESET}` : ''}`)
}
function warn(label: string, detail?: string) {
  warnCount++
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(token?: string): AxiosInstance {
  return axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
}

// ─── Step 1: Auth ─────────────────────────────────────────────────────────────

async function step1_auth(): Promise<{ token: string; userId: string }> {
  section('Step 1 · Authentication')

  if (!SIM_TOKEN) {
    fail(
      'No SIM_TOKEN provided.',
      'Get a token from the frontend (copy accessToken from network tab) ' +
      'then run: SIM_TOKEN=<token> pnpm run test:session'
    )
    process.exit(1)
  }

  info('Using provided SIM_TOKEN', `${SIM_TOKEN.slice(0, 20)}...`)

  if (SIM_USER_ID) {
    ok('Using provided SIM_USER_ID', SIM_USER_ID)
    return { token: SIM_TOKEN, userId: SIM_USER_ID }
  }

  // Decode userId from JWT
  try {
    const payload = JSON.parse(Buffer.from(SIM_TOKEN.split('.')[1], 'base64').toString())
    const userId = payload.sub ?? payload.userId ?? payload._id ?? ''
    if (userId) {
      ok('Decoded userId from JWT', userId)
      return { token: SIM_TOKEN, userId }
    }
  } catch { /* fall through */ }

  // Fetch via /users
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

// ─── Step 2: Project ──────────────────────────────────────────────────────────

async function step2_project(
  client: AxiosInstance,
  userId: string
): Promise<{ projectId: string; ownedByUs: boolean }> {
  section('Step 2 · Project')

  if (SIM_PROJECT_ID) {
    info('Using existing project', SIM_PROJECT_ID)
    try {
      const res = await client.get(`/projects/${SIM_PROJECT_ID}`)
      ok('Project found', `name=${res.data.name}  status=${res.data.status}`)
    } catch (err: any) {
      warn('Could not fetch project details', err?.response?.data?.message ?? err.message)
    }
    return { projectId: SIM_PROJECT_ID, ownedByUs: false }
  }

  // Create a minimal project (no generation needed — just to have a valid projectId)
  try {
    const res = await client.post('/projects', {
      userId,
      name: `session-test-${Date.now()}`,
      description: 'Minimal project for session smoke test',
      framework: 'fast-api',
      language: SIM_LANGUAGE,
      model: 'llama-3.3-70b-versatile',
      status: 'ready'   // mark ready so session creation is not blocked
    })
    ok('Project created', `id=${res.data._id}  status=${res.data.status}`)
    return { projectId: res.data._id, ownedByUs: true }
  } catch (err: any) {
    fail('Project creation failed', err?.response?.data ?? err)
    throw err
  }
}

// ─── Step 3: Socket.IO ────────────────────────────────────────────────────────

async function step3_connectSocket(token: string, projectId: string): Promise<Socket> {
  section('Step 3 · Socket.IO Connection')

  return new Promise((resolve, reject) => {
    const socket = io(API_URL, {
      auth: { accessToken: token },
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

// ─── Step 4: Start Session ────────────────────────────────────────────────────

async function step4_startSession(
  client: AxiosInstance,
  socket: Socket,
  projectId: string,
  userId: string
): Promise<string | null> {
  section('Step 4 · Start Session')

  let sessionId!: string

  // Set up event listener BEFORE POST to avoid race condition
  let resolveEvent!: (s: any) => void
  let rejectEvent!: (err: Error) => void
  const eventPromise = new Promise<any>((res, rej) => {
    resolveEvent = res
    rejectEvent = rej
  })

  const timer = setTimeout(
    () => rejectEvent(new Error(`Timeout waiting for session 'running' or 'error' (${SESSION_TIMEOUT / 1000}s)`)),
    SESSION_TIMEOUT
  )

  function patchHandler(s: any) {
    if (sessionId && (s._id === sessionId || s.id === sessionId) &&
        (s.status === 'running' || s.status === 'error')) {
      clearTimeout(timer)
      socket.off('sessions patched', patchHandler)
      resolveEvent(s)
    }
  }
  socket.on('sessions patched', patchHandler)

  // Also listen for any session-related socket events for diagnostics
  socket.on('sessions created', (d: any) => event('sessions created', d))

  try {
    info('POST /sessions', `projectId=${projectId}  language=${SIM_LANGUAGE}`)
    const res = await client.post('/sessions', {
      projectId,
      userId,
      language: SIM_LANGUAGE
    })
    sessionId = res.data._id
    ok('Session created', `id=${sessionId}  status=${res.data.status}`)

    // Edge case: session may already be running/errored before we poll
    const current = await client.get(`/sessions/${sessionId}`).then(r => r.data).catch(() => null)
    if (current && (current.status === 'running' || current.status === 'error')) {
      clearTimeout(timer)
      socket.off('sessions patched', patchHandler)
      resolveEvent(current)
    }
  } catch (err: any) {
    clearTimeout(timer)
    socket.off('sessions patched', patchHandler)
    fail('POST /sessions failed', err?.response?.data ?? err)
    return null
  }

  info(`Waiting for session to become 'running' (timeout: ${SESSION_TIMEOUT / 1000}s)...`)

  try {
    const session: any = await eventPromise

    if (session.status === 'error') {
      fail('Session ended in error', session.errorMessage)
      if (session.errorMessage?.includes('Sandbox not configured')) {
        warn('Sandbox API key is not configured', 'Set sandbox.opensandbox.apiKey in config/default.json')
      }
      return null
    }

    ok('Session is running!', `id=${sessionId}`)
    if (session.containerId) ok('containerId present', session.containerId)
    else warn('containerId missing from session')
    if (session.proxyUrl) ok('proxyUrl present', session.proxyUrl)
    else warn('proxyUrl missing from session')
    if (session.sandboxEndpoint) ok('sandboxEndpoint present', session.sandboxEndpoint)
    else info('sandboxEndpoint not set (may be in headers)')

    return sessionId
  } catch (err) {
    fail('Session never reached running status', err)

    try {
      const s = await client.get(`/sessions/${sessionId}`)
      info('Current session state', JSON.stringify(s.data))
    } catch { /* ignore */ }

    return null
  }
}

// ─── Step 5: Verify session fields via REST ───────────────────────────────────

async function step5_verifySession(client: AxiosInstance, sessionId: string): Promise<void> {
  section('Step 5 · Verify Session Fields (REST)')

  try {
    const res = await client.get(`/sessions/${sessionId}`)
    const s = res.data

    ok(`GET /sessions/${sessionId}`, `status=${s.status}`)

    if (s.status === 'running') ok('status is running')
    else fail('Expected status running', `got ${s.status}`)

    if (s.containerId) ok('containerId', s.containerId.slice(0, 12) + '...')
    else warn('containerId not set')

    if (s.proxyUrl) ok('proxyUrl', s.proxyUrl)
    else warn('proxyUrl not set')

    if (s.projectId) ok('projectId matches', s.projectId)
    else warn('projectId missing')

    if (s.userId) ok('userId present', s.userId)
    else warn('userId missing')

    if (s.startedAt) ok('startedAt', new Date(s.startedAt).toISOString())
    else warn('startedAt missing')
  } catch (err: any) {
    fail('GET /sessions failed', err?.response?.data ?? err)
  }
}

// ─── Step 6: API proxy test ───────────────────────────────────────────────────

async function step6_testProxy(client: AxiosInstance, sessionId: string): Promise<void> {
  section('Step 6 · API-Test Proxy')

  const testPaths = ['/', '/health', '/docs', '/items', '/users']
  let hitOnce = false

  for (const path of testPaths) {
    try {
      const res = await client.get(`/api-test/${sessionId}${path}`)
      ok(`GET ${path} → ${res.status}`, JSON.stringify(res.data).slice(0, 80))
      hitOnce = true
      break
    } catch (err: any) {
      const status = err?.response?.status
      const body = err?.response?.data
      if (status === 409) {
        fail(`GET ${path} → 409 Session not running`, body?.message)
      } else if (status === 502) {
        warn(`GET ${path} → 502 container unreachable`, body?.details ?? body?.error)
      } else if (status === 404) {
        info(`GET ${path} → 404 (endpoint absent in generated app — expected)`)
      } else {
        warn(`GET ${path} → ${status}`, JSON.stringify(body ?? '').slice(0, 100))
      }
    }
  }

  if (!hitOnce) {
    warn('No proxy path returned 2xx — container may still be starting up or app has no matching routes')
  }
}

// ─── Step 7: Cleanup ──────────────────────────────────────────────────────────

async function step7_cleanup(
  client: AxiosInstance,
  socket: Socket,
  sessionId: string | null,
  projectId: string,
  ownedByUs: boolean
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

  if (ownedByUs) {
    try {
      await client.delete(`/projects/${projectId}`)
      ok('Test project deleted')
    } catch (err: any) {
      warn('Project deletion failed (non-fatal)', err?.response?.data?.message ?? err.message)
    }
  } else {
    info('Keeping project (not created by this script)', projectId)
  }

  socket.disconnect()
  ok('Socket disconnected')
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  banner('Mockline Session Lifecycle Smoke Test')
  console.log(`${D}  API: ${API_URL}`)
  console.log(`  Token: ${SIM_TOKEN ? SIM_TOKEN.slice(0, 20) + '...' : '(none — will exit)'}`)
  console.log(`  Project: ${SIM_PROJECT_ID || '(will create minimal project)'}`)
  console.log(`  Language: ${SIM_LANGUAGE}`)
  console.log(`  Session timeout: ${SESSION_TIMEOUT / 1000}s${RESET}\n`)

  // Step 1: Auth
  let token: string, userId: string
  try {
    ;({ token, userId } = await step1_auth())
  } catch {
    process.exit(1)
  }

  const client = makeClient(token)

  // Step 2: Project
  let projectId: string, ownedByUs: boolean
  try {
    ;({ projectId, ownedByUs } = await step2_project(client, userId))
  } catch {
    process.exit(1)
  }

  // Step 3: Socket
  let socket: Socket
  try {
    socket = await step3_connectSocket(token, projectId)
  } catch {
    process.exit(1)
  }

  // Step 4: Start session
  const sessionId = await step4_startSession(client, socket, projectId, userId)

  // Step 5: Verify fields (only if running)
  if (sessionId) {
    await step5_verifySession(client, sessionId)
  }

  // Step 6: Proxy
  if (sessionId) {
    await step6_testProxy(client, sessionId)
  }

  // Step 7: Cleanup
  await step7_cleanup(client, socket, sessionId, projectId, ownedByUs)

  // ─── Summary ──────────────────────────────────────────────────────────────
  const line = '─'.repeat(60)
  console.log(`\n${B}${line}`)
  console.log(`  Session test complete`)
  console.log(`  ${G}${passCount} passed${RESET}  ${failCount > 0 ? R : D}${failCount} failed${RESET}  ${warnCount > 0 ? Y : D}${warnCount} warnings${RESET}`)
  console.log(`${B}${line}${RESET}\n`)

  if (failCount > 0) process.exit(1)
}

main().catch(err => {
  console.error(`\n${R}Fatal:${RESET}`, err.message)
  process.exit(1)
})
