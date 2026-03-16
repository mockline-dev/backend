import { Ollama } from 'ollama'

import type { LLMGenerateOptions, LLMMessage, LLMProvider, LLMStreamChunk } from './types'

export class OllamaProvider implements LLMProvider {
  id = 'ollama'

  private readonly client: Ollama
  private readonly defaultModel: string

  constructor(baseUrl: string, model: string) {
    this.client = new Ollama({ host: baseUrl })
    this.defaultModel = model
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: LLMGenerateOptions = {}
  ): Promise<string> {
    const response = await this.client.chat({
      model: options.model || this.defaultModel,
      messages: [
        ...(systemPrompt?.trim() ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: userPrompt }
      ],
      options: {
        temperature: options.temperature,
        top_p: options.top_p,
        num_predict: options.num_predict,
        num_ctx: options.num_ctx
      },
      stream: false
    })

    return response.message.content
  }

  async *chatStream(
    messages: LLMMessage[],
    model?: string,
    options: LLMGenerateOptions = {}
  ): AsyncGenerator<LLMStreamChunk> {
    const stream = await this.client.chat({
      model: model || options.model || this.defaultModel,
      messages,
      options: {
        temperature: options.temperature,
        top_p: options.top_p,
        num_predict: options.num_predict,
        num_ctx: options.num_ctx
      },
      stream: true
    })

    for await (const chunk of stream) {
      yield {
        message: {
          role: 'assistant',
          content: chunk.message.content || ''
        },
        done: Boolean(chunk.done)
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.list()
      return true
    } catch {
      return false
    }
  }
}
