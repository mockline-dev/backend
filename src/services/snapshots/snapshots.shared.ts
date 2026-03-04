// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type {
  Snapshots,
  SnapshotsData,
  SnapshotsPatch,
  SnapshotsQuery,
  SnapshotsService
} from './snapshots.class'

export type { Snapshots, SnapshotsData, SnapshotsPatch, SnapshotsQuery }

export type SnapshotsClientService = Pick<
  SnapshotsService<Params<SnapshotsQuery>>,
  (typeof snapshotsMethods)[number]
>

export const snapshotsPath = 'snapshots'

export const snapshotsMethods: Array<keyof SnapshotsService> = ['find', 'get', 'create', 'patch', 'remove']

export const snapshotsClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(snapshotsPath, connection.service(snapshotsPath), {
    methods: snapshotsMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [snapshotsPath]: SnapshotsClientService
  }
}
