import { files } from './files/files'
import { messages } from './messages/messages'
import { projects } from './projects/projects'
import { snapshots } from './snapshots/snapshots'
import { uploads } from './uploads/uploads'
import { users } from './users/users'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'
import aiStreamService from './ai-service/ai-stream.service'
import aiService from './ai-service/ai.service'
import enhancePromptService from './ai-service/enhance-prompt.service'
import inferProjectMetaService from './ai-service/infer-project-meta.service'
import validatePromptService from './ai-service/validate-prompt.service'
import fileStream from './files/file-stream.service'
import serverMonitorService from './server-monitor/server-monitor.service'

export const services = (app: Application) => {
  app.configure(snapshots)
  app.configure(files)
  app.configure(messages)
  app.configure(projects)
  app.configure(users)
  app.configure(uploads)
  app.configure(aiService)
  app.configure(aiStreamService)
  app.configure(fileStream)
  app.configure(enhancePromptService)
  app.configure(inferProjectMetaService)
  app.configure(validatePromptService)
  app.configure(serverMonitorService)

  // All services will be registered here
}
