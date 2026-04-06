// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#custom-services
import type { Id, NullableId, Params, ServiceInterface } from '@feathersjs/feathers'

import S3 from 'aws-sdk/clients/s3'
import type { Application } from '../../declarations'
import type { Uploads, UploadsData, UploadsPatch, UploadsQuery } from './uploads.schema'

export type { Uploads, UploadsData, UploadsPatch, UploadsQuery }

export interface UploadsServiceOptions {
  app: Application
}

export interface UploadsParams extends Params<UploadsQuery> {
  s3?: S3
}

interface CompleteMultipartUploadData extends UploadsData {
  uploadId: string
  key: string
  parts: Array<{ ETag: string; PartNumber: number }>
  fileType?: string
  projectId?: string
  messageId?: string
  userId?: string
}

interface CreateMultipartUploadData extends UploadsData {
  key: string
  contentType: string
}

interface UploadPartData extends UploadsPatch {
  partNumber: number
  uploadId: string
  key: string
  content: Buffer
}

// This is a skeleton for a custom service class. Remove or add the methods you need here
export class UploadsService<ServiceParams extends UploadsParams = UploadsParams> implements ServiceInterface<
  Uploads,
  UploadsData,
  ServiceParams,
  UploadsPatch
> {
  constructor(public options: UploadsServiceOptions) {}

  private getS3Client(): S3 {
    const app = this.options.app
    const awsConfig = app.get('aws')
    return new S3({
      region: awsConfig.region,
      endpoint: awsConfig.endpoint,
      credentials: {
        accessKeyId: awsConfig.accessKeyId,
        secretAccessKey: awsConfig.secretAccessKey
      }
    })
  }

  async find(_params?: ServiceParams): Promise<Uploads[]> {
    return []
  }

  async get(id: Id, _params?: ServiceParams): Promise<Uploads> {
    return {
      _id: id as string,
      uri: `A new message with ID: ${id}!`,
      size: 0,
      contentType: '',
      createdAt: 0,
      updatedAt: 0
    }
  }

  async create(data: UploadsData, params?: ServiceParams): Promise<Uploads>
  async create(data: UploadsData[], params?: ServiceParams): Promise<Uploads[]>
  async create(data: UploadsData | UploadsData[], params?: ServiceParams): Promise<Uploads | Uploads[]> {
    if (Array.isArray(data)) {
      return Promise.all(data.map(current => this.create(current, params)))
    }

    const createData = data as CreateMultipartUploadData

    // Initialize multipart upload
    const s3 = this.getS3Client()
    const awsConfig = this.options.app.get('aws')

    const result = await s3
      .createMultipartUpload({
        Bucket: awsConfig.bucket,
        Key: createData.key,
        ContentType: createData.contentType
      })
      .promise()

    return {
      _id: '',
      uri: createData.key,
      contentType: createData.contentType,
      size: 0,
      uploadId: result.UploadId
    } as any
  }

  // This method has to be added to the 'methods' option to make it available to clients
  async update(id: NullableId, data: UploadsData, _params?: ServiceParams): Promise<Uploads> {
    const completeData = data as CompleteMultipartUploadData

    // Complete multipart upload
    const s3 = this.getS3Client()
    const awsConfig = this.options.app.get('aws')

    const result = await s3
      .completeMultipartUpload({
        Bucket: awsConfig.bucket,
        Key: completeData.key,
        UploadId: completeData.uploadId,
        MultipartUpload: {
          Parts: completeData.parts
        }
      })
      .promise()

    // Return an Uploads object with the file key as _id
    return {
      _id: completeData.key,
      uri: completeData.key,
      contentType: completeData.fileType || '',
      size: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }

  async patch(id: NullableId, data: UploadsPatch, _params?: ServiceParams): Promise<Uploads> {
    const patchData = data as UploadPartData

    // Upload a part
    const s3 = this.getS3Client()
    const awsConfig = this.options.app.get('aws')

    const result = await s3
      .uploadPart({
        Bucket: awsConfig.bucket,
        Key: patchData.key,
        UploadId: patchData.uploadId,
        PartNumber: patchData.partNumber,
        Body: patchData.content
      })
      .promise()

    return {
      _id: '',
      uri: patchData.key,
      contentType: '',
      size: 0,
      ETag: result.ETag
    } as any
  }

  async remove(id: NullableId, _params?: ServiceParams): Promise<Uploads> {
    const query = _params?.query as any

    if (query?.uploadId && query?.key) {
      // Abort multipart upload
      const s3 = this.getS3Client()
      const awsConfig = this.options.app.get('aws')

      await s3
        .abortMultipartUpload({
          Bucket: awsConfig.bucket,
          Key: query.key,
          UploadId: query.uploadId
        })
        .promise()
    }

    return {
      _id: id as string,
      uri: 'removed',
      size: 0,
      contentType: '',
      createdAt: 0,
      updatedAt: 0
    }
  }

  // Custom method to generate public URL for a file
  getPublicUrl(key: string): string {
    const app = this.options.app
    const awsConfig = app.get('aws')
    return `${awsConfig.endpoint}/${awsConfig.bucket}/${key}`
  }
}

export const getOptions = (app: Application) => {
  return { app }
}
