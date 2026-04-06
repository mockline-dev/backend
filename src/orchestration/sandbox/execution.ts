import { Sandbox, ConnectionConfig } from '@alibaba-group/opensandbox'
import { createModuleLogger } from '../../logging'
import { r2Client } from '../../storage/r2.client'

const log = createModuleLogger('sandbox-execution')

export interface ExecutionResult {
  containerId: string
  proxyUrl: string
  port: number
}

const START_COMMANDS: Record<string, string[]> = {
  python: [
    // Try uvicorn (FastAPI), then flask, then plain python
    'cd /workspace && (uvicorn main:app --host 0.0.0.0 --port 8000 > /tmp/server.log 2>&1 || python3 main.py > /tmp/server.log 2>&1) &'
  ],
  typescript: [
    'cd /workspace && npm install --silent 2>/dev/null || true',
    'cd /workspace && (npx ts-node src/index.ts > /tmp/server.log 2>&1 || node dist/index.js > /tmp/server.log 2>&1) &'
  ],
  javascript: [
    'cd /workspace && npm install --silent 2>/dev/null || true',
    'cd /workspace && node index.js > /tmp/server.log 2>&1 &'
  ]
}

const DEP_INSTALL_COMMANDS: Record<string, { manifest: string; cmd: string }> = {
  python: {
    manifest: 'requirements.txt',
    cmd: 'pip install --quiet -r /workspace/requirements.txt 2>&1 || true'
  },
  typescript: {
    manifest: 'package.json',
    cmd: 'cd /workspace && npm install --prefer-offline --silent 2>&1 || true'
  },
  javascript: {
    manifest: 'package.json',
    cmd: 'cd /workspace && npm install --prefer-offline --silent 2>&1 || true'
  }
}

const SERVER_PORT = 8000

/**
 * Starts a long-lived sandbox container with all project files,
 * installs dependencies, and starts the server process.
 * Returns the container reference and proxy URL.
 */
export async function startProjectExecution(
  projectId: string,
  language: string,
  sandboxConfig: any
): Promise<ExecutionResult & { sandbox: Sandbox }> {
  log.info('Starting project execution sandbox', { projectId, language })

  // Fetch all project files from R2
  const objects = await r2Client.listObjects(`projects/${projectId}/`)
  if (objects.length === 0) {
    throw new Error('No project files found — generate the project first')
  }

  const files: Array<{ path: string; data: string; mode: number }> = []
  for (const obj of objects) {
    try {
      const stream = await r2Client.getObject(obj.key)
      if (!stream) continue

      const chunks: Buffer[] = []
      for await (const chunk of stream as any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const content = Buffer.concat(chunks).toString('utf8')
      // Strip the `projects/{projectId}/` prefix for the workspace path
      const relativePath = obj.key.replace(`projects/${projectId}/`, '')
      files.push({ path: `/workspace/${relativePath}`, data: content, mode: 0o644 })
    } catch (err: unknown) {
      log.warn('Failed to fetch file from R2', {
        key: obj.key,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (files.length === 0) {
    throw new Error('Could not fetch any project files from storage')
  }

  const executionTimeout = sandboxConfig.executionTimeoutMs ?? 300000
  const connectionConfig = new ConnectionConfig({
    domain: sandboxConfig.opensandbox.domain,
    apiKey: sandboxConfig.opensandbox.apiKey,
    protocol: sandboxConfig.opensandbox.protocol,
    requestTimeoutSeconds: Math.ceil(executionTimeout / 1000),
    useServerProxy: true
  })

  const sandbox = await Sandbox.create({
    connectionConfig,
    image: sandboxConfig.opensandbox.defaultImage,
    timeoutSeconds: Math.ceil(executionTimeout / 1000) + 30,
    env: {
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1',
      PORT: String(SERVER_PORT)
    }
  })

  log.debug('Execution sandbox created', { projectId, fileCount: files.length })

  // Write all project files
  await sandbox.files.writeFiles(files)

  // Install dependencies if manifest present
  const depConfig = DEP_INSTALL_COMMANDS[language] ?? DEP_INSTALL_COMMANDS['python']
  const hasManifest = files.some(f => f.path.endsWith(`/${depConfig.manifest}`))
  if (hasManifest) {
    log.debug('Installing dependencies', { projectId, language })
    await sandbox.commands.run(depConfig.cmd, {}, {}).catch(() => {
      /* non-fatal */
    })
  }

  // Start server in background
  const startCmds = START_COMMANDS[language] ?? START_COMMANDS['python']
  for (const cmd of startCmds) {
    await sandbox.commands.run(cmd, {}, {}).catch(() => {
      /* non-fatal */
    })
  }

  // Poll for server readiness (max 30s)
  const proxyUrl = await waitForServer(sandbox, SERVER_PORT, 30000)
  log.info('Execution sandbox server ready', { projectId, proxyUrl })

  // Extract containerId from sandbox internals (best-effort)
  const containerId = (sandbox as any).id ?? (sandbox as any).containerId ?? 'unknown'

  return { containerId, proxyUrl, port: SERVER_PORT, sandbox }
}

async function waitForServer(sandbox: Sandbox, port: number, timeoutMs: number): Promise<string> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      // Check if something is listening on the port
      const { exitCode } = await (sandbox.commands.run(
        `nc -z localhost ${port} 2>/dev/null && echo "open" || echo "closed"`,
        {},
        {}
      ) as any)

      if (exitCode === 0) {
        // Construct the proxy URL via OpenSandbox's port forwarding
        return `http://localhost:${port}`
      }
    } catch {
      // ignore, keep polling
    }
    await new Promise(r => setTimeout(r, 2000))
  }

  // Return URL even if we're not sure — client can retry
  return `http://localhost:${port}`
}

/**
 * Stops and cleans up an execution sandbox.
 */
export async function stopProjectExecution(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.kill()
  } catch {
    /* non-fatal */
  }
  try {
    await sandbox.close()
  } catch {
    /* non-fatal */
  }
}
