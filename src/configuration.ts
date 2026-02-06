import type { Static } from '@feathersjs/typebox'
import { Type, defaultAppConfiguration, getValidator } from '@feathersjs/typebox'

import { dataValidator } from './validators'

export const configurationSchema = Type.Intersect([
  defaultAppConfiguration,
  Type.Object({
    host: Type.String(),
    port: Type.Number(),
    public: Type.String(),
    aws: Type.Object({
      endpoint: Type.String(),
      region: Type.String(),
      accessKeyId: Type.String(),
      secretAccessKey: Type.String(),
      bucket: Type.String()
    }),
    aiService: Type.Object({
      url: Type.String(),
      timeout: Type.Optional(Type.Number())
    })
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
