import { files } from './files/files'
import { endpoints } from './endpoints/endpoints'
import { projects } from './projects/projects'
import { user } from './users/users'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'

export const services = (app: Application) => {
  app.configure(files)
  app.configure(endpoints)
  app.configure(projects)
  app.configure(user)

  // All services will be registered here
}
