import { aiModels } from './ai-models/ai-models'
import { files } from './files/files'
import { messages } from './messages/messages'
import { projects } from './projects/projects'
import { r2 } from './r2/r2'
import { user } from './users/users'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'

export const services = (app: Application) => {
  app.configure(r2)
  app.configure(messages)
  app.configure(user)
  app.configure(projects)
  app.configure(files)
  app.configure(aiModels)

  // All services will be registered here
}
