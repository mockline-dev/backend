import { ollamaClient, type OllamaMessage, type OllamaStreamChunk } from '../ollama.client'
import type { ILLMProvider } from './base'

/**
 * ILLMProvider implementation backed by the local OllamaClient.
 */
export class OllamaProvider implements ILLMProvider {
  async *chatStream(
    messages: OllamaMessage[],
    tools?: object[],
    options: { temperature?: number; num_ctx?: number; num_predict?: number; top_p?: number } = {}
  ): AsyncGenerator<OllamaStreamChunk> {
    yield* ollamaClient.chatStream(messages, tools, options)
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: { temperature?: number; num_predict?: number; num_ctx?: number; top_p?: number } = {}
  ): Promise<string> {
    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]

    let result = ''
    for await (const chunk of ollamaClient.chatStream(messages, undefined, {
      temperature: options.temperature,
      num_ctx: options.num_ctx,
      num_predict: options.num_predict,
      top_p: options.top_p
    })) {
      result += chunk.message.content
    }
    return result.trim()
  }

  async embed(text: string): Promise<number[]> {
    return ollamaClient.embed(text)
  }

  async healthCheck(): Promise<boolean> {
    return ollamaClient.healthCheck()
  }
}
