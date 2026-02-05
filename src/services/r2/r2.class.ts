// R2 Storage Service for Cloudflare R2 integration
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface R2Config {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export interface UploadFileOptions {
  key: string
  content: string | Buffer
  contentType?: string
}

export interface DownloadFileResult {
  content: string
  contentType?: string
}

export interface PresignedUrlOptions {
  key: string
  expiresIn?: number
}

export class R2Service {
  private client: S3Client
  private config: R2Config

  constructor(config: R2Config) {
    this.config = config
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      forcePathStyle: true
    })
  }

  /**
   * Upload a file to R2
   */
  async uploadFile(options: UploadFileOptions): Promise<string> {
    const { key, content, contentType = 'application/octet-stream' } = options

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: content,
      ContentType: contentType
    })

    await this.client.send(command)
    return key
  }

  /**
   * Download a file from R2
   */
  async downloadFile(key: string): Promise<DownloadFileResult> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    })

    const response: GetObjectCommandOutput = await this.client.send(command)

    if (!response.Body) {
      throw new Error('File not found or empty')
    }

    const content = await this.streamToString(response.Body as NodeJS.ReadableStream)
    return {
      content,
      contentType: response.ContentType
    }
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    })

    await this.client.send(command)
  }

  /**
   * Generate a presigned URL for file access
   */
  async getPresignedUrl(options: PresignedUrlOptions): Promise<string> {
    const { key, expiresIn = 3600 } = options

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    })

    return await getSignedUrl(this.client, command, { expiresIn })
  }

  /**
   * List files in a bucket with optional prefix
   */
  async listFiles(prefix: string): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: prefix
    })

    const response = await this.client.send(command)
    return response.Contents?.map(obj => obj.Key || '').filter(Boolean) || []
  }

  /**
   * Helper method to convert stream to string
   */
  private async streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = []

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }

    return Buffer.concat(chunks).toString('utf-8')
  }
}

export const getR2Service = (config: R2Config): R2Service => {
  return new R2Service(config)
}
