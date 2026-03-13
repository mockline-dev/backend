// For more information about this file see https://dove.feathersjs.com/guides/cli/client.html
import type { AuthenticationClientOptions } from '@feathersjs/authentication-client'

import { architectureClient } from './services/architecture/architecture.shared'
export type {
  Architecture,
  ArchitectureData,
  ArchitectureQuery,
  ArchitecturePatch
} from './services/architecture/architecture.shared'

import { snapshotsClient } from './services/snapshots/snapshots.shared'
export type { Files, FilesData, FilesPatch, FilesQuery } from './services/files/files.shared'
export type {
  Messages,
  MessagesData,
  MessagesPatch,
  MessagesQuery
} from './services/messages/messages.shared'
export type {
  Projects,
  ProjectsData,
  ProjectsPatch,
  ProjectsQuery
} from './services/projects/projects.shared'
export type {
  Snapshots,
  SnapshotsData,
  SnapshotsPatch,
  SnapshotsQuery
} from './services/snapshots/snapshots.shared'
export type { Users, UsersData, UsersPatch, UsersQuery } from './services/users/users.shared'

import { filesClient } from './services/files/files.shared'

import { messagesClient } from './services/messages/messages.shared'

import { projectsClient } from './services/projects/projects.shared'

import { usersClient } from './services/users/users.shared'

import authenticationClient from '@feathersjs/authentication-client'
import type { Application, TransportConnection } from '@feathersjs/feathers'
import { feathers } from '@feathersjs/feathers'
import { uploadsClient } from './services/uploads/uploads.shared'

export interface Configuration {
  connection: TransportConnection<ServiceTypes>
}

export interface ServiceTypes {}

export type ClientApplication = Application<ServiceTypes, Configuration>

/**
 * Returns a typed client for the booking-back app.
 *
 * @param connection The REST or Socket.io Feathers client connection
 * @param authenticationOptions Additional settings for the authentication client
 * @see https://dove.feathersjs.com/api/client.html
 * @returns The Feathers client application
 */
export const createClient = <Configuration = any,>(
  connection: TransportConnection<ServiceTypes>,
  authenticationOptions: Partial<AuthenticationClientOptions> = {}
) => {
  const client: ClientApplication = feathers()

  client.configure(connection)
  client.configure(authenticationClient(authenticationOptions))
  client.set('connection', connection)

  client.configure(usersClient)
  client.configure(messagesClient)
  client.configure(projectsClient)
  client.configure(filesClient)
  client.configure(uploadsClient)
  client.configure(snapshotsClient)
  client.configure(architectureClient)
  return client
}
