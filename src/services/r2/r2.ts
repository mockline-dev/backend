// R2 Service Configuration and Registration
import { authenticate } from '@feathersjs/authentication'
import type { Application, HookContext } from '../../declarations'
import { getR2Service, R2Config, type R2Service } from './r2.class'
import type { R2PresignedUrl, R2Upload } from './r2.schema'

// Configure and register the R2 service
export const r2 = (app: Application) => {
  const config = app.get('r2') as unknown as R2Config

  const r2Service = getR2Service({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket
  })

  // Register the R2 service as a custom service
  app.use('r2', {
    async find(params: any) {
      const { query } = params
      const { prefix } = query || {}

      const files = await r2Service.listFiles(prefix || '')
      return files.map(key => ({
        key,
        bucket: config.bucket
      }))
    },

    async get(key: string, params: any) {
      const result = await r2Service.downloadFile(key)
      return {
        key,
        bucket: config.bucket,
        content: result.content,
        contentType: result.contentType
      }
    },

    async create(data: R2Upload, params: any) {
      const { key, content, contentType } = data

      const uploadedKey = await r2Service.uploadFile({
        key,
        content,
        contentType
      })

      return {
        key: uploadedKey,
        contentType,
        createdAt: Date.now()
      }
    },

    async remove(key: string, params: any) {
      await r2Service.deleteFile(key)
      return {
        key,
        deleted: true
      }
    },

    // Custom method for generating presigned URLs
    async presignedUrl(data: R2PresignedUrl, params: any) {
      const { key, expiresIn = 3600 } = data

      const url = await r2Service.getPresignedUrl({
        key,
        expiresIn
      })

      return {
        url,
        expiresIn
      }
    }
  } as any)

  // Register hooks
  app.service('r2').hooks({
    before: {
      all: [authenticate('jwt'),
        async (context: HookContext) => {
          // Ensure user is authenticated
          if (!context.params.user) {
            throw new Error('Authentication required')
          }
          return context
        }
      ]
    },
    error: {}
  })

  // Make R2 service available globally
  app.set('r2Service', r2Service)
}

export type { R2Service }
