import { Intent } from '../types'

export interface EnhancementContext {
  framework?: string
  language?: string
  name?: string
}

const GENERATE_PROJECT_TEMPLATE = `You are a technical prompt engineer specializing in backend systems.

A user wants to generate a backend project. Enhance their prompt by:
1. Identifying and adding missing technical specifications (authentication strategy, database schema design, API endpoints, error handling patterns)
2. Making it framework/language specific based on the context provided
3. Specifying file structure expectations (e.g., "generate main.py, routes/users.py, models/user.py, requirements.txt")
4. Adding concrete implementation requirements (pagination, validation, status codes)
5. Preserving the user's original intent exactly

Context:
- Framework: {{framework}}
- Language: {{language}}
- Project: {{name}}

User's original prompt:
{{prompt}}

Return ONLY the enhanced prompt text. No explanation, no preamble. The enhanced prompt should be 2-4x more specific than the original.`

const EDIT_CODE_TEMPLATE = `You are a technical prompt engineer.

A user wants to modify existing backend code. Clarify their request by:
1. Specifying which files should be modified
2. Clarifying the exact behavior expected
3. Preserving backward compatibility requirements
4. Noting edge cases to handle

Context:
- Framework: {{framework}}
- Language: {{language}}

User's original prompt:
{{prompt}}

Return ONLY the clarified prompt. No explanation, no preamble.`

const ADD_FEATURE_TEMPLATE = `You are a technical prompt engineer.

A user wants to add a feature to an existing backend. Enhance their request by:
1. Specifying the new endpoints/functions needed
2. Clarifying database schema changes if any
3. Specifying integration points with existing code
4. Noting validation and error handling requirements

Context:
- Framework: {{framework}}
- Language: {{language}}

User's original prompt:
{{prompt}}

Return ONLY the enhanced prompt. No explanation, no preamble.`

const FIX_BUG_TEMPLATE = `You are a technical prompt engineer.

A user wants to fix a bug. Clarify the fix request by:
1. Identifying the root cause if inferrable
2. Specifying what correct behavior should look like
3. Noting related code areas that may need to change

User's original prompt:
{{prompt}}

Return ONLY the clarified prompt. No explanation, no preamble.`

export function getEnhancementTemplate(intent: Intent): string | null {
  const templateMap: Partial<Record<string, string>> = {
    [Intent.GenerateProject]: GENERATE_PROJECT_TEMPLATE,
    [Intent.EditCode]: EDIT_CODE_TEMPLATE,
    [Intent.AddFeature]: ADD_FEATURE_TEMPLATE,
    [Intent.FixBug]: FIX_BUG_TEMPLATE
  }
  return templateMap[intent as string] ?? null
}

export function interpolateTemplate(template: string, vars: { prompt: string } & EnhancementContext): string {
  return template
    .replace(/\{\{framework\}\}/g, vars.framework ?? 'not specified')
    .replace(/\{\{language\}\}/g, vars.language ?? 'not specified')
    .replace(/\{\{name\}\}/g, vars.name ?? 'unnamed project')
    .replace(/\{\{prompt\}\}/g, vars.prompt)
}
