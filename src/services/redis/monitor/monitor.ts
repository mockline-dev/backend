import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { KoaAdapter } from '@bull-board/koa'
import { logger } from '../../../logger'
import {
  agentQueue,
  deploymentQueue,
  embeddingQueue,
  generationQueue,
  validationQueue
} from '../queues/queues'

function basicAuth(ctx: any, next: any) {
  const auth = ctx.get('Authorization')

  if (!auth || !auth.startsWith('Basic ')) {
    ctx.status = 401
    ctx.set('WWW-Authenticate', 'Basic realm="Bull Board Admin"')
    ctx.body = 'Authentication required'
    return
  }

  try {
    const credentials = Buffer.from(auth.slice(6), 'base64').toString()
    const [username, password] = credentials.split(':')

    const adminUsername = ctx.app.get('bullBoard')?.username
    const adminPassword = ctx.app.get('bullBoard')?.password

    if (username === adminUsername && password === adminPassword) {
      return next()
    }
  } catch (error) {
    logger.error('Basic auth parsing error:', error)
  }

  ctx.status = 401
  ctx.set('WWW-Authenticate', 'Basic realm="Bull Board Admin"')
  ctx.body = 'Invalid credentials'
}

export async function initBullBoard(app: any) {
  if (!generationQueue && !validationQueue) throw new Error('Queue not initialized')

  const serverAdapter = new KoaAdapter()
  serverAdapter.setBasePath('/admin/queues')

  createBullBoard({
    queues: [
      new BullMQAdapter(generationQueue),
      new BullMQAdapter(validationQueue),
      new BullMQAdapter(agentQueue),
      new BullMQAdapter(embeddingQueue),
      new BullMQAdapter(deploymentQueue)
    ],
    serverAdapter
  })

  app.use(async (ctx: any, next: any) => {
    if (ctx.path.startsWith('/admin/queues')) {
      await basicAuth(ctx, async () => {
        return serverAdapter.registerPlugin()(ctx, next)
      })
      return
    }
    await next()
  })

  logger.info(
    `Bull Board integrated at http://${app.get('host') || 'localhost'}:${app.get('port')}/admin/queues`
  )
}
