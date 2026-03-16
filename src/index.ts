import { app } from './app'
import { validateConfig } from './config.validator'
import { ollamaClient } from './llm/ollama.client'
import { logger } from './logger'

// Validate configuration before starting
validateConfig()

const port = app.get('port')
const host = app.get('host')

process.on('unhandledRejection', reason => logger.error('Unhandled Rejection %O', reason))

// Check Ollama health on startup
;(async () => {
  const ollamaReady = await ollamaClient.healthCheck()
  if (!ollamaReady) {
    logger.warn('Ollama is not reachable at startup — AI features will fail')
  } else {
    logger.info('Ollama health check passed')

    try {
      await ollamaClient.ensureRoleModelsAvailable([
        'planner',
        'generator',
        'fixer',
        'critic',
        'utility',
        'intent',
        'reflection'
      ])
      logger.info('Required Ollama role models are available')
    } catch (error: any) {
      logger.warn('Unable to ensure Ollama role models at startup: %s', error?.message || 'unknown error')
    }
  }
})()

app.listen(port).then(() => {
  logger.info(`Feathers app listening on http://${host}:${port}`)
})
