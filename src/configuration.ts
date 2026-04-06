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
    llm: Type.Object({
      groq: Type.Object({
        apiKey: Type.String(),
        defaultModel: Type.String(),
        classifierModel: Type.String()
      }),
      minimax: Type.Object({
        apiKey: Type.String(),
        baseUrl: Type.String(),
        defaultModel: Type.String()
      }),
      contextWindow: Type.Number(),
      maxResponseTokens: Type.Number(),
      timeout: Type.Number()
    }),
    chromadb: Type.Object({
      host: Type.String(),
      port: Type.Number()
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
    sandbox: Type.Object({
      provider: Type.String(),
      timeoutMs: Type.Number(),
      maxRetries: Type.Number(),
      opensandbox: Type.Object({
        domain: Type.String(),
        apiKey: Type.String(),
        protocol: Type.String(),
        defaultImage: Type.String()
      })
    }),
    indexing: Type.Object({
      enabled: Type.Boolean(),
      periodicSyncIntervalMs: Type.Number(),
      maxFilesPerSync: Type.Number()
    })
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
