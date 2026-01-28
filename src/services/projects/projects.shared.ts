// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type { Projects, ProjectsData, ProjectsPatch, ProjectsQuery, ProjectsService } from './projects.class'

export type { Projects, ProjectsData, ProjectsPatch, ProjectsQuery }

export type ProjectsClientService = Pick<
  ProjectsService<Params<ProjectsQuery>>,
  (typeof projectsMethods)[number]
>

export const projectsPath = 'projects'

export const projectsMethods: Array<keyof ProjectsService> = ['find', 'get', 'create', 'patch', 'remove']

export const projectsClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(projectsPath, connection.service(projectsPath), {
    methods: projectsMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [projectsPath]: ProjectsClientService
  }
}
