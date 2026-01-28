// File: types/s3-blob-store/index.d.ts

declare module 's3-blob-store' {
  import { S3 } from 'aws-sdk'

  interface S3BlobStoreOptions {
    client: S3
    bucket: string
    accessKeyId?: string
    secretAccessKey?: string
  }

  interface S3BlobStore {
    createReadStream(key: string): NodeJS.ReadableStream
    createWriteStream(key: string, options?: any): NodeJS.WritableStream
    exists(key: string, cb: (err: Error | null, exists: boolean) => void): void
    remove(key: string, cb: (err: Error | null) => void): void
    // Add other methods as needed
  }

  function createStore(options: S3BlobStoreOptions): S3BlobStore

  export = createStore
}
