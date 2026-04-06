/**
 * Server-side utility for uploading files to Cloudflare R2 storage.
 * Uses Node.js APIs (crypto, Buffer) instead of browser APIs.
 */

import { Application } from '../declarations'

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB chunks
const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

export interface UploadFileToR2Options {
  app: Application
  content: string | Buffer
  filename: string
  contentType: string
  projectId: string
  messageId?: string
  userId?: string
  onProgress?: (progress: number) => void
  chunkSize?: number
}

export interface UploadFileToR2Result {
  success: boolean
  fileId?: string
  filename: string
  originalFilename: string
  fileUrl: string
  size: number
  error?: string
}

/**
 * Generates a secure, non-guessable filename using Node.js crypto.
 */
async function generateSecureFileName(originalFilename: string): Promise<string> {
  const crypto = await import('crypto')

  // Extract file extension
  const fileExtension = originalFilename.split('.').pop() || ''

  // Generate a random salt using Node.js crypto
  const salt = crypto.randomBytes(16).toString('hex')

  // Combine filename, salt, and timestamp for better uniqueness
  const data = `${originalFilename}-${Date.now()}-${salt}`

  // Hash the data using SHA-256
  const hash = crypto.createHash('sha256').update(data).digest('hex')

  return `${hash}-${salt}.${fileExtension}`
}

/**
 * Sleep function for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Uploads a file to R2 storage using multipart upload.
 *
 * @param options - Upload options including content, filename, and metadata
 * @returns Upload result with file ID, URL, and status
 */
export async function uploadFileToR2(options: UploadFileToR2Options): Promise<UploadFileToR2Result> {
  const {
    app,
    content,
    filename,
    contentType,
    projectId,
    messageId,
    userId,
    onProgress,
    chunkSize = DEFAULT_CHUNK_SIZE
  } = options

  let uploadId: string | null = null
  let key: string | null = null

  try {
    // Validate input
    if (!content) {
      throw new Error('Content is required')
    }
    if (!filename) {
      throw new Error('Filename is required')
    }
    if (!projectId) {
      throw new Error('Project ID is required')
    }

    // Convert content to Buffer if it's a string
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
    const fileSize = buffer.length

    // Generate secure filename
    key = await generateSecureFileName(filename)

    console.log(`[uploadFileToR2] Starting upload: ${filename} -> ${key} (${fileSize} bytes)`)

    // Initialize multipart upload
    const initResponse = await app.service('uploads').create({
      key,
      contentType
    })

    uploadId = initResponse.uploadId
    if (!uploadId) {
      throw new Error('Failed to initialize multipart upload')
    }

    console.log(`[uploadFileToR2] Upload initialized with ID: ${uploadId}`)

    // Calculate chunks
    const totalChunks = Math.ceil(fileSize / chunkSize)
    const parts: Array<{ ETag: string; PartNumber: number }> = []

    // Upload chunks with retry logic
    for (let i = 0; i < totalChunks; i++) {
      const partNumber = i + 1
      const start = i * chunkSize
      const end = Math.min(fileSize, start + chunkSize)
      const chunk = buffer.subarray(start, end)

      let retries = 0
      let partResponse: any = null

      while (retries < MAX_RETRIES) {
        try {
          partResponse = await app.service('uploads').patch(null, {
            partNumber,
            uploadId,
            key,
            content: chunk
          })

          // Extract ETag from response
          const eTag = partResponse?.ETag || ''
          if (!eTag) {
            throw new Error('No ETag returned from upload part')
          }

          parts.push({
            ETag: eTag,
            PartNumber: partNumber
          })

          console.log(`[uploadFileToR2] Uploaded part ${partNumber}/${totalChunks}`)
          break
        } catch (error: any) {
          retries++
          console.error(
            `[uploadFileToR2] Failed to upload part ${partNumber} (attempt ${retries}/${MAX_RETRIES}):`,
            error.message
          )

          if (retries >= MAX_RETRIES) {
            throw new Error(
              `Failed to upload part ${partNumber} after ${MAX_RETRIES} retries: ${error.message}`
            )
          }

          // Wait before retrying with exponential backoff
          await sleep(RETRY_DELAY * Math.pow(2, retries - 1))
        }
      }

      // Report progress
      if (onProgress) {
        const progress = Math.round(((i + 1) / totalChunks) * 100)
        onProgress(progress)
      }
    }

    // Complete multipart upload
    console.log(`[uploadFileToR2] Completing multipart upload for ${key}`)

    const completeResponse = await app.service('uploads').update(null, {
      uploadId,
      key,
      parts,
      fileType: contentType,
      projectId,
      messageId,
      userId,
      originalFilename: filename
    })

    // The uploads service returns the file ID directly as a string
    const fileId = typeof completeResponse === 'string' ? completeResponse : (completeResponse._id as string)
    if (!fileId) {
      throw new Error('Failed to complete multipart upload - no file ID returned')
    }

    // Generate public URL
    const fileUrl = generatePublicUrl(app, key)

    console.log(`[uploadFileToR2] Upload complete: ${fileId} -> ${fileUrl}`)

    return {
      success: true,
      fileId,
      filename: key,
      originalFilename: filename,
      fileUrl,
      size: fileSize
    }
  } catch (error: any) {
    console.error(`[uploadFileToR2] Upload failed:`, error)

    // Cleanup: abort multipart upload if it was initialized
    if (uploadId && key) {
      try {
        console.log(`[uploadFileToR2] Cleaning up failed upload: ${uploadId}`)
        await app.service('uploads').remove(null, { query: { uploadId, key } })
      } catch (cleanupError: any) {
        console.error(`[uploadFileToR2] Failed to cleanup:`, cleanupError.message)
      }
    }

    return {
      success: false,
      filename: key || filename,
      originalFilename: filename,
      fileUrl: '',
      size: 0,
      error: error.message || 'Upload failed'
    }
  }
}

/**
 * Generates a public URL for a file in R2 storage.
 */
function generatePublicUrl(app: Application, key: string): string {
  const r2PublicUrl = app.get('r2PublicUrl')
  if (r2PublicUrl) {
    return `${r2PublicUrl}/${key}`
  }
  // Fallback to AWS endpoint if r2PublicUrl is not configured
  const awsConfig = app.get('aws')
  return `${awsConfig.endpoint}/${awsConfig.bucket}/${key}`
}

/**
 * Uploads multiple files to R2 storage.
 *
 * @param app - Feathers application instance
 * @param files - Array of file objects with content, filename, and contentType
 * @param projectId - Project ID for the files
 * @param options - Additional options (messageId, userId, onProgress)
 * @returns Array of upload results
 */
export async function uploadMultipleFilesToR2(
  app: Application,
  files: Array<{ content: string | Buffer; filename: string; contentType: string }>,
  projectId: string,
  options?: {
    messageId?: string
    userId?: string
    onFileProgress?: (filename: string, progress: number) => void
    onOverallProgress?: (progress: number) => void
  }
): Promise<UploadFileToR2Result[]> {
  const results: UploadFileToR2Result[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]

    const result = await uploadFileToR2({
      app,
      content: file.content,
      filename: file.filename,
      contentType: file.contentType,
      projectId,
      messageId: options?.messageId,
      userId: options?.userId,
      onProgress: progress => {
        if (options?.onFileProgress) {
          options.onFileProgress(file.filename, progress)
        }
        if (options?.onOverallProgress) {
          const overallProgress = Math.round(((i + progress / 100) / files.length) * 100)
          options.onOverallProgress(overallProgress)
        }
      }
    })

    results.push(result)
  }

  return results
}
