import { OllamaClient } from '../../src/llm/client'
import { structuredLLMCall } from '../../src/llm/structured-output'
import { z } from 'zod'

async function main() {
  const client = new OllamaClient()

  // Test 1: Basic chat
  console.log('\n=== Test 1: Basic chat ===')
  try {
    const response = await client.chat({
      messages: [{ role: 'user', content: '/nothink\nRespond with just: {"status":"ok"}' }],
      format: 'json'
    })
    console.log('Response content:', response.content)
    const parsed = JSON.parse(response.content)
    console.log('Parsed JSON:', parsed)
    console.log('✓ Basic chat: OK')
  } catch (err) {
    console.error('✗ Basic chat FAILED:', err)
  }

  // Test 2: Tool calling
  console.log('\n=== Test 2: Tool calling ===')
  try {
    const toolResponse = await client.chat({
      messages: [{ role: 'user', content: 'What is 2+2? Use the calculator tool.' }],
      tools: [{
        type: 'function',
        function: {
          name: 'calculator',
          description: 'Calculate a math expression',
          parameters: {
            type: 'object',
            properties: { expression: { type: 'string', description: 'Math expression to evaluate' } },
            required: ['expression']
          }
        }
      }]
    })
    console.log('Tool calls:', JSON.stringify(toolResponse.tool_calls, null, 2))
    if (toolResponse.tool_calls && toolResponse.tool_calls.length > 0) {
      console.log('✓ Tool calling: OK — got tool_calls')
    } else {
      console.log('⚠ Tool calling: Model responded without tool call (may still work)')
      console.log('  Content:', toolResponse.content.slice(0, 100))
    }
  } catch (err) {
    console.error('✗ Tool calling FAILED:', err)
  }

  // Test 3: Structured output with Zod
  console.log('\n=== Test 3: Structured output with Zod ===')
  const PingSchema = z.object({
    status: z.enum(['ok', 'error']),
    message: z.string()
  })
  try {
    const result = await structuredLLMCall(
      client,
      PingSchema,
      [{ role: 'user', content: 'Return a status object with status=ok and message="hello world"' }]
    )
    console.log('Structured result:', result)
    console.log('✓ Structured output: OK')
  } catch (err) {
    console.error('✗ Structured output FAILED:', err)
  }
}

main().catch(console.error)
