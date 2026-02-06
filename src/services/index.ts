import { files } from './files/files'
import { messages } from './messages/messages'
import { projects } from './projects/projects'
import { uploads } from './uploads/uploads'
import { users } from './users/users'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'

export const services = (app: Application) => {
  app.configure(files)
  app.configure(messages)
  app.configure(projects)
  app.configure(users)
  app.configure(uploads)

  // All services will be registered here
}
