// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  fileDataResolver,
  fileDataValidator,
  filePatchResolver,
  filePatchValidator,
  fileQueryResolver,
  fileQueryValidator
} from './files.schema'

import type { Application, HookContext } from '../../declarations'
import { FilesService, getOptions } from './files.class'
import { filesMethods, filesPath } from './files.shared'

export * from './files.class'
export * from './files.schema'

// R2 upload hook
const uploadToR2 = async (context: HookContext<FilesService>) => {
  const data = context.data as any

  if (data?.content && context.method === 'create') {
    const r2Service = context.app.service('r2') as any
    await r2Service.uploadFile({
      key: data.r2Key,
      content: data.content,
      contentType: 'text/plain'
    })

    // Update size based on content length
    data.size = data.content.length
  }

  return context
}

// A configure function that registers the service and its hooks via `app.configure`
export const files = (app: Application) => {
  // Register our service on the Feathers application
  app.use(filesPath, new FilesService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: filesMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(filesPath).hooks({
    around: {
        all: [authenticate('jwt')],
    },
    before: {
      all: [schemaHooks.validateQuery(fileQueryValidator), schemaHooks.resolveQuery(fileQueryResolver)],
      find: [],
      get: [],
      create: [
        uploadToR2,
        schemaHooks.validateData(fileDataValidator),
        schemaHooks.resolveData(fileDataResolver)
      ],
      patch: [schemaHooks.validateData(filePatchValidator),schemaHooks.resolveData(filePatchResolver)],
      remove: []
    },
    after: {
      all: [],
      create: [],
      patch: []
    },
    error: {
      all: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [filesPath]: FilesService
  }
}
