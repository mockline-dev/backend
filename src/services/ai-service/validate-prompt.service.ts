import { authenticate } from '@feathersjs/authentication'
import { disallow } from 'feathers-hooks-common'
import { getProvider } from '../../llm/providers/registry'
import { safeGenerate, SafeGenerateError } from '../../llm/safe-llm-call'

interface ValidatePromptRequest {
  prompt: string
  context?: string
}

interface ValidatePromptResponse {
  isValid: boolean
  confidence: number
  category: string
  reason: string
  suggestions?: string[]
  error?: string
}

export default function (app: any) {
  const ollamaConfig = app.get('ollama')

  app.use('validate-prompt', {
    async create(data: ValidatePromptRequest): Promise<ValidatePromptResponse> {
      const { prompt, context } = data

      try {
        if (!prompt || typeof prompt !== 'string') {
          return {
            isValid: false,
            confidence: 0,
            category: 'invalid',
            reason: 'Prompt is required and must be a string'
          }
        }

        // Basic validation
        if (prompt.trim().length < 10) {
          return {
            isValid: false,
            confidence: 0.9,
            category: 'too-short',
            reason: 'Prompt is too short. Please provide more details about your requirements.',
            suggestions: [
              'Describe what kind of API endpoints you need',
              'Specify authentication requirements',
              'Mention database models you want to include',
              'Add details about data validation rules'
            ]
          }
        }

        // Check for backend/API keywords
        const promptLower = prompt.toLowerCase()
        const backendKeywords = [
          'api',
          'backend',
          'server',
          'endpoint',
          'database',
          'fastapi',
          'rest',
          'crud',
          'auth',
          'user',
          'model',
          'service',
          'controller'
        ]
        const hasBackendKeywords = backendKeywords.some(keyword => promptLower.includes(keyword))

        if (!hasBackendKeywords) {
          return {
            isValid: true,
            confidence: 0.6,
            category: 'general',
            reason:
              'Prompt lacks specific backend/API keywords. The AI will generate a general FastAPI template.',
            suggestions: [
              'Add specific API endpoints you need (e.g., "create user API", "product management")',
              'Specify authentication requirements (e.g., "JWT auth", "OAuth")',
              'Mention database models (e.g., "User model", "Product model")',
              'Include data validation requirements'
            ]
          }
        }

        // Use AI for advanced validation if available
        try {
          const validationPrompt = `Analyze this backend development prompt and provide a brief assessment:

Prompt: "${prompt}"

${context ? `Context: ${context}` : ''}

Respond in this exact JSON format:
{
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "category": "fastapi|rest-api|database|auth|general",
  "reason": "brief explanation",
  "suggestions": ["optional suggestion 1", "optional suggestion 2"]
}

Keep the response concise and focused on backend development feasibility.`

          const provider = getProvider()
          let aiResponseText: string
          try {
            aiResponseText = await safeGenerate(provider, '', validationPrompt, {
              temperature: 0.2,
              num_predict: 500,
              purpose: 'validate-prompt',
              timeoutMs: 30_000
            })
          } catch (err) {
            if (err instanceof SafeGenerateError) {
              throw err  // rethrow to outer catch
            }
            throw err
          }

          // Try to parse JSON response
          try {
            // Extract JSON from response
            const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              const aiResult = JSON.parse(jsonMatch[0])
              return {
                isValid: aiResult.isValid !== undefined ? aiResult.isValid : true,
                confidence: aiResult.confidence || 0.8,
                category: aiResult.category || 'general',
                reason: aiResult.reason || 'AI validation completed',
                suggestions: aiResult.suggestions || []
              }
            }
          } catch (parseError) {
            console.warn('Failed to parse AI validation response:', parseError)
          }

          // Fallback to basic validation if AI parsing fails
          return {
            isValid: true,
            confidence: 0.7,
            category: this.categorizePrompt(promptLower),
            reason: 'AI validation available, using basic validation',
            suggestions: this.generateSuggestions(promptLower)
          }
        } catch (aiError) {
          console.warn('AI validation unavailable, using basic validation:', aiError)
          return {
            isValid: true,
            confidence: 0.6,
            category: this.categorizePrompt(promptLower),
            reason: 'AI validation unavailable, using basic validation',
            suggestions: this.generateSuggestions(promptLower)
          }
        }
      } catch (error) {
        console.error('Error validating prompt:', error)
        return {
          isValid: true,
          confidence: 0.5,
          category: 'general',
          reason: 'Validation error occurred, proceeding with default settings',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    },

    categorizePrompt(promptLower: string): string {
      if (promptLower.includes('auth') || promptLower.includes('login') || promptLower.includes('jwt')) {
        return 'auth'
      }
      if (promptLower.includes('database') || promptLower.includes('model') || promptLower.includes('sql')) {
        return 'database'
      }
      if (promptLower.includes('crud') || promptLower.includes('rest')) {
        return 'rest-api'
      }
      if (promptLower.includes('fastapi') || promptLower.includes('python')) {
        return 'fastapi'
      }
      return 'general'
    },

    generateSuggestions(promptLower: string): string[] {
      const suggestions: string[] = []

      if (!promptLower.includes('auth')) {
        suggestions.push('Consider adding authentication requirements')
      }
      if (!promptLower.includes('database')) {
        suggestions.push('Specify if you need database models')
      }
      if (!promptLower.includes('validation')) {
        suggestions.push('Mention data validation requirements')
      }
      if (!promptLower.includes('error')) {
        suggestions.push('Define error handling preferences')
      }

      return suggestions.length > 0 ? suggestions : ['Your prompt looks good! Ready to generate.']
    },

    async find(params: any) {
      return {
        service: 'validate-prompt',
        status: 'available',
        capabilities: [
          'basic-prompt-validation',
          'keyword-analysis',
          'ai-powered-validation',
          'suggestion-generation'
        ]
      }
    }
  })

  app.service('validate-prompt' as any).hooks({
    around: {
      find: [disallow('external')],
      get: [disallow('external')],
      update: [disallow('external')],
      patch: [disallow('external')],
      remove: [disallow('external')]
    },
    before: {
      all: [authenticate('jwt')]
    }
  })
}
