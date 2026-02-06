// For more information about this file see https://dove.feathersjs.com/guides/cli/client.html
import type { AuthenticationClientOptions } from '@feathersjs/authentication-client'

import { r2Client } from './services/r2/r2.shared'
export type { AIModel, AIModelData, AIModelPatch, AIModelQuery } from './services/ai-models/ai-models.shared'
export type { R2File, R2PresignedUrl, R2Query, R2Upload } from './services/r2/r2.shared'

import { messagesClient } from './services/messages/messages.shared'

import { aiModelsClient } from './services/ai-models/ai-models.shared'

import authenticationClient from '@feathersjs/authentication-client'
import type { Application, TransportConnection } from '@feathersjs/feathers'
import { feathers } from '@feathersjs/feathers'

import { filesClient } from './services/files/files.shared'
import { projectsClient } from './services/projects/projects.shared'
import { userClient } from './services/users/users.shared'

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

  client.configure(userClient)
  client.configure(projectsClient)
  client.configure(filesClient)
  client.configure(messagesClient)
  client.configure(aiModelsClient)
  client.configure(r2Client)
  return client
}
