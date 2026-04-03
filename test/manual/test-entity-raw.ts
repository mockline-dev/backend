import { OllamaClient } from '../../src/llm/client'

async function main() {
  const client = new OllamaClient()

  const response = await client.chat({
    messages: [
      {
        role: 'system',
        content: 'You are a database architect. Define SQLAlchemy model fields for a single entity. Use snake_case for all field names. Available types: string, text, number, float, boolean, date, email, password. Use a "reference" object for foreign key columns. Respond with JSON only.'
      },
      {
        role: 'user',
        content: 'Project: A task management API\n\nAll entities in this project: User, Project, Task\n\nAlready defined entities:\nNone extracted yet.\n\nDefine the "User" entity with all its fields, types, constraints, and any foreign key references to other entities.'
      }
    ],
    format: 'json',
    temperature: 0.1,
    think: true
  })

  console.log('RAW RESPONSE:')
  console.log(response.content)
  console.log('\nParsed JSON:')
  const parsed = JSON.parse(response.content)
  console.log(JSON.stringify(parsed, null, 2))
}

main().catch(console.error)
