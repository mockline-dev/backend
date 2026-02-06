// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type { File, FileData, FilePatch, FileQuery, FilesService } from './files.class'

export type { File, FileData, FilePatch, FileQuery }

export type FilesClientService = Pick<
  FilesService<Params<FileQuery>>,
  (typeof filesMethods)[number]
>

export const filesPath = 'files'

export const filesMethods: Array<keyof FilesService> = ['find', 'get', 'create', 'patch', 'remove']

export const filesClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(filesPath, connection.service(filesPath), {
    methods: filesMethods
  })
}

// Add this service to client service type index
declare module '../../client' {
  interface ServiceTypes {
    [filesPath]: FilesClientService
  }
}
