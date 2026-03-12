import { authenticate } from '@feathersjs/authentication'
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors'
import ollama from 'ollama'

const MOCKY_ASSISTANT_PROMPT = `You are Mocky, an expert backend developer assistant for the Mockline platform.
Your role is to help users improve, debug, and extend their AI-generated FastAPI backends.

When suggesting file changes, use this EXACT format:

FILE_UPDATE: [filename]
ACTION: [create|modify|delete]
DESCRIPTION: [brief description of change]
\`\`\`[language]
[updated code content]
\`\`\`

Rules:
- For ACTION: modify, ALWAYS use targeted SEARCH/REPLACE blocks. Do not return full-file content for modify.
- Use this block format for targeted modifications:
  <<<<<<< SEARCH
  [exact existing code snippet]
  =======
  [new replacement snippet]
  >>>>>>> REPLACE
- You can include multiple SEARCH/REPLACE blocks in one modify update.
- For dependency files (such as requirements.txt), preserve existing lines and only change the specific dependency lines requested.
- Only return full-file content for ACTION: create.
- One FILE_UPDATE block per file
- Keep explanations brief and put file update blocks exactly as specified
- Do not wrap FILE_UPDATE/ACTION/DESCRIPTION labels in markdown formatting
- Consider the existing project structure
- Prioritize the user's exact prompt intent and avoid unrelated refactors or formatting-only rewrites.
- Keep edits minimal, safe, and scoped to only what the user requested.
- If the user provides logs/errors, diagnose the concrete root cause from those logs first and propose targeted fixes; do not reply with generic clarification prompts.
- Follow FastAPI best practices (Pydantic v2, dependency injection, proper error handling, and minimal safe changes that satisfy the request)`

export default function (app: any) {
  app.use(
    '/ai-stream',
    {
      async create(
        data: {
          projectId: string
          message: string
          conversationHistory?: Array<{ role: string; content: string }>
          context?: { files: string[]; selectedFile?: string; selectedContent?: string }
        },
        params: any
      ) {
        const { projectId, message, conversationHistory = [], context } = data

        if (!projectId) {
          throw new BadRequest('projectId is required')
        }

        if (!message?.trim()) {
          throw new BadRequest('message is required')
        }

        const userId = params.user?._id?.toString?.()
        let project: any
        try {
          project = await app.service('projects').get(projectId)
        } catch {
          throw new NotFound('Project not found')
        }

        if (project.userId?.toString?.() !== userId) {
          throw new Forbidden('Not your project')
        }

        const sanitizedHistory = (conversationHistory || [])
          .filter(
            item =>
              item && typeof item.content === 'string' && ['system', 'user', 'assistant'].includes(item.role)
          )
          .slice(-30)

        // Build messages array for Ollama chat
        const messages = [
          { role: 'system', content: buildSystemPrompt(context) },
          ...sanitizedHistory,
          { role: 'user', content: message }
        ]

        const aiStreamService = app.service('ai-stream')

        let fullContent = ''

        // Stream using ollama.chat
        const stream = await ollama.chat({
          model: app.get('ollama').model,
          messages,
          stream: true,
          options: {
            temperature: 0.4,
            num_predict: 8192,
            num_ctx: 32768
          }
        })

        for await (const chunk of stream) {
          fullContent += chunk.message.content

          // Emit streaming chunk as a custom service event.
          aiStreamService.emit('chunk', {
            projectId,
            content: chunk.message.content,
            fullContent,
            done: chunk.done
          })
        }

        // Save the complete assistant message
        const assistantMessage = await app.service('messages').create({
          projectId,
          role: 'assistant',
          type: 'text',
          content: fullContent
        })

        // Parse for file updates and handle them
        const fileUpdates = parseFileUpdates(fullContent)
        if (fileUpdates.length > 0) {
          // Auto-snapshot before applying AI-suggested changes
          try {
            await app.service('snapshots').create({
              projectId,
              label: `Before AI edit: ${message.substring(0, 50)}`,
              trigger: 'auto-ai-edit'
            })
          } catch (snapErr: any) {
            console.error('Failed to create pre-edit snapshot:', snapErr.message)
          }

          aiStreamService.emit('file-updates', {
            projectId,
            updates: fileUpdates
          })
        }

        return {
          success: true,
          messageId: assistantMessage?._id?.toString?.() ?? assistantMessage?._id
        }
      }
    },
    {
      methods: ['create'],
      events: ['chunk', 'file-updates']
    }
  )

  app.service('ai-stream').hooks({
    before: {
      create: [authenticate('jwt')]
    }
  })
}

function buildSystemPrompt(context?: any): string {
  let prompt = MOCKY_ASSISTANT_PROMPT
  if (context?.files) {
    prompt += `\n\nCurrent project files: ${context.files.join(', ')}`
  }
  if (context?.selectedContent) {
    prompt += `\n\nCurrently selected file content:\n${context.selectedContent}`
  }
  return prompt
}

function parseFileUpdates(content: string): Array<{
  filename: string
  action: 'create' | 'modify' | 'delete'
  description: string
  content: string
  language: string
}> {
  const updates: any[] = []
  const normalized = content.replace(/\r\n/g, '\n')

  // Accept slightly noisy markdown output while still requiring structured fields.
  const pattern =
    /(?:^|\n)\s*\*{0,2}\s*FILE_UPDATE\s*:\s*(.+?)\s*\*{0,2}\s*\n\s*\*{0,2}\s*ACTION\s*:\s*(create|modify|delete)\s*\*{0,2}\s*\n\s*\*{0,2}\s*DESCRIPTION\s*:\s*(.+?)\s*\*{0,2}\s*\n```([\w+-]*)\n([\s\S]*?)```/gi

  const clean = (value: string) =>
    value
      .trim()
      .replace(/^\*+|\*+$/g, '')
      .replace(/^`+|`+$/g, '')
      .trim()

  let match
  while ((match = pattern.exec(normalized)) !== null) {
    const rawFilename = clean(match[1])
    const filename = rawFilename
      .replace(/^\[\s*/, '')
      .replace(/\s*\]$/, '')
      .trim()
    const action = clean(match[2]).toLowerCase() as 'create' | 'modify' | 'delete'
    const description = clean(match[3])
    const language = clean(match[4]) || 'text'
    const fileContent = match[5] ?? ''

    if (!filename) continue

    updates.push({
      filename,
      action,
      description,
      language,
      content: fileContent
    })
  }

  return updates
}
