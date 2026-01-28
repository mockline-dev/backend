// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type {
  Endpoints,
  EndpointsData,
  EndpointsPatch,
  EndpointsQuery,
  EndpointsService
} from './endpoints.class'

export type { Endpoints, EndpointsData, EndpointsPatch, EndpointsQuery }

export type EndpointsClientService = Pick<
  EndpointsService<Params<EndpointsQuery>>,
  (typeof endpointsMethods)[number]
>

export const endpointsPath = 'endpoints'

export const endpointsMethods: Array<keyof EndpointsService> = ['find', 'get', 'create', 'patch', 'remove']

export const endpointsClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(endpointsPath, connection.service(endpointsPath), {
    methods: endpointsMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [endpointsPath]: EndpointsClientService
  }
}
