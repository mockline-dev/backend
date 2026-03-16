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
      models: Type.Optional(
        Type.Object({
          fast: Type.String(),
          smart: Type.String()
        })
      ),
      roleModels: Type.Optional(
        Type.Object({
          planner: Type.String(),
          generator: Type.String(),
          fixer: Type.String(),
          critic: Type.String(),
          utility: Type.String(),
          intent: Type.Optional(Type.String()),
          reflection: Type.Optional(Type.String())
        })
      ),
      fallbacks: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
      autoPullMissing: Type.Optional(Type.Boolean()),
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
    bullmq: Type.Optional(
      Type.Object({
        workers: Type.Optional(
          Type.Object({
            generation: Type.Optional(
              Type.Object({
                concurrency: Type.Optional(Type.Number()),
                lockDurationMs: Type.Optional(Type.Number()),
                stalledIntervalMs: Type.Optional(Type.Number()),
                maxStalledCount: Type.Optional(Type.Number())
              })
            ),
            agent: Type.Optional(
              Type.Object({
                concurrency: Type.Optional(Type.Number()),
                lockDurationMs: Type.Optional(Type.Number()),
                stalledIntervalMs: Type.Optional(Type.Number()),
                maxStalledCount: Type.Optional(Type.Number())
              })
            )
          })
        )
      })
    ),
    bullBoard: Type.Object({
      username: Type.String(),
      password: Type.String()
    }),
    firebase: Type.Object({
      serviceAccountPath: Type.String()
    })
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
