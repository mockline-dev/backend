import { authenticate } from '@feathersjs/authentication'
import { disallow } from 'feathers-hooks-common'
import { llmClient, getModelConfig } from '../../llm/client'
import { stripThinkTags } from '../../llm/structured-output'
import { parseInferProjectMetaResponse } from '../../utils/parseMarkdown'

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
        const modelCfg = getModelConfig('conversation')
        const response = await llmClient.chat({
          model: modelCfg.name,
          messages: [
            { role: 'system', content: INFER_PROJECT_META_SYSTEM },
            { role: 'user', content: enhancedPrompt }
          ],
          temperature: modelCfg.temperature,
          think: modelCfg.think,
          format: 'json'
        })
        const raw = stripThinkTags(response.content)
        const parsed = parseInferProjectMetaResponse(raw)

        if (!parsed.name || !parsed.description) {
          throw new Error('Model did not return valid project metadata')
        }

        return parsed
      } catch (error) {
        console.warn(`Project meta inference failed:`, error)
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
