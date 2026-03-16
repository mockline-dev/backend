// For more information about this file see https://dove.feathersjs.com/guides/cli/channels.html
import type { AuthenticationResult } from '@feathersjs/authentication'
import type { Params, RealTimeConnection } from '@feathersjs/feathers'
import '@feathersjs/transport-commons'
import type { Application, HookContext } from './declarations'

export const channels = (app: Application) => {
  app.on('connection', (connection: RealTimeConnection) => {
    // On a new real-time connection, add it to the anonymous channel
    app.channel('anonymous').join(connection)

    // Client can emit 'join-project' / 'leave-project' over Socket.IO to manage project subscriptions
    const socket = (connection as any)?.socket
    if (socket?.on) {
      socket.on('join-project', (projectId?: string) => {
        const targetId = projectId?.toString().trim()
        if (!targetId) {
          return
        }
        app.channel(`projects/${targetId}`).join(connection)
      })

      socket.on('leave-project', (projectId?: string) => {
        const targetId = projectId?.toString().trim()
        if (!targetId) {
          return
        }
        app.channel(`projects/${targetId}`).leave(connection)
      })
    }
  })

  app.on('login', (authResult: AuthenticationResult, { connection }: Params) => {
    // connection can be undefined if there is no
    // real-time connection, e.g. when logging in via REST
    if (connection) {
      // The connection is no longer anonymous, remove it
      app.channel('anonymous').leave(connection)

      // Add it to the authenticated user channel
      app.channel('authenticated').join(connection)
    }
  })

  const getId = (value: any) => value?._id?.toString?.() ?? value?.id?.toString?.()

  app.service('messages').publish((data: any) => {
    const projectId = data?.projectId?.toString?.()
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  app.service('projects').publish((data: any) => {
    const projectId = getId(data)
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  app.service('files').publish((data: any) => {
    const projectId = data?.projectId?.toString?.()
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  app.service('snapshots').publish((data: any) => {
    const projectId = data?.projectId?.toString?.()
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  app.service('generations').publish((data: any) => {
    const projectId = data?.projectId?.toString?.()
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  app.service('agents').publish((data: any) => {
    const projectId = data?.projectId?.toString?.()
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  app.service('versions').publish((data: any) => {
    const projectId = data?.projectId?.toString?.()
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  app.service('deployments').publish((data: any) => {
    const projectId = data?.projectId?.toString?.()
    return projectId ? app.channel(`projects/${projectId}`) : app.channel('authenticated')
  })

  // Publish ai-stream events to project-scoped channels
  app.service('ai-stream').publish((data: any) => {
    return app.channel(`projects/${data.projectId}`)
  })

  app.service('ai-stream').publish('chunk', (data: any) => {
    return app.channel(`projects/${data.projectId}`)
  })

  app.service('ai-stream').publish('file-updates', (data: any) => {
    return app.channel(`projects/${data.projectId}`)
  })

  // eslint-disable-next-line no-unused-vars
  app.publish((_data: any, _context: HookContext) => {
    return app.channel('authenticated')
  })
}
