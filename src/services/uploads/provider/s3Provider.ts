import S3 from 'aws-sdk/clients/s3'
import createS3BlobStore from 's3-blob-store'
import { Application } from '../../../declarations'
require('aws-sdk/lib/maintenance_mode_message').suppress = true

interface AWSConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
}

function getS3Storage(app: Application): ReturnType<typeof createS3BlobStore> {
  const awsConfig: AWSConfig = app.get('aws')
  const s3 = new S3({
    region: awsConfig.region,
    endpoint: awsConfig.endpoint,
    credentials: {
      accessKeyId: awsConfig.accessKeyId,
      secretAccessKey: awsConfig.secretAccessKey
    }
  })

  const blobStore = createS3BlobStore({
    client: s3,
    bucket: awsConfig.bucket,
    accessKeyId: awsConfig.accessKeyId,
    secretAccessKey: awsConfig.secretAccessKey
  })

  return blobStore
}

export default getS3Storage
