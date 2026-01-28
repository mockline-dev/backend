// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type { Files, FilesData, FilesPatch, FilesQuery, FilesService } from './files.class'

export type { Files, FilesData, FilesPatch, FilesQuery }

export type FilesClientService = Pick<FilesService<Params<FilesQuery>>, (typeof filesMethods)[number]>

export const filesPath = 'files'

export const filesMethods: Array<keyof FilesService> = ['find', 'get', 'create', 'patch', 'remove']

export const filesClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(filesPath, connection.service(filesPath), {
    methods: filesMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [filesPath]: FilesClientService
  }
}
