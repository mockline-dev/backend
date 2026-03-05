import { authenticate } from '@feathersjs/authentication'
import type { Application } from '../../declarations'

interface ServerMonitorData {
  projectId: string
  port: number
  pid: number
  url?: string
  docsUrl?: string
  redocUrl?: string
  openapiUrl?: string
}

interface ServerMonitorPatch {
  status?: 'starting' | 'running' | 'stopped' | 'error'
  uptime?: number
  errorMessage?: string
}

interface ServerInfo {
  _id: string
  projectId: string
  userId: string
  port: number
  pid: number
  status: 'starting' | 'running' | 'stopped' | 'error'
  startTime: number
  uptime: number
  url?: string
  docsUrl?: string
  redocUrl?: string
  openapiUrl?: string
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

export default function (app: Application) {
  const activeServers = new Map<string, NodeJS.Timeout>()

  app.use('server-monitor', {
    async create(data: ServerMonitorData, params: any): Promise<ServerInfo> {
      const { user } = params

      const serverInfo: ServerInfo = {
        _id: `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        projectId: data.projectId,
        userId: user._id,
        port: data.port,
        pid: data.pid,
        status: 'starting',
        startTime: Date.now(),
        uptime: 0,
        url: data.url,
        docsUrl: data.docsUrl,
        redocUrl: data.redocUrl,
        openapiUrl: data.openapiUrl,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      // Start monitoring this server
      monitorServer(app, serverInfo._id, data.pid, data.projectId, activeServers)

      return serverInfo
    },

    async find(params: any): Promise<ServerInfo[]> {
      const { user } = params
      // In a real implementation, this would query a database
      // For now, return empty array as we're using in-memory monitoring
      return []
    },

    async get(id: string, params: any): Promise<ServerInfo> {
      // In a real implementation, this would query a database
      // For now, throw an error as we're using in-memory monitoring
      throw new Error('Server not found')
    },

    async patch(id: string, data: ServerMonitorPatch, params: any): Promise<ServerInfo> {
      // In a real implementation, this would update a database record
      // For now, return a mock response
      return {
        _id: id,
        projectId: '',
        userId: params.user._id,
        port: 0,
        pid: 0,
        status: data.status || 'running',
        startTime: Date.now(),
        uptime: data.uptime || 0,
        errorMessage: data.errorMessage,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    },

    async remove(id: string, params: any): Promise<ServerInfo> {
      // Stop monitoring
      const interval = activeServers.get(id)
      if (interval) {
        clearInterval(interval)
        activeServers.delete(id)
      }

      // Try to stop the server process
      try {
        const server = await this.get(id, params)
        process.kill(server.pid, 'SIGTERM')
      } catch (error) {
        console.error(`Failed to stop server ${id}:`, error)
      }

      // Return mock response
      return {
        _id: id,
        projectId: '',
        userId: params.user._id,
        port: 0,
        pid: 0,
        status: 'stopped',
        startTime: Date.now(),
        uptime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    }
  })

  // Helper function to monitor server status
  function monitorServer(
    app: Application,
    serverId: string,
    pid: number,
    projectId: string,
    activeServers: Map<string, NodeJS.Timeout>
  ) {
    const interval = setInterval(async () => {
      try {
        // Check if process is still running
        process.kill(pid, 0)

        // Broadcast status update
        const serverMonitorService = app.service('server-monitor' as any)
        serverMonitorService.emit('status', {
          serverId,
          projectId,
          status: 'running',
          uptime: Date.now()
        })
      } catch (error) {
        // Process has stopped
        clearInterval(interval)
        activeServers.delete(serverId)

        // Broadcast stopped status
        const serverMonitorService = app.service('server-monitor' as any)
        serverMonitorService.emit('status', {
          serverId,
          projectId,
          status: 'stopped'
        })
      }
    }, 5000) // Check every 5 seconds

    activeServers.set(serverId, interval)
  }

  app.service('server-monitor' as any).hooks({
    before: {
      all: [authenticate('jwt')],
      find: [],
      get: [],
      create: [],
      patch: [],
      remove: []
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}
