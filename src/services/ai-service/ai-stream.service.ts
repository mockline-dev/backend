import { authenticate } from '@feathersjs/authentication'
import ollama from 'ollama'

const MOCKY_ASSISTANT_PROMPT = `You are Mocky, an expert backend developer assistant for the Mockline platform.
Your role is to help users improve, debug, and extend their AI-generated FastAPI backends.

When suggesting file changes, use this EXACT format:

FILE_UPDATE: [filename]
ACTION: [create|modify|delete]
DESCRIPTION: [brief description of change]
\`\`\`[language]
[complete new file content]
\`\`\`

Rules:
- Always provide complete file contents (no partial updates or diffs)
- One FILE_UPDATE block per file
- Explain your changes before showing them
- Consider the existing project structure
- Follow FastAPI best practices (Pydantic v2, dependency injection, proper error handling)`

export default function (app: any) {
  app.use('/ai-stream', {
    async create(data: {
      projectId: string
      message: string
      conversationHistory?: Array<{ role: string; content: string }>
      context?: { files: string[]; selectedFile?: string; selectedContent?: string }
    }) {
      const { projectId, message, conversationHistory = [], context } = data

      // Build messages array for Ollama chat
      const messages = [
        { role: 'system', content: buildSystemPrompt(context) },
        ...conversationHistory,
        { role: 'user', content: message }
      ]

      // Get Socket.IO connection for this project
      const channel = app.channel(`projects/${projectId}`)

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

        // Emit each chunk via Socket.IO
        channel.send({
          type: 'ai-stream::chunk',
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

        channel.send({
          type: 'ai-stream::file-updates',
          projectId,
          updates: fileUpdates
        })
      }

      return { success: true, messageId: assistantMessage._id }
    }
  })

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
  const pattern = /FILE_UPDATE:\s*([^\n]+)\nACTION:\s*(create|modify|delete)\nDESCRIPTION:\s*([^\n]+)\n```(\w*)\n([\s\S]*?)```/g
  let match
  while ((match = pattern.exec(content)) !== null) {
    updates.push({
      filename: match[1].trim(),
      action: match[2].trim(),
      description: match[3].trim(),
      language: match[4] || 'text',
      content: match[5]
    })
  }
  return updates
}
