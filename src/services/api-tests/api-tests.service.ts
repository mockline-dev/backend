import { authenticate } from '@feathersjs/authentication'
import { NotFound, BadRequest } from '@feathersjs/errors'
import type { Application } from '../../declarations'
import { r2Client } from '../../storage/r2.client'
import { logger } from '../../logger'

/**
 * GET /api-tests?projectId=<id>
 *
 * Returns the generated API test collection JSON for the specified project.
 * The test collection is stored as `api-tests.json` in R2 under the project's prefix.
 * JWT authentication required; project ownership is verified.
 */
const apiTestsService = (app: Application) => {
  app.use('api-tests', {
    async find(params: any) {
      const projectId = params.query?.projectId
      if (!projectId) {
        throw new BadRequest('projectId query parameter is required')
      }

      // Verify project ownership
      const user = params.user
      const project = await app.service('projects').get(projectId, { user })

      const key = `projects/${projectId}/api-tests.json`

      try {
        const content = await r2Client.getObject(key)
        return JSON.parse(content)
      } catch (err: any) {
        logger.warn('api-tests: failed to read %s: %s', key, err.message)
        throw new NotFound(`API test collection not found for project ${projectId}. Run code generation first.`)
      }
    }
  })

  app.service('api-tests').hooks({
    before: {
      all: [authenticate('jwt')]
    }
  })
}

export default apiTestsService

declare module '../../declarations' {
  interface ServiceTypes {
    'api-tests': any
  }
}
