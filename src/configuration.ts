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
    r2PublicUrl: Type.String(),
    aiService: Type.Object({
      url: Type.String(),
      timeout: Type.Optional(Type.Number())
    }),
    ollama: Type.Object({
      model: Type.String(),
      numPredict: Type.Number(),
      numCtx: Type.Number(),
      temperature: Type.Number(),
      topP: Type.Number(),
      repeatPenalty: Type.Number(),
      timeout: Type.Number(),
      baseUrl: Type.Optional(Type.String())
    }),
    redis: Type.Object({
      url: Type.String()
    })
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
