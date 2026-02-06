import { authenticate } from '@feathersjs/authentication'
import ollama from 'ollama'
import { uploadFileToR2 } from '../../utils/uploadFileToR2'

interface AIRequest {
  projectId: string
  prompt: string
  context?: string
  temperature?: number
  maxTokens?: number
  generateFiles?: boolean
}

interface AIResponse {
  success: boolean
  response: string
  generatedFiles?: Array<{
    filename: string
    originalFilename?: string
    content: string
    fileUrl?: string
    fileId?: string
    size?: number
    uploadSuccess?: boolean
    uploadTime?: string
    error?: string
  }>
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  error?: string
}

// New system prompt using markdown format - much more reliable than JSON
const FASTAPI_SYSTEM_PROMPT = `You are an expert Python FastAPI backend developer.
Your task is to generate a complete, production-ready FastAPI application based on the user's requirements.

### OUTPUT FORMAT:
You MUST respond with a markdown document in this EXACT structure:

## Explanation
[Brief one-sentence summary of what was generated]

## Files

### File: [filename]
\`\`\`[language]
[Full file content]
\`\`\`

### File: [another-filename]
\`\`\`[language]
[Full file content]
\`\`\`

### TECHNICAL REQUIREMENTS:
Generate production-ready code with:
- Modern FastAPI best practices (Pydantic v2, routers, dependencies)
- Complete error handling and validation
- Type hints and docstrings
- Security best practices
- CORS middleware, environment configuration
- Standard project structure
- No TODOs or placeholders

IMPORTANT:
- Each file MUST start with "### File: " followed by the filename
- Use proper markdown code blocks with language identifiers
- Include ALL necessary files (main.py, requirements.txt, .env.example, README.md, etc.)
- Do NOT use JSON format
- Do NOT escape special characters - use raw markdown

Respond ONLY with the markdown document, no additional text.`

