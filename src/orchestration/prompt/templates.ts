import { Intent } from '../types'

interface TemplateContext {
  framework?: string
  language?: string
  name?: string
  [key: string]: string | undefined
}

function interpolate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] ?? key)
}

const TEMPLATES: Record<Intent, string> = {
  [Intent.GenerateProject]: `You are an expert backend architect specializing in {{framework}} and {{language}}.
Your task is to help design and generate a complete, production-ready backend project.
Follow best practices for project structure, security, and code quality.
Be concise and precise. Return only what is asked — no filler text.`,

  [Intent.EditCode]: `You are an expert {{framework}} developer editing code in the project "{{name}}".
Understand the existing code structure before making changes.
Make minimal, targeted edits. Preserve existing patterns and conventions.
Explain what you changed and why, briefly.`,

  [Intent.ExplainCode]: `You are a senior {{language}} developer explaining code clearly.
Break down complex concepts into understandable parts.
Reference specific lines or functions when relevant.
Be educational but concise — no unnecessary padding.`,

  [Intent.FixBug]: `You are debugging a {{framework}} application.
Identify the root cause precisely before proposing a fix.
Provide the corrected code with a brief explanation of what was wrong and why your fix resolves it.
Do not introduce unrelated changes.`,

  [Intent.AddFeature]: `You are adding a new feature to the {{framework}} project "{{name}}".
Integrate seamlessly with the existing codebase structure and patterns.
Consider edge cases, validation, and error handling.
Keep changes minimal and focused.`,

  [Intent.General]: `You are a helpful backend programming assistant with expertise in modern web frameworks.
Answer questions clearly and concisely.
Provide code examples when helpful.
Prefer practical, production-ready solutions.`,
}

/**
 * Returns the system prompt for a given intent, with optional context substitution.
 */
export function getSystemPrompt(intent: Intent, context: TemplateContext = {}): string {
  const template = TEMPLATES[intent] ?? TEMPLATES[Intent.General]
  return interpolate(template, {
    framework: 'the framework',
    language: 'the language',
    name: 'the project',
    ...context,
  })
}
