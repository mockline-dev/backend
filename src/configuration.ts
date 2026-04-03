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
      embedModel: Type.String(),
      numPredict: Type.Number(),
      numCtx: Type.Number(),
      temperature: Type.Number(),
      topP: Type.Number(),
      repeatPenalty: Type.Number(),
      timeout: Type.Number(),
      baseUrl: Type.Optional(Type.String())
    }),
    redisConfig: Type.Object({
      host: Type.String(),
      port: Type.Number(),
      username: Type.Union([Type.String(), Type.Null()]),
      password: Type.String(),
      db: Type.Number()
    }),
    jobs: Type.Record(
      Type.String(),
      Type.Object({
        enabled: Type.Boolean(),
        delay: Type.Number()
      })
    ),
    bullBoard: Type.Object({
      username: Type.String(),
      password: Type.String()
    }),
    firebase: Type.Object({
      serviceAccountPath: Type.String()
    }),
    models: Type.Object({
      planning: Type.Object({ name: Type.String(), temperature: Type.Number(), think: Type.Boolean(), timeout: Type.Number() }),
      generation: Type.Object({ name: Type.String(), temperature: Type.Number(), think: Type.Boolean(), timeout: Type.Number() }),
      fixing: Type.Object({ name: Type.String(), temperature: Type.Number(), think: Type.Boolean(), timeout: Type.Number() }),
      editing: Type.Object({ name: Type.String(), temperature: Type.Number(), think: Type.Boolean(), toolCalling: Type.Optional(Type.Boolean()), timeout: Type.Number() }),
      conversation: Type.Object({ name: Type.String(), temperature: Type.Number(), think: Type.Boolean(), timeout: Type.Number() })
    }),
    llm: Type.Object({
      provider: Type.String(),
      planning: Type.Object({ temperature: Type.Number() }),
      generation: Type.Object({ temperature: Type.Number() }),
      conversation: Type.Object({ temperature: Type.Number() }),
      timeout: Type.Number(),
      complexTimeout: Type.Number(),
      maxRetries: Type.Number(),
      maxContextTokens: Type.Number()
    }),
    validation: Type.Object({
      venvBasePath: Type.String(),
      maxFixRounds: Type.Number(),
      bootTestTimeout: Type.Number(),
      bootTestPort: Type.Number()
    }),
    templates: Type.Object({
      dir: Type.String(),
      versionMapPath: Type.String()
    }),
    chromadb: Type.Object({
      host: Type.String(),
      port: Type.Number(),
      collection: Type.String()
    }),
    queue: Type.Object({
      concurrency: Type.Number(),
      retryAttempts: Type.Number(),
      backoffDelay: Type.Number()
    })
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
