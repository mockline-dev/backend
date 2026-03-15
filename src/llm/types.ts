export interface LLMToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: LLMToolCall[]
  tool_call_id?: string
  name?: string
}

export interface LLMStreamChunk {
  message: {
    role: string
    content: string | null
    tool_calls?: LLMToolCall[]
  }
  done: boolean
  eval_count?: number
  prompt_eval_count?: number
}
