import type { HookContext } from '../declarations'

export const softDelete = async (context: HookContext) => {
  if (context.method === 'remove') {
    context.result = await context.service.patch(context.id!, {
      deletedAt: new Date().toISOString()
    })
    return context
  }
}

export const excludeDeleted = async (context: HookContext) => {
  if (!context.params.query) context.params.query = {}
  context.params.query.deletedAt = null
}
