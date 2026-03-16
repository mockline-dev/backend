import { authenticate } from '@feathersjs/authentication'
import { disallow } from 'feathers-hooks-common'
import { getProvider } from '../../llm/providers/registry'
import { parseEnhancePromptResponse } from '../../utils/parseMarkdown'

const ENHANCE_PROMPT_SYSTEM = `You are a senior backend solution architect and prompt engineer.

Your job is to transform a raw user request into a professional, implementation-ready backend prompt for code generation.

Enhancement rules:
1) Preserve user intent exactly; do not invent product scope that user did not ask for.
2) Use framework and language as hard constraints.
3) Expand requirements into a practical backend specification covering:
   - domain entities and data expectations
   - API behavior and route responsibilities
   - validation and error-handling standards
   - project structure and modular boundaries
   - test expectations and quality constraints
4) If the request is ambiguous, proceed with best-practice assumptions and list them explicitly.
5) Keep output actionable and professional.

Output rules:
- Return ONLY valid JSON (no markdown).
- Required shape:
{
  "enhancedPrompt": "string",
  "assumptions": ["string"],
  "clarifications": ["string"]
}`

type EnhancePromptInput = {
  userPrompt: string
  framework?: 'fast-api' | 'feathers'
  language?: 'python' | 'typescript'
}

type EnhancePromptOutput = {
  enhancedPrompt: string
  assumptions: string[]
  clarifications: string[]
}

export default function (app: any) {
  app.use('/enhance-prompt', {
    async create(data: EnhancePromptInput): Promise<EnhancePromptOutput> {
      const { userPrompt, framework, language } = data
      if (!userPrompt || typeof userPrompt !== 'string') {
        throw new Error('Prompt is required and must be a string.')
      }

      if (userPrompt.trim().length < 20) {
        throw new Error('Prompt is too short. Minimum length is 20 characters.')
      }

      try {
        const enhancementInput = [
          `Framework: ${framework || 'not specified'}`,
          `Language: ${language || 'not specified'}`,
          'Behavior mode: auto-enhance with explicit assumptions when details are missing.',
          'Write the enhanced prompt as a detailed implementation specification that remains concise and directly actionable.',
          'User prompt:',
          userPrompt
        ].join('\n')

        const ollamaConfig = app.get('ollama')
        const provider = getProvider()
        const aiResponse = await provider.generate(ENHANCE_PROMPT_SYSTEM, enhancementInput, {
          model: ollamaConfig.roleModels?.utility || ollamaConfig.models?.fast || ollamaConfig.model,
          temperature: 0.35,
          num_predict: ollamaConfig.numPredict,
          num_ctx: ollamaConfig.numCtx,
          top_p: ollamaConfig.topP
        })
        const parsedResponse = parseEnhancePromptResponse(aiResponse)

        if (!parsedResponse.enhancedPrompt || parsedResponse.enhancedPrompt.trim().length === 0) {
          return {
            enhancedPrompt: [
              `Build a production-ready backend using framework ${framework || 'as requested'} and language ${language || 'as requested'}.`,
              'Preserve user scope, define domain models, implement clean route/service separation, add validation, and include test coverage for core flows.',
              `Original user request:\n${userPrompt}`
            ].join('\n\n'),
            assumptions: [
              'Using standard project structure and best-practice defaults due to incomplete constraints.'
            ],
            clarifications: ['Specify authentication type', 'Specify storage/database preference']
          }
        }

        return {
          enhancedPrompt: parsedResponse.enhancedPrompt.trim(),
          assumptions: parsedResponse.assumptions || [],
          clarifications: parsedResponse.clarifications || []
        }
      } catch (error) {
        console.error('Error enhancing prompt:', error)
        throw new Error('Failed to enhance prompt. Please try again later.')
      }
    }
  })

  app.service('enhance-prompt').hooks({
    before: {
      all: [authenticate('jwt')],
      create: [
        async (context: any) => {
          const { userPrompt, framework, language } = context.data
          console.log('Received prompt for enhancement:', {
            userPrompt,
            framework,
            language
          })
          return context
        }
      ],
      update: [disallow()],
      patch: [disallow()],
      remove: [disallow()]
    }
  })
}
