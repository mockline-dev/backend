// For more information about this file see https://dove.feathersjs.com/guides/cli/typescript.html
import { HookContext as FeathersHookContext, NextFunction } from '@feathersjs/feathers'
import { Application as FeathersApplication } from '@feathersjs/koa'
import { ApplicationConfiguration } from './configuration'

import { AIModelsService } from './services/ai-models/ai-models.class'
import { FilesService } from './services/files/files.class'
import { MessagesService } from './services/messages/messages.class'
import { ProjectsService } from './services/projects/projects.class'
import { User, UserService } from './services/users/users'

export type { NextFunction }

// The types for app.get(name) and app.set(name)
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Configuration extends ApplicationConfiguration {
  r2Service?: any
}

// A mapping of service names to types. Will be extended in service files.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ServiceTypes {
  'media-stream': any
  'validate-payment': any
  redis: any
  'order-queue': any
  r2: any
  messages: MessagesService
  projects: ProjectsService
  files: FilesService
  'ai-models': AIModelsService
  users: UserService
}

// The application instance type that will be used everywhere else
export type Application = FeathersApplication<ServiceTypes, Configuration>

// The context for hook functions - can be typed with a service class
export type HookContext<S = any> = FeathersHookContext<Application, S>

// Add the user as an optional property to all params
declare module '@feathersjs/feathers' {
  interface Params {
    user?: User
  }
}
