// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html
import configuration from '@feathersjs/configuration'
import { feathers } from '@feathersjs/feathers'
import { bodyParser, cors, errorHandler, koa, parseAuthentication, rest, serveStatic } from '@feathersjs/koa'
import socketio from '@feathersjs/socketio'

import { configureSessionLogger } from './logging'
import { logger } from './logger'
import { authentication } from './authentication'
import { channels } from './channels'
import { configurationValidator } from './configuration'
import type { Application } from './declarations'
import { initializeFirebase } from './firebase'
import { mongodb } from './mongodb'
import { services } from './services/index'
import { startWorkerService } from './services/redis'
import { createApiProxyMiddleware } from './services/sessions/api-proxy'

const app: Application = koa(feathers())

// Load our app configuration (see config/ folder)
app.configure(configuration(configurationValidator))

// Configure session-based file logging
configureSessionLogger(logger)

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

// API proxy for testing running sandbox containers
app.use(createApiProxyMiddleware(app))

// Configure services and transports
app.configure(rest())
app.configure(
  socketio(
    {
      cors: {
        origin: app.get('origins')
      }
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
  error: [
    async (context) => {
      const { error, path, method } = context
      console.error(`[${path}] ${method} error:`, error?.message || error)
      if (error?.data) console.info(`[${path}] error data:`, error.data)
    }
  ]
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
