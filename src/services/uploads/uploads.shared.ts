// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type { Uploads, UploadsData, UploadsParams, UploadsPatch, UploadsQuery, UploadsService } from './uploads.class'

export type { Uploads, UploadsData, UploadsPatch, UploadsQuery }

export type UploadsClientService = Pick<UploadsService<UploadsParams>, (typeof uploadsMethods)[number]>

export const uploadsPath = 'uploads'

export const uploadsMethods: Array<keyof UploadsService> = ['find', 'get', 'create', 'patch', 'remove']

export const uploadsClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(uploadsPath, connection.service(uploadsPath), {
    methods: uploadsMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [uploadsPath]: UploadsClientService
  }
}
