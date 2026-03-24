import config from 'config'
import OpenAI from 'openai'
import type { OllamaMessage, OllamaStreamChunk, OllamaToolCall } from '../ollama.client'
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
    tools?: object[],
    options: { temperature?: number; num_ctx?: number; num_predict?: number; top_p?: number } = {}
  ): AsyncGenerator<OllamaStreamChunk> {
    const openaiMessages = messages.map(m => this.toOpenAIMessage(m))

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: openaiMessages as any,
      stream: true,
      temperature: options.temperature ?? 0.3,
      top_p: options.top_p,
      max_tokens: options.num_predict
    }

    // Map Ollama-style tool definitions to OpenAI format if provided
    if (tools && tools.length > 0) {
      requestParams.tools = tools.map((t: any) => ({
        type: 'function',
        function: {
          name: t.function?.name ?? t.name,
          description: t.function?.description ?? t.description ?? '',
          parameters: t.function?.parameters ?? t.parameters ?? {}
        }
      }))
    }

    const stream = await this.client.chat.completions.create(requestParams)

    // Buffer for accumulating streamed tool call arguments
    const toolCallBuffer = new Map<number, OllamaToolCall>()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const done = chunk.choices[0]?.finish_reason != null

      // Accumulate tool_calls from delta
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCallBuffer.has(idx)) {
            toolCallBuffer.set(idx, {
              id: tc.id ?? `tc-${idx}`,
              type: 'function',
              function: { name: tc.function?.name ?? '', arguments: '' }
            })
          }
          const existing = toolCallBuffer.get(idx)!
          if (tc.function?.name) existing.function.name = tc.function.name
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
        }
      }

      const toolCallsArr = done && toolCallBuffer.size > 0
        ? Array.from(toolCallBuffer.values())
        : undefined

      yield {
        message: {
          role: 'assistant',
          content: delta?.content ?? '',
          tool_calls: toolCallsArr
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

  private toOpenAIMessage(m: OllamaMessage): object {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id ?? '',
        content: m.content ?? ''
      }
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }))
      }
    }
    return {
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content ?? ''
    }
  }
}
