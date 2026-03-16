export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMGenerateOptions {
  model?: string
  temperature?: number
  top_p?: number
  num_predict?: number
  num_ctx?: number
}

export interface LLMGenerateResponse {
  text: string
  model: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
}

export interface LLMStreamChunk {
  message: {
    role: 'assistant'
    content: string
  }
  done: boolean
}

export interface LLMProvider {
  id: string
  generate(systemPrompt: string, userPrompt: string, options?: LLMGenerateOptions): Promise<string>
  chatStream(
    messages: LLMMessage[],
    model?: string,
    options?: LLMGenerateOptions
  ): AsyncGenerator<LLMStreamChunk>
  healthCheck(): Promise<boolean>
}
