import type { HookContext } from '../declarations'
import { logger } from '../logger'

export const logError = async (context: HookContext) => {
  if (context.error) {
    logger.error('Service error %O', {
      err: context.error,
      service: context.path,
      method: context.method,
      params: {
        userId: context.params?.user?._id,
        query: context.params?.query
      }
    })
  }
}
