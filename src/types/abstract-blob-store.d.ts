declare module 'abstract-blob-store' {
  export interface AbstractBlobStore {
    createWriteStream: (opts?: any, cb?: (err: any, data: any) => void) => NodeJS.WritableStream
    createReadStream: (opts?: any) => NodeJS.ReadableStream
    exists: (opts: any, cb: (err: any, exists: boolean) => void) => void
    remove: (opts: any, cb: (err: any) => void) => void
  }

  const abstractBlobStore: AbstractBlobStore
  export default abstractBlobStore
}
