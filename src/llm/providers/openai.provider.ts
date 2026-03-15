import config from 'config'
import OpenAI from 'openai'
import type { ILLMProvider } from './base'
import type { LLMMessage, LLMStreamChunk, LLMToolCall } from '../types'

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
    messages: LLMMessage[],
    tools?: object[],
    options: { temperature?: number; num_ctx?: number; num_predict?: number; top_p?: number } = {}
  ): AsyncGenerator<LLMStreamChunk> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map(m => {
      const base: any = { role: m.role, content: m.content ?? '' }
      if (m.role === 'tool') {
        base.tool_call_id = m.tool_call_id
      }
      if (m.role === 'assistant' && m.tool_calls) {
        base.tool_calls = m.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: tc.type,
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }))
        if (!base.content) {
          base.content = null
        }
      }
      return base as OpenAI.ChatCompletionMessageParam
    })

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: tools && tools.length > 0 ? (tools as any) : undefined,
      stream: true,
      temperature: options.temperature ?? 0.3,
      top_p: options.top_p,
      max_tokens: options.num_predict
    })

    let accumulatedToolCalls: LLMToolCall[] | undefined = undefined

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const done = chunk.choices[0]?.finish_reason != null

      let chunkToolCalls: LLMToolCall[] | undefined = undefined

      if (delta?.tool_calls) {
        if (!accumulatedToolCalls) accumulatedToolCalls = []

        for (const tcDelta of delta.tool_calls) {
          const index = tcDelta.index
          if (!accumulatedToolCalls[index]) {
            accumulatedToolCalls[index] = {
              id: tcDelta.id ?? '',
              type: 'function',
              function: {
                name: tcDelta.function?.name ?? '',
                arguments: tcDelta.function?.arguments ?? ''
              }
            }
          } else {
            if (tcDelta.function?.arguments) {
              accumulatedToolCalls[index].function.arguments += tcDelta.function.arguments
            }
          }
        }
      }

      // Yield fully formed tool calls once at the end to prevent duplicates in engine
      if (done && accumulatedToolCalls) {
        chunkToolCalls = accumulatedToolCalls.filter(Boolean)
      }

      yield {
        message: {
          role: 'assistant',
          content: delta?.content ?? '',
          tool_calls: chunkToolCalls
        },
        done,
        eval_count: undefined,
        prompt_eval_count: undefined
      } as LLMStreamChunk
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
