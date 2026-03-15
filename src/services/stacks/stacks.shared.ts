// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type { Stack, StackQuery, StackService } from './stacks.class'

export type { Stack, StackQuery }

/**
 * Stack service interface exposed to the client
 * Only exposes find and get methods as stacks are read-only
 */
export type StackClientService = Pick<StackService<Params<StackQuery>>, (typeof stackMethods)[number]>

export const stackMethods = ['find', 'get'] as const

export const stacksPath = 'stacks'

/**
 * Configure the stacks service on the client
 */
export const stacksClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(stacksPath, connection.service(stacksPath), {
    methods: stackMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [stacksPath]: StackClientService
  }
}
