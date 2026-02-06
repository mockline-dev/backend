import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { authenticate } from '@feathersjs/authentication'
import { disallow } from 'feathers-hooks-common'

export default function (app: any) {
  const awsConfig = app.get('aws')
  const s3Client = new S3Client({
    region: awsConfig.region,
    endpoint: awsConfig.endpoint,
    credentials: {
      accessKeyId: awsConfig.accessKeyId,
      secretAccessKey: awsConfig.secretAccessKey
    }
  })

  app.use('/file-stream', {
    async get(params: any) {
      const { key } = params
      try {
        if (!key || typeof key !== 'string') {
          throw new Error('Invalid file key')
        }

        const bucket = awsConfig.bucket

        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key
        })

        let expiresIn = 360000

        const url = await getSignedUrl(s3Client, command, { expiresIn })

        return { url }
      } catch (error) {
        console.error('Error generating signed URL:', error)
        throw error
      }
    },

    async find(params: any) {
      return []
    }
  })

  app.service('file-stream').hooks({
    around: {
      create: [disallow('external')],
      update: [disallow('external')],
      patch: [disallow('external')],
      remove: [disallow('external')]
    },
    before: {
      all: [authenticate('jwt')]
    }
  })
}
