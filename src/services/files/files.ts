// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'
import { BadRequest, Forbidden } from '@feathersjs/errors'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  filesDataResolver,
  filesDataValidator,
  filesExternalResolver,
  filesPatchResolver,
  filesPatchValidator,
  filesQueryResolver,
  filesQueryValidator,
  filesResolver
} from './files.schema'

import type { Application, HookContext } from '../../declarations'
import { FilesService, getOptions } from './files.class'
import { filesMethods, filesPath } from './files.shared'
import { indexingQueue } from '../redis/queues/queues'

export * from './files.class'
export * from './files.schema'

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
      all: [
        authenticate('jwt'),
        schemaHooks.resolveExternal(filesExternalResolver),
        schemaHooks.resolveResult(filesResolver)
      ]
    },
    before: {
      all: [schemaHooks.validateQuery(filesQueryValidator), schemaHooks.resolveQuery(filesQueryResolver)],
      find: [],
      get: [],
      create: [schemaHooks.validateData(filesDataValidator), schemaHooks.resolveData(filesDataResolver)],
      patch: [schemaHooks.validateData(filesPatchValidator), schemaHooks.resolveData(filesPatchResolver)],
      remove: [
        async (context: HookContext) => {
          const app = context.app
          const filesId = context.id
          const userId = context.params.user?._id

          try {
            if (!filesId) {
              throw new Error('An ID is required to remove a files entry.')
            }

            const filesItem = await app.service(filesPath).get(filesId)

            if (filesItem) {
              // Authorization: Verify user owns the file
              const project = await app.service('projects').get(filesItem.projectId as any)

              // Null checks before calling toString()
              if (!project.userId) {
                throw new BadRequest('Project userId is missing')
              }
              if (!userId) {
                throw new BadRequest('User ID is missing')
              }

              if (project.userId.toString() !== userId.toString()) {
                throw new Forbidden('You do not have permission to delete this file')
              }

              await app.service('uploads').remove(null, { query: { key: filesItem.name } })
            }
          } catch (error) {
            console.error('Failed to remove files', error)
            throw new Error('Failed to remove files')
          }
        }
      ]
    },
    after: {
      all: [],
      create: [
        async (context: HookContext) => {
          const result = context.result
          console.log(result)
          // Trigger incremental re-index for the project (deduplicated by jobId)
          const projectId = result?.projectId ?? context.data?.projectId
          if (projectId) {
            indexingQueue.add('sync', { projectId }, {
              delay: 3000,
              jobId: `sync-${projectId}`,
              removeOnComplete: true,
            }).catch(() => {/* non-fatal */})
          }
        }
      ],
      patch: [
        async (context: HookContext) => {
          const projectId = context.result?.projectId
          if (projectId) {
            indexingQueue.add('sync', { projectId }, {
              delay: 3000,
              jobId: `sync-${projectId}`,
              removeOnComplete: true,
            }).catch(() => {/* non-fatal */})
          }
        }
      ],
      remove: [
        async (context: HookContext) => {
          const projectId = context.result?.projectId
          if (projectId) {
            indexingQueue.add('sync', { projectId }, {
              delay: 3000,
              jobId: `sync-${projectId}`,
              removeOnComplete: true,
            }).catch(() => {/* non-fatal */})
          }
        }
      ]
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
