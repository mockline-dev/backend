// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type {
  Architecture,
  ArchitectureData,
  ArchitecturePatch,
  ArchitectureQuery,
  ArchitectureService
} from './architecture.class'

export type { Architecture, ArchitectureData, ArchitecturePatch, ArchitectureQuery }

export type ArchitectureClientService = Pick<
  ArchitectureService<Params<ArchitectureQuery>>,
  (typeof architectureMethods)[number]
>

export const architecturePath = 'architecture'

export const architectureMethods: Array<keyof ArchitectureService> = [
  'find',
  'get',
  'create',
  'patch',
  'remove'
]

export const architectureClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(architecturePath, connection.service(architecturePath), {
    methods: architectureMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [architecturePath]: ArchitectureClientService
  }
}
