// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
import type { Params } from '@feathersjs/feathers'
import type { ClientApplication } from '../../client'
import type { Project, ProjectData, ProjectPatch, ProjectQuery, ProjectsService } from './projects.class'

export type { Project, ProjectData, ProjectPatch, ProjectQuery }

export type ProjectsClientService = Pick<ProjectsService<Params<ProjectQuery>>, (typeof projectMethods)[number]>

export const projectPath = 'projects'

export const projectMethods: Array<keyof ProjectsService> = ['find', 'get', 'create', 'patch', 'remove']

export const projectsClient = (client: ClientApplication) => {
  const connection = client.get('connection')

  client.use(projectPath, connection.service(projectPath), {
    methods: projectMethods
  })
}

// Add this service to the client service type index
declare module '../../client' {
  interface ServiceTypes {
    [projectPath]: ProjectsClientService
  }
}
