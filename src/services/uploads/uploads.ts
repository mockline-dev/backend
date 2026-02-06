import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import type { Application } from '../../declarations'

export const uploadsPath = 'uploads'

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
      const { key, contentType } = data

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
      const { uploadId, key, parts, fileType, projectId, messageId } = data
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
        name: key,
        size: fileSize,
        fileType: fileType,
        createdBy: user?._id,
        projectId: projectId,
        messageId: messageId
      }
      try {
        const media = await app.service('files').create(payload)
        return media._id
      } catch (error) {
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
      all: []
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [uploadsPath]: any
  }
}
