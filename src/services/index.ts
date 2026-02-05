import { aiFileVersions } from './ai-file-versions/ai-file-versions'
import { aiFiles } from './ai-files/ai-files'
import { aiModels } from './ai-models/ai-models'
import { aiProjects } from './ai-projects/ai-projects'
import { conversations } from './conversations/conversations'
import { endpoints } from './endpoints/endpoints'
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
  app.configure(conversations)
  app.configure(files)
  app.configure(endpoints)
  app.configure(projects)
  app.configure(user)
  app.configure(aiProjects)
  app.configure(aiFiles)
  app.configure(aiFileVersions)
  app.configure(aiModels)

  // All services will be registered here
}
