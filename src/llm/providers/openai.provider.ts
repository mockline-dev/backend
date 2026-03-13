import config from 'config'
import OpenAI from 'openai'
import type { OllamaMessage, OllamaStreamChunk } from '../ollama.client'
import type { ILLMProvider } from './base'

/**
 * ILLMProvider implementation backed by the OpenAI API (or any OpenAI-compatible endpoint).
 *
 * Configure via config/default.json (or environment overrides):
 * {
 *   "openai": {
 *     "apiKey": "sk-...",
 *     "model": "gpt-4o-mini",
 *     "baseUrl": "https://api.openai.com/v1",   // optional — defaults to OpenAI
 *     "embedModel": "text-embedding-3-small"     // optional
 *   }
 * }
 */
export class OpenAIProvider implements ILLMProvider {
  private client: OpenAI
  private model: string
  private embedModel: string

  constructor() {
    const cfg = config.get<{
      apiKey: string
      model?: string
      baseUrl?: string
      embedModel?: string
    }>('openai')

    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl
    })
    this.model = cfg.model ?? 'gpt-4o-mini'
    this.embedModel = cfg.embedModel ?? 'text-embedding-3-small'
  }

  async *chatStream(
    messages: OllamaMessage[],
    _tools?: object[],
    options: { temperature?: number; num_ctx?: number; num_predict?: number; top_p?: number } = {}
  ): AsyncGenerator<OllamaStreamChunk> {
    const openaiMessages = messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content ?? ''
    }))

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      stream: true,
      temperature: options.temperature ?? 0.3,
      top_p: options.top_p,
      max_tokens: options.num_predict
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const done = chunk.choices[0]?.finish_reason != null

      yield {
        message: {
          role: 'assistant',
          content: delta?.content ?? ''
        },
        done,
        eval_count: undefined,
        prompt_eval_count: undefined
      } as OllamaStreamChunk
    }
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: { temperature?: number; num_predict?: number; num_ctx?: number; top_p?: number } = {}
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: options.temperature ?? 0.3,
      top_p: options.top_p,
      max_tokens: options.num_predict
    })
    return response.choices[0]?.message?.content?.trim() ?? ''
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.embedModel,
      input: text
    })
    return response.data[0].embedding
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list()
      return true
    } catch {
      return false
    }
  }
}
