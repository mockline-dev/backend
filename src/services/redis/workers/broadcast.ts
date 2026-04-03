import type { Application } from '../../../declarations'

export interface ProgressEvent {
  phase: string
  step: string
  detail: string
  percent: number
}

/**
 * Broadcast a structured project:progress event to all sockets in the project channel.
 *
 * Uses FeathersJS channels which route through the Socket.IO transport automatically.
 * Clients subscribe to: socket.emit('join-project', projectId) then listen for
 * 'project:progress' events.
 */
export function broadcastProgress(
  app: Application,
  projectId: string,
  event: ProgressEvent
): void {
  app.channel(`projects/${projectId}`).send({
    type: 'project:progress',
    payload: {
      projectId,
      ...event,
      timestamp: Date.now()
    }
  })
}
