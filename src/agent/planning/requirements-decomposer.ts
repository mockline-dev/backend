import type { ChatMessage, OllamaClient } from '../../llm/client'
import { getModelConfig } from '../../llm/client'
import { structuredLLMCall } from '../../llm/structured-output'

import { RequirementsSchema } from './schemas'
import type { Requirements } from './schemas'

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a software architect. Extract structured requirements from the user's project description.
Output ONLY a JSON object with this EXACT structure:
{
  "projectName": "short-kebab-name",
  "description": "one sentence description",
  "features": ["feature1", "feature2"],
  "entityNames": ["Entity1", "Entity2"],
  "authRequired": true,
  "externalPackages": []
}
Rules:
- "projectName": short kebab-case identifier (string)
- "description": one concise sentence (string)
- "features": array of strings (NOT array of objects)
- "entityNames": array of PascalCase entity name strings
- "authRequired": boolean (true/false)
- "externalPackages": array of pip package name strings (usually empty)
Return the JSON object directly with no wrapper.

Authentication rules:
- Set "authRequired": true if the prompt contains ANY of: login, logout, register,
  authentication, auth, JWT, token, bearer, user management, sign in, sign up, password
- When authRequired is true, ALWAYS include "User" in entityNames

Entity extraction rules:
- List EVERY persistent domain concept as its own entity
- Examples:
  "task manager with projects and users" → ["User", "Project", "Task"]
  "blog with posts and comments" → ["User", "Post", "Comment"]
  "e-commerce with orders" → ["User", "Product", "Order", "OrderItem"]
- DO NOT merge entities or omit any obvious domain concept
- DO include "User" whenever authRequired is true`

// ─── Decomposer ───────────────────────────────────────────────────────────────

/**
 * Calls the LLM once to decompose a free-text project description into
 * a structured Requirements object (entity names, features, auth flag, etc.).
 */
export async function decomposeRequirements(
  client: OllamaClient,
  userPrompt: string
): Promise<Requirements> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  const modelCfg = getModelConfig('planning')
  return structuredLLMCall(client, RequirementsSchema, messages, {
    model: modelCfg.name,
    temperature: modelCfg.temperature,
    think: modelCfg.think,
  })
}
