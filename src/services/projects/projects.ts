// Projects Service Configuration and Registration
import { ProjectsService, getOptions } from './projects.class'
import {
  projectDataResolver,
  projectDataValidator,
  projectPatchResolver,
  projectPatchValidator,
  projectQueryResolver,
  projectQueryValidator
} from './projects.schema'

import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import axios from 'axios'
import type { Application } from '../../declarations'
import { HookContext } from '../../declarations'
import { projectMethods, projectPath } from './projects.shared'

export const projects = (app: Application) => {
  app.use(projectPath, new ProjectsService(getOptions(app)), {
    methods: projectMethods,
    events: []
  })

  // Get the service we just registered
  const service = app.service(projectPath)

  // Register hooks following Feathers best practices
  service.hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [
        schemaHooks.validateQuery(projectQueryValidator),
        schemaHooks.resolveQuery(projectQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(projectDataValidator),
        schemaHooks.resolveData(projectDataResolver),
        async (context: HookContext) => {
          console.log('[DEBUG] Creating project:', JSON.stringify(context.data, null, 2))
          return context
        }
      ],
      update: [
        schemaHooks.validateData(projectDataValidator),
        schemaHooks.resolveData(projectDataResolver)
      ],
      patch: [
        schemaHooks.validateData(projectPatchValidator),
        schemaHooks.resolveData(projectPatchResolver)
      ],
      remove: []
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [
        async (context: HookContext) => {
          console.log('[DEBUG] Creating project:', JSON.stringify(context.result, null, 2))
          const project = context.result as any
          const aiServiceConfig = app.get('aiService')
          const aiServiceUrl = aiServiceConfig?.url || 'http://localhost:8000'

          process.nextTick(async () => {
            try {
              const result = await axios.post(`${aiServiceUrl}/api/generate`, {
                prompt: project.description,
                model: project.model || 'llama3.2:3b',
                framework: project.framework,
                language: project.language,
                projectId: project._id
              }, {
                timeout: aiServiceConfig?.timeout || 300000
              })

              // Create file records for each generated file
              if (result.data?.success && result.data.files) {
                const filesService = app.service('files' as any)

                for (const fileData of result.data.files) {
                  const { path, size } = fileData  // ✅ Use path and size from AI service
                  const language = getLanguageFromPath(path)
                  await filesService.create({
                    projectId: project._id,
                    path: path,
                    r2Key: `${project._id}/${path}`,
                    language: language,
                    size: size,  // ✅ Use actual file size from AI service
                    currentVersion: 1
                  })
                }
              }

              // Update project status to ready after successful generation
              await service.patch(project._id, { status: 'ready' })
            } catch (error) {
              console.error('Failed to trigger AI generation:', error)
              // Update project status to error
              try {
                await service.patch(project._id, { status: 'error' })
              } catch (patchError) {
                console.error('Failed to update project status:', patchError)
              }
            }
          })

          return context
        }
      ],
      update: [],
      patch: [],
      remove: []
    },
    error: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    }
  })
}

// Helper function to determine language from file path
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'cs': 'csharp',
    'cpp': 'cpp',
    'c': 'c',
    'h': 'c',
    'swift': 'swift',
    'kt': 'kotlin',
    'dart': 'dart',
    'scala': 'scala',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'fish': 'shell',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'toml': 'toml',
    'ini': 'ini',
    'md': 'markdown',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'sql': 'sql',
    'graphql': 'graphql',
    'gql': 'graphql'
  }
  return languageMap[ext] || 'text'
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [projectPath]: ProjectsService
  }
}
