import type { OllamaMessage, OllamaStreamChunk } from '../ollama.client'

export interface ILLMProvider {
  /**
   * Streaming chat. Yields chunks token-by-token.
   */
  chatStream(
    messages: OllamaMessage[],
    tools?: object[],
    options?: { temperature?: number; num_ctx?: number; num_predict?: number; top_p?: number }
  ): AsyncGenerator<OllamaStreamChunk>

  /**
   * Non-streaming generate — accumulates chatStream internally.
   * Useful for single-turn prompts that need the full response at once.
   */
  generate(
    systemPrompt: string,
    userPrompt: string,
    options?: { temperature?: number; num_predict?: number; num_ctx?: number; top_p?: number }
  ): Promise<string>

  /**
   * Create an embedding vector for the given text.
   */
  embed(text: string): Promise<number[]>

  /**
   * Returns true when the provider endpoint is reachable.
   */
  healthCheck(): Promise<boolean>
}
