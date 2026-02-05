// AI Projects Service Shared Types and Configuration
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type {
  AIProject,
  AIProjectData,
  AIProjectPatch,
  AIProjectQuery,
  AIProjectsService
} from './ai-projects.class'

export type { AIProject, AIProjectData, AIProjectPatch, AIProjectQuery }

export type AIProjectClientService = Pick<
  AIProjectsService<Params<AIProjectQuery>>,
  (typeof aiProjectMethods)[number]
>

export const aiProjectPath = 'ai-projects'

export const aiProjectMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export const aiProjectClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(aiProjectPath, connection.service(aiProjectPath), {
    methods: aiProjectMethods
  })
}


declare module '../../client' {
  interface ServiceTypes {
    [aiProjectPath]: AIProjectClientService
  }
}
