// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html
import configuration from '@feathersjs/configuration'
import { feathers } from '@feathersjs/feathers'
import { bodyParser, cors, errorHandler, koa, parseAuthentication, rest, serveStatic } from '@feathersjs/koa'
import socketio from '@feathersjs/socketio'

import { authentication } from './authentication'
import { channels } from './channels'
import { configurationValidator } from './configuration'
import type { Application } from './declarations'
import { initializeFirebase } from './firebase'
import { logError } from './hooks/log-error'
import { mongodb } from './mongodb'
import { services } from './services/index'
import { startWorkerService } from './services/redis'

const app: Application = koa(feathers())

// Load our app configuration (see config/ folder)
app.configure(configuration(configurationValidator))

initializeFirebase(app)

// Set up Koa middleware
app.use(cors())
app.use(serveStatic(app.get('public')))
app.use(errorHandler())
app.use(parseAuthentication())
app.use(
  bodyParser({
    jsonLimit: '50mb'
  })
)

// Configure services and transports
app.configure(rest())
app.configure(
  socketio(
    {
      cors: {
        origin: app.get('origins')
      }
    },
    io => {
      io.on('connection', socket => {
        socket.on('join-project', (projectId?: string) => {
          const targetId = projectId?.toString().trim()
          if (!targetId) return

          const connection = (socket as any).feathers
          if (connection) {
            app.channel(`projects/${targetId}`).join(connection)
          }
        })

        socket.on('leave-project', (projectId?: string) => {
          const targetId = projectId?.toString().trim()
          if (!targetId) return

          const connection = (socket as any).feathers
          if (connection) {
            app.channel(`projects/${targetId}`).leave(connection)
          }
        })
      })
    }
  )
)
app.configure(mongodb)
app.configure(authentication)
app.configure(services)
app.configure(channels)

// Register hooks that run on all service methods
app.hooks({
  around: {
    all: []
  },
  before: {},
  after: {},
  error: [logError]
})
// Register application setup and teardown hooks here
app.hooks({
  setup: [
    // async () => {
    //   await startWorkerService(app)
    // }
  ]
})

startWorkerService(app)

export { app }
