import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import { ObjectId } from 'mongodb'
import type { Application } from '../../declarations'
const path = require('path')

export const uploadsPath = 'uploads'

// Upload validation constants
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_CONTENT_TYPES = [
  'text/plain',
  'text/javascript',
  'text/typescript',
  'text/x-python',
  'text/x-java',
  'text/x-c',
  'text/x-c++',
  'application/json',
  'application/xml',
  'text/markdown',
  'text/html',
  'text/css',
  'text/yaml',
  'application/x-yaml'
]
const DANGEROUS_EXTENSIONS = [
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.js',
  '.jar',
  '.app',
  '.deb',
  '.rpm',
  '.dmg',
  '.pkg',
  '.msi'
]

export const uploads = (app: Application) => {
  const awsConfig = app.get('aws')
  const s3Client = new S3Client({
    region: awsConfig.region,
    credentials: {
      accessKeyId: awsConfig.accessKeyId,
      secretAccessKey: awsConfig.secretAccessKey
    },
    endpoint: awsConfig.endpoint
  })

  app.use(uploadsPath, {
    async create(data: any) {
      const { key, contentType, content } = data

      if (!key) {
        throw new Error('Key is required')
      }
      if (!contentType) {
        throw new Error('ContentType is required')
      }

      // Save flow sends full text content in one request; use a direct put to avoid orphaned multipart uploads.
      if (content !== undefined && content !== null) {
        let body = content
        if (typeof content === 'string' && content.startsWith('data:')) {
          const base64Data = content.split(',')[1]
          body = Buffer.from(base64Data, 'base64')
        }

        const putCommand = new PutObjectCommand({
          Bucket: awsConfig.bucket,
          Key: key,
          ContentType: contentType,
          Body: body,
          ACL: 'public-read',
          ...(typeof content === 'string' && !content.startsWith('data:')
            ? { ContentLength: Buffer.byteLength(content) }
            : {})
        })

        await s3Client.send(putCommand)

        return {
          key,
          success: true
        }
      }

      const command = new CreateMultipartUploadCommand({
        Bucket: awsConfig.bucket,
        Key: key,
        ContentType: contentType,
        ACL: 'public-read'
      })
      const response = await s3Client.send(command)
      return {
        uploadId: response.UploadId,
        key: key
      }
    },

    getPublicUrl(key: string): string {
      if (!key) {
        throw new Error('Key is required')
      }
      return `${awsConfig.endpoint}/${awsConfig.bucket}/${key}`
    },

    async patch(id: string, data: any) {
      const { partNumber, uploadId, key, content } = data

      let buffer = content
      if (typeof content === 'string' && content.startsWith('data:')) {
        const base64Data = content.split(',')[1]
        buffer = Buffer.from(base64Data, 'base64')
      } else if (Buffer.isBuffer(content)) {
        buffer = content
      } else {
        buffer = Buffer.from(content)
      }

      const command = new UploadPartCommand({
        Bucket: awsConfig.bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
        Body: buffer
      })

      const response = await s3Client.send(command)

      return {
        ETag: response.ETag,
        PartNumber: partNumber
      }
    },

    async update(id: string, data: any, params: any) {
      const { uploadId, key, parts, fileType, projectId, messageId, originalFilename } = data
      const { user } = params

      const command = new CompleteMultipartUploadCommand({
        Bucket: awsConfig.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
        }
      })

      await s3Client.send(command)

      const headCommand = new HeadObjectCommand({
        Bucket: awsConfig.bucket,
        Key: key
      })
      const headResponse = await s3Client.send(headCommand)
      const fileSize = headResponse.ContentLength || 0

      const payload = {
        name: originalFilename || key,
        key: key,
        size: fileSize,
        fileType: fileType,
        projectId: new ObjectId(projectId),
        ...(messageId ? { messageId: new ObjectId(messageId) } : {})
      }
      try {
        const media = await app.service('files').create(payload)
        return media._id.toString()
      } catch (error) {
        console.error('[Uploads] Failed to create file record:', error)
        return null
      }
    },

    async remove(id: string, params: any) {
      const { uploadId, key } = params.query

      if (uploadId) {
        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: awsConfig.bucket,
          Key: key,
          UploadId: uploadId
        })

        await s3Client.send(abortCommand)
      }

      const deleteCommand = new DeleteObjectCommand({
        Bucket: awsConfig.bucket,
        Key: key
      })

      await s3Client.send(deleteCommand)

      return {
        message: 'Multipart upload aborted and file deleted successfully'
      }
    }
  })

  app.service(uploadsPath).hooks({
    around: {
      all: []
    },
    before: {
      all: [],
      create: [
        async (context: any) => {
          const { key, contentType, content } = context.data

          if (!key) {
            throw new Error('Key is required')
          }
          if (!contentType) {
            throw new Error('ContentType is required')
          }

          // Validate file size (check buffer size)
          let bufferSize = 0
          if (content) {
            if (typeof content === 'string') {
              bufferSize = Buffer.byteLength(content)
            } else if (Buffer.isBuffer(content)) {
              bufferSize = content.length
            }
          }

          if (bufferSize > MAX_FILE_SIZE) {
            throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`)
          }

          // Validate content type
          if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
            throw new Error(`File type ${contentType} is not allowed`)
          }

          // Validate file extension from key
          const ext = path.extname(key).toLowerCase()
          if (DANGEROUS_EXTENSIONS.includes(ext)) {
            throw new Error(`File extension ${ext} is not allowed for security reasons`)
          }

          return context
        }
      ],
      patch: [
        async (context: any) => {
          const { partNumber, uploadId, key, content } = context.data
          if (!partNumber) {
            throw new Error('PartNumber is required')
          }
          if (!uploadId) {
            throw new Error('UploadId is required')
          }
          if (!key) {
            throw new Error('Key is required')
          }
          if (!content) {
            throw new Error('Content is required')
          }
          return context
        }
      ],
      update: [
        async (context: any) => {
          const { uploadId, key, parts, fileType, originalFilename } = context.data
          if (!uploadId) {
            throw new Error('UploadId is required')
          }
          if (!key) {
            throw new Error('Key is required')
          }
          if (!parts || !Array.isArray(parts) || parts.length === 0) {
            throw new Error('Parts array is required')
          }
          if (!fileType) {
            throw new Error('FileType is required')
          }
          return context
        }
      ]
    },
    after: {
      all: [],
      update: [
        async (context: any) => {
          const { result, data } = context
          console.log(`[Uploads] File upload completed: ${data.key}, fileId: ${result}`)
          return context
        }
      ]
    },
    error: {
      all: [
        async (context: any) => {
          console.error(`[Uploads] Error in ${context.method}:`, context.error)
          return context
        }
      ]
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [uploadsPath]: any
  }
}
