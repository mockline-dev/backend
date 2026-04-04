import { authenticate } from '@feathersjs/authentication'
import { disallow } from 'feathers-hooks-common'
import { getProvider } from '../../llm/providers/registry'
import { parseInferProjectMetaResponse } from '../../utils/parseMarkdown'
import { safeGenerate, SafeGenerateError } from '../../llm/safe-llm-call'

const INFER_PROJECT_META_SYSTEM = `You are an expert product strategist for AI code generation systems.

Your task is to infer a concise backend project name and description from an enhanced user prompt.

### REQUIREMENTS
1. Name must be short and clear.
2. Name max length: 60 characters.
3. Description must be one sentence.
4. Preserve the original user intent.
5. Output must be deterministic and technical.

### OUTPUT FORMAT (STRICT)
Return ONLY valid JSON using this exact format:

{"name":"Project Name","description":"One sentence backend project description."}

Do not include markdown, explanations, code fences, or extra keys.`

export default function (app: any) {
  app.use('/infer-project-meta', {
    async create(data: { enhancedPrompt: string }) {
      const { enhancedPrompt } = data

      if (!enhancedPrompt || enhancedPrompt.trim().length < 20) {
        throw new Error('Enhanced prompt is too short.')
      }

      try {
        const ollamaConfig = app.get('ollama')
        const provider = getProvider()
        const aiResponse = await safeGenerate(provider, INFER_PROJECT_META_SYSTEM, enhancedPrompt, {
          temperature: 0.7,
          num_predict: ollamaConfig.numPredict,
          num_ctx: ollamaConfig.numCtx,
          top_p: ollamaConfig.topP,
          purpose: 'infer-project-meta',
          timeoutMs: 60_000
        })
        const parsed = parseInferProjectMetaResponse(aiResponse)

        if (!parsed.name || !parsed.description) {
          throw new Error('Model did not return valid project metadata')
        }

        return parsed
      } catch (error) {
        if (error instanceof SafeGenerateError) {
          console.warn(`Project meta inference failed (${error.reason}): ${error.message}`)
          throw new Error('Failed to infer project metadata. Please try again later.')
        }
        console.error('Error inferring project metadata:', error)
        throw new Error('Failed to infer project metadata. Please try again later.')
      }
    }
  })

  app.service('infer-project-meta').hooks({
    before: {
      all: [authenticate('jwt')],
      create: [
        async (context: any) => {
          const { enhancedPrompt } = context.data
          console.log('Received enhanced prompt for project metadata inference:', enhancedPrompt)
          return context
        }
      ],
      update: [disallow()],
      patch: [disallow()],
      remove: [disallow()]
    }
  })
}
