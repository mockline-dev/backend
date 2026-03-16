import OpenAI from 'openai'

import type { LLMGenerateOptions, LLMMessage, LLMProvider, LLMStreamChunk } from './types'

export class OpenAIProvider implements LLMProvider {
  id = 'openai'

  private readonly client: OpenAI
  private readonly defaultModel: string

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey })
    this.defaultModel = model
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: LLMGenerateOptions = {}
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      temperature: options.temperature,
      messages: [
        ...(systemPrompt?.trim() ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: userPrompt }
      ]
    })

    return response.choices[0]?.message?.content || ''
  }

  async *chatStream(
    messages: LLMMessage[],
    model?: string,
    options: LLMGenerateOptions = {}
  ): AsyncGenerator<LLMStreamChunk> {
    const response = await this.client.chat.completions.create({
      model: model || options.model || this.defaultModel,
      temperature: options.temperature,
      messages,
      stream: true
    })

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (!content) {
        continue
      }

      yield {
        message: { role: 'assistant', content },
        done: false
      }
    }

    yield {
      message: { role: 'assistant', content: '' },
      done: true
    }
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
