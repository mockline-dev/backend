// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html
import configuration from '@feathersjs/configuration'
import { feathers } from '@feathersjs/feathers'
import { bodyParser, cors, errorHandler, koa, parseAuthentication, rest, serveStatic } from '@feathersjs/koa'
import socketio from '@feathersjs/socketio'

import { authentication } from './authentication'
import { channels } from './channels'
import { configurationValidator } from './configuration'
import type { Application } from './declarations'
import { mongodb } from './mongodb'
import { services } from './services/index'

const app: Application = koa(feathers())

// Load our app configuration (see config/ folder)
app.configure(configuration(configurationValidator))

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
  socketio({
    cors: {
      origin: app.get('origins')
    }
  })
)
app.configure(mongodb)
app.configure(authentication)
app.configure(services)
app.configure(channels)

// Add custom routes for AI service integration
app.use(async (ctx, next) => {
  if (ctx.path === '/api/files/upload') {
    try {
      const { key, content, contentType = 'application/octet-stream' } = ctx.request.body as any

      // ⚠️ Authentication disabled for testing

      if (!key || !content) {
        ctx.status = 400
        ctx.body = { error: 'Missing required fields: key or content' }
        return
      }

      // Get R2 service
      const r2Service = app.get('r2Service')
      if (!r2Service) {
        console.error('[ERROR] R2 service not configured')
        ctx.status = 500
        ctx.body = { error: 'R2 service not configured' }
        return
      }

      // Upload file to R2
      console.log(`[DEBUG] Uploading file: ${key} (${content.length} bytes)`)
      await r2Service.uploadFile({ key, content, contentType })
      console.log(`[DEBUG] Successfully uploaded: ${key}`)

      ctx.status = 200
      ctx.body = {
        success: true,
        key,
        contentType,
        uploadedAt: Date.now()
      }
    } catch (error: any) {
      console.error('[ERROR] File upload error:', error)
      ctx.status = 500
      ctx.body = {
        success: false,
        error: error.message || 'Failed to upload file'
      }
    }
    return
  }

  if (ctx.path === '/api/files/batch-upload') {
    try {
      const { files } = ctx.request.body as any

      if (!files || !Array.isArray(files)) {
        ctx.status = 400
        ctx.body = { error: 'Missing or invalid files array' }
        return
      }

      // Get R2 service
      const r2Service = app.get('r2Service')
      if (!r2Service) {
        console.error('[ERROR] R2 service not configured')
        ctx.status = 500
        ctx.body = { error: 'R2 service not configured' }
        return
      }

      const uploadResults: any[] = []

      for (const file of files) {
        const { key, content, contentType = 'application/octet-stream' } = file
        console.log(`[DEBUG] Uploading file: ${key} (${content.length} bytes)`)
        try {
          await r2Service.uploadFile({ key, content, contentType })
          uploadResults.push({ key, success: true })
          console.log(`[DEBUG] Successfully uploaded: ${key}`)
        } catch (error: any) {
          console.error(`[ERROR] Failed to upload ${key}:`, error)
          uploadResults.push({ key, success: false, error: error.message })
        }
      }

      const successCount = uploadResults.filter(r => r.success).length
      console.log(`[DEBUG] Batch upload complete: ${successCount}/${files.length} successful`)

      ctx.status = 200
      ctx.body = {
        success: true,
        results: uploadResults,
        uploadedAt: Date.now()
      }
    } catch (error: any) {
      console.error('[ERROR] Batch upload error:', error)
      ctx.status = 500
      ctx.body = {
        success: false,
        error: error.message || 'Failed to upload files'
      }
    }
    return
  }

  await next()
})

app.on('connection', (connection: any) => {
  const socket = connection as {
    on?: (event: string, callback: (...args: any[]) => void) => void
  }

  if (!socket.on) {
    return
  }

  socket.on('join-project', (projectId: string) => {
    if (!projectId || !connection?.feathers?.user) {
      return
    }
    app.channel(`projects/${projectId}`).join(connection)
  })

  socket.on('leave-project', (projectId: string) => {
    if (!projectId) {
      return
    }
    app.channel(`projects/${projectId}`).leave(connection)
  })
})

// Register hooks that run on all service methods
app.hooks({
  around: {
    all: []
  },
  before: {},
  after: {},
  error: {}
})
// Register application setup and teardown hooks here
app.hooks({
  setup: [
   
  ],
  teardown: [
   
  ]
})


export { app }
