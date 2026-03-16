import { BaseAgent } from '../framework/base-agent'
import type { PipelineContext } from '../types'

export class IntegrationAgent extends BaseAgent {
  constructor(app: any) {
    super(app, 'assemble_project')
  }

  protected async execute(context: PipelineContext) {
    const files = [...context.files]

    if (context.framework === 'feathers') {
      const hasPackageJson = files.some(file => file.path === 'package.json')
      if (!hasPackageJson) {
        files.push({
          path: 'package.json',
          content: JSON.stringify(
            {
              name: `generated-backend-${context.projectId.slice(0, 8)}`,
              private: true,
              version: '0.1.0',
              scripts: {
                dev: 'ts-node src/index.ts',
                start: 'node lib/index.js',
                build: 'tsc -p tsconfig.json',
                test: 'vitest run'
              },
              dependencies: {
                '@feathersjs/feathers': '^5.0.0',
                '@feathersjs/koa': '^5.0.0',
                '@feathersjs/socketio': '^5.0.0'
              },
              devDependencies: {
                'ts-node': '^10.9.2',
                typescript: '^5.8.3'
              }
            },
            null,
            2
          )
        })
      }
    } else {
      const hasRequirements = files.some(file => file.path === 'requirements.txt')
      if (!hasRequirements) {
        files.push({
          path: 'requirements.txt',
          content: 'fastapi\nuvicorn[standard]\npydantic\n'
        })
      }

      const hasMainPy = files.some(file => file.path === 'main.py')
      if (!hasMainPy) {
        files.push({
          path: 'main.py',
          content:
            "from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get('/health')\nasync def health():\n    return {'status': 'ok'}\n"
        })
      }
    }

    return {
      context: {
        ...context,
        files,
        metadata: {
          ...context.metadata,
          assembledAt: Date.now()
        }
      },
      summary: 'Project assembled'
    }
  }
}
