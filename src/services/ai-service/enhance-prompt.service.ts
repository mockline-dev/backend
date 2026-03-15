import { authenticate } from '@feathersjs/authentication'
import { disallow } from 'feathers-hooks-common'
import { getProvider } from '../../llm/providers/registry'
import { parseEnhancePromptResponse } from '../../utils/parseMarkdown'
import { logger } from '../../logger'

const ENHANCE_PROMPT_SYSTEM = `You are an expert software prompt engineer specialized in preparing high-quality prompts for coding AI models such as Qwen-Coder.

Your task is to transform the user’s raw prompt into a clear, professional, and technically detailed prompt that enables Qwen-Coder to generate accurate and high-quality code.

### OBJECTIVE
Improve the user's prompt by making it precise, structured, and complete while preserving the original intent.

### WHAT YOU MUST DO
1. Analyze the user's prompt carefully.
2. Identify missing technical details, ambiguities, or vague instructions.
3. Rewrite the prompt so it is clear, professional, and optimized for a coding AI.
4. Expand the prompt with relevant technical context when necessary.
5. Ensure the prompt contains enough details for deterministic code generation.

### WHEN IMPROVING THE PROMPT
Include relevant information such as:
- Programming language(s)
- Frameworks or libraries
- Expected architecture or structure
- Input and output formats
- Edge cases and constraints
- Performance considerations
- File structure if relevant
- API design or data models if applicable
- Error handling expectations
- Best practices and coding standards

### PROMPT QUALITY REQUIREMENTS
The improved prompt should:
- Be precise and unambiguous
- Be structured and easy for an AI model to follow
- Include explicit requirements and constraints
- Avoid unnecessary explanations
- Focus on generating high-quality code

### OUTPUT FORMAT (STRICT)
Return ONLY a valid JSON object using the format below:

{"enhancedPrompt": "[Improved, structured, and detailed version of the user's prompt]"}

Do not include explanations, comments, markdown code fences, or any text outside the JSON object.`

export default function (app: any) {
  app.use('/enhance-prompt', {
    async create(data: { userPrompt: string }) {
      const { userPrompt } = data
      if (userPrompt.length < 100) {
        throw new Error('Prompt is too short. Minimum length is 100 characters.')
      }

      try {
        const ollamaConfig = app.get('ollama')
        const provider = getProvider()
        const aiResponse = await provider.generate(ENHANCE_PROMPT_SYSTEM, userPrompt, {
          temperature: 0.7,
          num_predict: ollamaConfig.numPredict,
          num_ctx: ollamaConfig.numCtx,
          top_p: ollamaConfig.topP
        })
        const parsedResponse = parseEnhancePromptResponse(aiResponse)
        return parsedResponse
      } catch (error) {
        logger.error('Error enhancing prompt:', error)
        throw new Error('Failed to enhance prompt. Please try again later.')
      }
    }
  })

  app.service('enhance-prompt').hooks({
    before: {
      all: [authenticate('jwt')],
      create: [
        async (context: any) => {
          const { userPrompt } = context.data
          logger.info('Received prompt for enhancement:', userPrompt)
          return context
        }
      ],
      update: [disallow()],
      patch: [disallow()],
      remove: [disallow()]
    }
  })
}
