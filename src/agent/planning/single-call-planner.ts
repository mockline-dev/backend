import { z } from 'zod'

import type { ChatMessage, OllamaClient } from '../../llm/client'
import { getModelConfig } from '../../llm/client'
import { structuredLLMCall } from '../../llm/structured-output'

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const LLMFieldSchema = z.object({
  name: z.string().min(1),
  /** Canonical type — normalizer maps variants to these */
  type: z.string().default('string'),
  nullable: z.boolean().default(true),
  unique: z.boolean().default(false),
  default: z.string().nullable().default(null),
  indexed: z.boolean().default(false),
})

const LLMRelationshipSchema = z.object({
  target: z.string().min(1),
  type: z.enum(['one-to-many', 'many-to-one', 'one-to-one', 'many-to-many']),
  fieldName: z.string().min(1),
  backref: z.string().min(1),
})

const LLMEntitySchema = z.object({
  name: z.string().min(1),
  tableName: z.string().min(1),
  fields: z.array(LLMFieldSchema),
  relationships: z.array(LLMRelationshipSchema).default([]),
  features: z.array(z.string()).default([]),
})

const LLMAuthSchema = z.object({
  required: z.boolean(),
  method: z.enum(['jwt', 'apikey', 'none']).default('jwt'),
})

export const LLMProjectPlanSchema = z.object({
  projectName: z.string().min(1),
  description: z.string().min(1),
  auth: LLMAuthSchema,
  entities: z.array(LLMEntitySchema).min(1),
  features: z.array(z.string()).default([]),
})

export type LLMProjectPlan = z.infer<typeof LLMProjectPlanSchema>
export type LLMEntity = z.infer<typeof LLMEntitySchema>
export type LLMField = z.infer<typeof LLMFieldSchema>
export type LLMRelationship = z.infer<typeof LLMRelationshipSchema>

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a software architect designing a FastAPI REST API.
Output ONLY a single JSON object. No explanation, no markdown fences.

SCHEMA:
{
  "projectName": "kebab-case-name",
  "description": "one sentence",
  "auth": { "required": true, "method": "jwt" },
  "entities": [
    {
      "name": "PascalCaseName",
      "tableName": "snake_case_plural",
      "fields": [
        { "name": "snake_case", "type": "TYPE", "nullable": false, "unique": false, "default": null, "indexed": false }
      ],
      "relationships": [
        { "target": "OtherEntity", "type": "many-to-one", "fieldName": "attribute_name", "backref": "back_name" }
      ],
      "features": []
    }
  ],
  "features": []
}

FIELD TYPES: string, text, integer, float, boolean, date, datetime, email, uuid, json, decimal

RELATIONSHIP TYPES: one-to-many, many-to-one, one-to-one, many-to-many

RULES:
- Do NOT include id, created_at, updated_at fields (added automatically)
- Entity names: PascalCase | Table names: snake_case plural | Field names: snake_case
- For auth: User entity MUST have email (type email, unique true) and hashed_password (type string) fields
- Declare each relationship only ONCE from the entity that OWNS the foreign key (the "many" side)
  - "many-to-one": THIS entity has a FK column pointing to target
  - "many-to-many": join table; declare from either side once
  - Do NOT declare "one-to-many" — use "many-to-one" from the other side

EXAMPLE — blog API with auth:
{
  "projectName": "blog-api",
  "description": "Blog platform with posts, comments and authentication",
  "auth": { "required": true, "method": "jwt" },
  "entities": [
    {
      "name": "User",
      "tableName": "users",
      "fields": [
        { "name": "email", "type": "email", "nullable": false, "unique": true, "default": null, "indexed": true },
        { "name": "hashed_password", "type": "string", "nullable": false, "unique": false, "default": null, "indexed": false },
        { "name": "is_active", "type": "boolean", "nullable": false, "unique": false, "default": "true", "indexed": false }
      ],
      "relationships": [],
      "features": []
    },
    {
      "name": "Post",
      "tableName": "posts",
      "fields": [
        { "name": "title", "type": "string", "nullable": false, "unique": false, "default": null, "indexed": false },
        { "name": "content", "type": "text", "nullable": false, "unique": false, "default": null, "indexed": false },
        { "name": "published", "type": "boolean", "nullable": false, "unique": false, "default": "false", "indexed": false }
      ],
      "relationships": [
        { "target": "User", "type": "many-to-one", "fieldName": "author", "backref": "posts" }
      ],
      "features": []
    },
    {
      "name": "Comment",
      "tableName": "comments",
      "fields": [
        { "name": "content", "type": "text", "nullable": false, "unique": false, "default": null, "indexed": false }
      ],
      "relationships": [
        { "target": "Post", "type": "many-to-one", "fieldName": "post", "backref": "comments" },
        { "target": "User", "type": "many-to-one", "fieldName": "author", "backref": "comments" }
      ],
      "features": []
    }
  ],
  "features": ["cors"]
}`

// ─── Planner ──────────────────────────────────────────────────────────────────

/**
 * Makes a SINGLE structured LLM call to extract the full project plan.
 * Returns a raw LLMProjectPlan that must be normalized before use.
 */
export async function planProject(
  client: OllamaClient,
  userPrompt: string
): Promise<LLMProjectPlan> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  const modelCfg = getModelConfig('planning')
  return structuredLLMCall(client, LLMProjectPlanSchema, messages, {
    model: modelCfg.name,
    temperature: modelCfg.temperature,
    think: modelCfg.think,
  })
}
