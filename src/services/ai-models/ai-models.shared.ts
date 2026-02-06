// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type { AIModel, AIModelData, AIModelPatch, AIModelQuery, AIModelsService } from './ai-models.class'

export type { AIModel, AIModelData, AIModelPatch, AIModelQuery }

export type AIModelsClientService = Pick<
  AIModelsService<Params<AIModelQuery>>,
  (typeof aiModelsMethods)[number]
>

export const aiModelsPath = 'ai-models'

export const aiModelsMethods: Array<keyof AIModelsService> = ['find', 'get']

export const aiModelsClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(aiModelsPath, connection.service(aiModelsPath), {
    methods: aiModelsMethods
  })
}

// Add this service to client service type index
declare module '../../client' {
  interface ServiceTypes {
    [aiModelsPath]: AIModelsClientService
  }
}