export default function (app: any) {
  const initializeModel = async () => {
    try {
      const models = await ollama.list()
      const hasModel = models.models.some((m: any) => m.name.includes('llama3.2:3b'))
      
      if (!hasModel) {
        console.log('Initializing Llama 3.2:3b for FastAPI generation...')
        await ollama.pull({ model: 'llama3.2:3b', stream: false })
        console.log('Model ready for FastAPI generation')
      }
      
      return true
    } catch (error) {
      console.error('Failed to initialize model:', error)
      return false
    }
  }

  // Initialize model on service startup
  initializeModel()

  app.use('/ai-service', {
    async create(params: AIRequest): Promise<AIResponse> {
      const { 
        projectId, 
        prompt, 
        context, 
        temperature = 0.3,
        maxTokens = 4000,
        generateFiles = true
      } = params
      
      console.log('====================================')
      console.log('AI Service Request:', { 
        projectId, 
        promptLength: prompt.length,
        hasContext: !!context,
        temperature,
        maxTokens 
      })
      console.log('====================================')
      
      try {
        // Validate input
        if (!prompt || prompt.trim().length === 0) {
          throw new Error('Prompt is required')
        }

        if (!projectId) {
          throw new Error('Project ID is required')
        }

        console.log(`Generating FastAPI backend for project: ${projectId}`)
        
        // Construct prompt specifically for FastAPI generation
        const fastapiPrompt = this.constructFastAPIPrompt(prompt, context)
        
        // Generate response from model with optimized parameters
        const response = await ollama.generate({
          model: 'llama3.2:3b',
          prompt: fastapiPrompt,
          system: FASTAPI_SYSTEM_PROMPT,
          options: {
            temperature: Math.max(0.1, Math.min(temperature, 0.7)), // Clamp temperature
            num_predict: Math.min(maxTokens, 8000), // Limit max tokens
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ['<|eot_id|>', '<|end_of_text|>']
          },
          stream: false
        })

        const aiResponse = response.response.trim()
        
        console.log('====================================')
        console.log('Raw AI Response Length:', aiResponse.length)
        console.log('First 500 chars:', aiResponse.substring(0, 500))
        console.log('====================================')
        
        // Parse markdown response
        const parsedResponse = this.parseMarkdownResponse(aiResponse)
        
        console.log('Parsed explanation:', parsedResponse.explanation)
        console.log('Number of files parsed:', parsedResponse.files.length)
        
        // Process and upload files if requested
        let generatedFiles = []
        if (generateFiles && parsedResponse.files.length > 0) {
          console.log(`Processing ${parsedResponse.files.length} generated files for upload to R2`)
          generatedFiles = await this.processAndUploadFiles(
            parsedResponse.files, 
            projectId
          )
        }

        return {
          success: true,
          response: parsedResponse.explanation || 'FastAPI backend generated successfully',
          generatedFiles,
          usage: {
            promptTokens: response.prompt_eval_count,
            completionTokens: response.eval_count,
            totalTokens: response.prompt_eval_count + response.eval_count
          }
        }

      } catch (error: any) {
        console.error('Error in AI service:', error)
        return {
          success: false,
          response: '',
          error: error.message || 'An unexpected error occurred'
        }
      }
    },

    async find(params: any) {
      try {
        const models = await ollama.list()
        const modelInfo = models.models.find((m: any) => m.name.includes('llama3.2:3b'))
        
        return {
          service: 'ai-fastapi-generator',
          status: 'running',
          model: modelInfo ? {
            name: modelInfo.name,
            size: modelInfo.size,
            modifiedAt: modelInfo.modified_at
          } : null,
          capabilities: [
            'fastapi-backend-generation',
            'python-code-generation',
            'file-structure-creation',
            'rest-api-design',
            'database-modeling'
          ],
          supportedFeatures: [
            'Complete FastAPI applications',
            'RESTful API endpoints',
            'Database models (SQLAlchemy)',
            'Pydantic schemas',
            'Authentication & Authorization',
            'File upload endpoints',
            'WebSocket support',
            'Background tasks',
            'Testing setup'
          ],
          maxTokens: 8000,
          defaultTemperature: 0.3,
          maxFileSize: 10 * 1024 * 1024 // 10MB
        }
      } catch (error) {
        console.error('Failed to fetch Ollama info:', error)
        return {
          service: 'ai-fastapi-generator',
          status: 'error',
          error: 'Failed to connect to Ollama service'
        }
      }
    },

    constructFastAPIPrompt(userPrompt: string, context?: string): string {
      let prompt = `Generate a complete Python FastAPI backend application based on the following requirements:\n\n`
      
      if (context) {
        prompt += `Additional Context:\n${context}\n\n`
      }
      
      prompt += `Primary Requirements:\n${userPrompt}\n\n`
      
      prompt += `CRITICAL: Your response MUST use MARKDOWN format with:
1. Start with "## Explanation" section
2. Follow with "## Files" section
3. Each file must start with "### File: [filename]"
4. Use markdown code blocks with proper language identifiers (e.g., \`\`\`python, \`\`\`bash, \`\`\`text)
5. Include ALL necessary files:
   - main.py (main application file)
   - requirements.txt (with pinned versions)
   - .env.example (configuration template)
   - README.md (comprehensive documentation)
   - Any additional files needed (models.py, schemas.py, etc.)

Generate production-ready code with:
- Complete file structure with all necessary files
- Proper error handling and validation
- Type hints and documentation
- Security best practices (CORS, validation, etc.)
- Modern FastAPI patterns (Pydantic v2, routers, dependencies)

Respond ONLY with the markdown document, no additional text.`
      
      return prompt
    },

    /**
     * Parse markdown response with file delimiters
     * This is much simpler and more reliable than JSON parsing
     */
    parseMarkdownResponse(markdown: string): { explanation: string; files: Array<{ filename: string; content: string; type: string }> } {
      console.log('Parsing markdown response...')
      
      const result = {
        explanation: '',
        files: [] as Array<{ filename: string; content: string; type: string }>
      }
      
      // Extract explanation section
      const explanationMatch = markdown.match(/## Explanation\s*\n+(.*?)(?=\n##|\n### File:|$)/s)
      if (explanationMatch) {
        result.explanation = explanationMatch[1].trim()
      }
      
      // Extract all files using the "### File: " pattern
      const filePattern = /### File:\s*([^\n]+)\s*\n+```(\w*)\n([\s\S]*?)```/g
      let match
      
      while ((match = filePattern.exec(markdown)) !== null) {
        const filename = match[1].trim()
        const language = match[2] || 'text'
        const content = match[3]
        
        console.log(`Extracted file: ${filename} (${language}), content length: ${content.length}`)
        
        result.files.push({
          filename,
          content,
          type: this.determineFileType(filename, language)
        })
      }
      
      // If no files found with the pattern, try alternative patterns
      if (result.files.length === 0) {
        console.log('No files found with primary pattern, trying alternatives...')
        
        // Try pattern without explicit language
        const altPattern = /### File:\s*([^\n]+)\s*\n+```\n([\s\S]*?)```/g
        while ((match = altPattern.exec(markdown)) !== null) {
          const filename = match[1].trim()
          const content = match[2]
          
          console.log(`Extracted file (alt pattern): ${filename}, content length: ${content.length}`)
          
          result.files.push({
            filename,
            content,
            type: this.determineFileType(filename)
          })
        }
      }
      
      // If still no files, try to find any code blocks and infer filenames
      if (result.files.length === 0) {
        console.log('Still no files, trying to extract code blocks...')
        
        const codeBlockPattern = /```(\w*)\n([\s\S]*?)```/g
        const commonFiles = ['main.py', 'requirements.txt', '.env.example', 'README.md']
        let fileIndex = 0
        
        while ((match = codeBlockPattern.exec(markdown)) !== null) {
          const language = match[1] || 'text'
          const content = match[2]
          
          // Infer filename from language or use common names
          let filename = commonFiles[fileIndex] || `file_${fileIndex}.${language}`
          
          if (language === 'python' && !filename.endsWith('.py')) {
            filename = 'main.py'
          } else if (language === 'bash' || language === 'sh') {
            filename = 'script.sh'
          }
          
          console.log(`Extracted file (code block): ${filename}, content length: ${content.length}`)
          
          result.files.push({
            filename,
            content,
            type: this.determineFileType(filename, language)
          })
          
          fileIndex++
        }
      }
      
      console.log(`Markdown parsing complete. Found ${result.files.length} files`)
      return result
    },

    /**
     * Determine file type from filename and/or language
     */
    determineFileType(filename: string, language?: string): string {
      // First try to determine from filename extension
      const extension = filename.split('.').pop()?.toLowerCase() || ''
      
      const typeMap: Record<string, string> = {
        'py': 'python',
        'pyi': 'python',
        'txt': 'text',
        'md': 'markdown',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'toml': 'toml',
        'ini': 'ini',
        'cfg': 'ini',
        'env': 'env',
        'env.example': 'env',
        'dockerfile': 'dockerfile',
        'sh': 'shell',
        'bash': 'shell',
        'html': 'html',
        'css': 'css',
        'js': 'javascript',
        'ts': 'typescript',
        'sql': 'sql',
        'gitignore': 'gitignore',
        'requirements': 'requirements',
        'lock': 'lock'
      }
      
      if (typeMap[extension]) {
        return typeMap[extension]
      }
      
      // Try to determine from language identifier
      if (language) {
        const languageMap: Record<string, string> = {
          'python': 'python',
          'bash': 'shell',
          'sh': 'shell',
          'javascript': 'javascript',
          'typescript': 'typescript',
          'html': 'html',
          'css': 'css',
          'sql': 'sql',
          'json': 'json',
          'yaml': 'yaml',
          'markdown': 'markdown',
          'dockerfile': 'dockerfile'
        }
        
        if (languageMap[language.toLowerCase()]) {
          return languageMap[language.toLowerCase()]
        }
      }
      
      return 'text'
    },

    async processAndUploadFiles(files: Array<{ filename: string; content: string; type: string }>, projectId: string): Promise<any[]> {
      const uploadedFiles = []
      const maxFileSize = 10 * 1024 * 1024 // 10MB limit

      console.log(`Starting upload of ${files.length} files to R2 for project: ${projectId}`)

      for (const [index, file] of files.entries()) {
        try {
          if (!file.content || !file.filename) {
            console.warn(`Skipping file ${index}: missing content or filename`)
            uploadedFiles.push({
              filename: file.filename || 'unknown',
              originalFilename: file.filename || 'unknown',
              uploadSuccess: false,
              error: 'Missing content or filename'
            })
            continue
          }

          // Check file size
          const contentSize = new TextEncoder().encode(file.content).length
          if (contentSize > maxFileSize) {
            console.warn(`File ${file.filename} exceeds size limit: ${contentSize} bytes`)
            uploadedFiles.push({
              filename: file.filename,
              originalFilename: file.filename,
              uploadSuccess: false,
              error: `File too large (${Math.round(contentSize / 1024)}KB, limit: 10MB)`
            })
            continue
          }

          const contentType = this.getContentType(file.filename, file.type)
          
          console.log(`[${index + 1}/${files.length}] Uploading file: ${file.filename} (${contentSize} bytes, ${contentType})`)
          
          const result = await uploadFileToR2({
            app,
            content: file.content,
            filename: file.filename,
            contentType: contentType,
            projectId: projectId,
            onProgress: (progress: number) => {
              if (progress % 25 === 0) { // Log every 25% to avoid spam
                console.log(`  Progress: ${progress}%`)
              }
            }
          })

          if (result.success) {
            console.log(`✓ Successfully uploaded: ${file.filename} -> ${result.fileUrl}`)
            uploadedFiles.push({
              filename: file.filename,
              originalFilename: result.originalFilename,
              type: file.type,
              fileId: result.fileId,
              fileUrl: result.fileUrl,
              uploadSuccess: true,
              size: result.size || contentSize,
              uploadTime: new Date().toISOString()
            })
          } else {
            console.error(`✗ Failed to upload ${file.filename}: ${result.error}`)
            uploadedFiles.push({
              filename: file.filename,
              originalFilename: result.originalFilename,
              type: file.type,
              uploadSuccess: false,
              error: result.error || 'Upload failed'
            })
          }

        } catch (uploadError: any) {
          console.error(`✗ Failed to upload ${file.filename}:`, uploadError.message)
          uploadedFiles.push({
            filename: file.filename,
            originalFilename: file.filename,
            type: file.type,
            uploadSuccess: false,
            error: uploadError.message || 'Upload failed'
          })
        }
      }

      const successCount = uploadedFiles.filter(f => f.uploadSuccess).length
      console.log(`====================================`)
      console.log(`File upload complete: ${successCount}/${files.length} successful`)
      console.log(`====================================`)
      
      return uploadedFiles
    },

    getContentType(filename: string, fileType?: string): string {
      if (fileType) {
        const typeMap: Record<string, string> = {
          'python': 'text/x-python',
          'text': 'text/plain',
          'markdown': 'text/markdown',
          'json': 'application/json',
          'yaml': 'text/yaml',
          'toml': 'text/toml',
          'ini': 'text/plain',
          'env': 'text/plain',
          'dockerfile': 'text/plain',
          'shell': 'text/x-shellscript',
          'html': 'text/html',
          'css': 'text/css',
          'javascript': 'application/javascript',
          'typescript': 'application/typescript',
          'sql': 'application/sql',
          'gitignore': 'text/plain',
          'requirements': 'text/plain',
          'lock': 'text/plain'
        }
        
        return typeMap[fileType.toLowerCase()] || 'text/plain'
      }
      
      const extension = filename.split('.').pop()?.toLowerCase() || ''
      
      const extensionMap: Record<string, string> = {
        'py': 'text/x-python',
        'pyi': 'text/x-python',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'json': 'application/json',
        'yaml': 'text/yaml',
        'yml': 'text/yaml',
        'toml': 'text/toml',
        'ini': 'text/plain',
        'env': 'text/plain',
        'dockerfile': 'text/plain',
        'sh': 'text/x-shellscript',
        'bash': 'text/x-shellscript',
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'ts': 'application/typescript',
        'sql': 'application/sql',
        'gitignore': 'text/plain'
      }
      
      return extensionMap[extension] || 'application/octet-stream'
    },

    async generateFastAPISkeleton(projectName: string, features: string[]): Promise<AIResponse> {
      const prompt = `Generate a complete FastAPI project skeleton for "${projectName}" with these features: ${features.join(', ')}.
      
Include:
1. Complete project structure
2. Configuration files
3. Database setup (SQLAlchemy)
4. Authentication system
5. Example CRUD endpoints
6. Error handling middleware
7. Testing setup
8. Docker configuration
9. Deployment scripts
10. Documentation`

      return this.create({
        projectId: `skeleton_${Date.now()}`,
        prompt,
        temperature: 0.2,
        generateFiles: true
      })
    }
  })

  app.service('ai-service').hooks({
    before: {
      create: [
        authenticate('jwt'),
        async (context: any) => {
          const { projectId, prompt } = context.data
          
          // Store projectId in params for after hook access
          context.params.projectId = projectId
          
          // Log request for auditing
          console.log('AI Service request:', {
            projectId,
            promptLength: prompt.length,
            user: context.params.user?.id,
            timestamp: new Date().toISOString()
          })
          
          // Detect backend requests
          const promptLower = prompt.toLowerCase()
          const isBackendRequest = promptLower.includes('fastapi') ||
                                  promptLower.includes('python') ||
                                  promptLower.includes('backend') ||
                                  promptLower.includes('api') ||
                                  promptLower.includes('server')
          
          if (isBackendRequest) {
            // Optimize parameters for code generation
            context.data.temperature = context.data.temperature || 0.3
            context.data.maxTokens = context.data.maxTokens || 8000
            context.data.generateFiles = true
            
            // Add context for better code generation
            if (!context.data.context) {
              context.data.context = 'Generate production-ready FastAPI code with type hints, error handling, and security best practices.'
            }
          }
          
          return context
        },
        async (context: any) => {
          // Sanitize input
          const { prompt } = context.data
          
          // Remove potentially harmful patterns
          const sanitizedPrompt = prompt
            .replace(/system\(|exec\(|eval\(|subprocess\.|__import__/gi, '[REMOVED]')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
            .substring(0, 10000) // Limit length
          
          context.data.prompt = sanitizedPrompt
          return context
        }
      ],
      find: [authenticate('jwt')]
    },
    
    after: {
      create: [
        async (context: any) => {
          const { result, params } = context
          
          if (result.success) {
            // Log successful generation
            console.log('AI Generation completed:', {
              projectId: params.projectId,
              filesGenerated: result.generatedFiles?.length || 0,
              filesUploaded: result.generatedFiles?.filter((f: any) => f.uploadSuccess).length || 0,
              tokensUsed: result.usage?.totalTokens || 0,
              success: result.success
            })
          }
          
          return context
        }
      ]
    },
    
    error: {
      create: [
        async (context: any) => {
          console.error('FastAPI Generation Error:', {
            error: context.error.message,
            projectId: context.params?.projectId,
            user: context.params.user?.id,
            timestamp: new Date().toISOString(),
            stack: context.error.stack
          })
          
          return context
        }
      ]
    }
  })
}
