import { files } from './files/files'
import { messages } from './messages/messages'
import { projects } from './projects/projects'
import { sessions } from './sessions/sessions'
import { snapshots } from './snapshots/snapshots'
import { uploads } from './uploads/uploads'
import { users } from './users/users'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'
import fileStream from './files/file-stream.service'

export const services = (app: Application) => {
  app.configure(snapshots)
  app.configure(files)
  app.configure(messages)
  app.configure(projects)
  app.configure(sessions)
  app.configure(users)
  app.configure(uploads)
  app.configure(fileStream)
  // All services will be registered here
}
