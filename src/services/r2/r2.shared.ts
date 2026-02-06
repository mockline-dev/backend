// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { ClientApplication } from '../../client'
import type { R2File, R2PresignedUrl, R2Query, R2Upload } from './r2.schema'

export type { R2File, R2PresignedUrl, R2Query, R2Upload }

export type R2ClientService = {
  uploadFile: (data: R2Upload) => Promise<R2File>
  downloadFile: (key: string) => Promise<{ content: string; contentType?: string }>
  deleteFile: (key: string) => Promise<void>
  getPresignedUrl: (data: R2PresignedUrl) => Promise<string>
  listFiles: (prefix: string) => Promise<string[]>
}

export const r2Path = 'r2'

export const r2Client = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(r2Path, connection.service(r2Path), {
    methods: ['uploadFile', 'downloadFile', 'deleteFile', 'getPresignedUrl', 'listFiles']
  })
}

// Add this service to client service type index
declare module '../../client' {
  interface ServiceTypes {
    [r2Path]: R2ClientService
  }
}
