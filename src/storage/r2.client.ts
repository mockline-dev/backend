import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import config from 'config'
import { Readable } from 'stream'

const RETRY_ATTEMPTS = 3
const RETRY_DELAY_MS = 1000

async function withRetry<T>(fn: () => Promise<T>, attempts = RETRY_ATTEMPTS): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err: any) {
      if (i === attempts - 1) throw err
      const delay = RETRY_DELAY_MS * Math.pow(2, i)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Unreachable')
}

export class R2Client {
  private client: S3Client
  private bucket: string

  constructor() {
    const aws = config.get<{
      bucket: string
      region: string
      endpoint: string
      accessKeyId: string
      secretAccessKey: string
    }>('aws')
    this.bucket = aws.bucket
    this.client = new S3Client({
      region: aws.region || 'auto',
      endpoint: aws.endpoint,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey
      }
    })
  }

  async getObject(key: string): Promise<string> {
    return withRetry(async () => {
      const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key })
      const res = await this.client.send(cmd)
      const stream = res.Body as Readable
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      return Buffer.concat(chunks).toString('utf-8')
    })
  }

  async putObject(key: string, content: string, contentType?: string): Promise<void> {
    return withRetry(async () => {
      const cmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: contentType || this.inferContentType(key),
        ContentLength: Buffer.byteLength(content)
      })
      await this.client.send(cmd)
    })
  }

  async deleteObject(key: string): Promise<void> {
    return withRetry(async () => {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    })
  }

  async listObjects(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]> {
    const results: any[] = []
    let continuationToken: string | undefined

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
      const res = await this.client.send(cmd)
      results.push(...(res.Contents || []))
      continuationToken = res.NextContinuationToken
    } while (continuationToken)

    return results.map(o => ({ key: o.Key!, size: o.Size || 0, lastModified: o.LastModified! }))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch {
      return false
    }
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    return withRetry(async () => {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${sourceKey}`,
          Key: destKey
        })
      )
    })
  }

  async copyPrefix(sourcePrefix: string, destPrefix: string): Promise<void> {
    const objects = await this.listObjects(sourcePrefix)
    await Promise.all(
      objects.map(obj => {
        const destKey = obj.key.replace(sourcePrefix, destPrefix)
        return this.copyObject(obj.key, destKey)
      })
    )
  }

  async deletePrefix(prefix: string): Promise<void> {
    const objects = await this.listObjects(prefix)
    await Promise.all(objects.map(obj => this.deleteObject(obj.key)))
  }

  private inferContentType(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase()
    const map: Record<string, string> = {
      py: 'text/x-python',
      ts: 'text/typescript',
      js: 'text/javascript',
      json: 'application/json',
      md: 'text/markdown',
      yaml: 'text/yaml',
      yml: 'text/yaml',
      html: 'text/html',
      css: 'text/css',
      txt: 'text/plain'
    }
    return map[ext || ''] || 'text/plain'
  }
}

export const r2Client = new R2Client()
