export const modelsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const
export type ModelsMethods = (typeof modelsMethods)[number]
export const modelsPath = 'models'
