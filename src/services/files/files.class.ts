// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#database-services
import type { Params } from '@feathersjs/feathers'
import type { MongoDBAdapterOptions, MongoDBAdapterParams } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'

import type { Application } from '../../declarations'
import { r2Client } from '../../storage/r2.client'
import type { GeneratedFile } from '../../types'
import type { Files, FilesData, FilesPatch, FilesQuery } from './files.schema'

export type { Files, FilesData, FilesPatch, FilesQuery }

export interface FilesParams extends MongoDBAdapterParams<FilesQuery> {}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class FilesService<ServiceParams extends Params = FilesParams> extends MongoDBService<
  Files,
  FilesData,
  FilesParams,
  FilesPatch
> {
  /** Fetch a single file's content from R2. */
  async getContent(projectId: string, filePath: string): Promise<string> {
    const key = `projects/${projectId}/${filePath}`
    return r2Client.getObject(key)
  }

  /** Upload a single file's content to R2. */
  async putContent(projectId: string, filePath: string, content: string): Promise<void> {
    const key = `projects/${projectId}/${filePath}`
    await r2Client.putObject(key, content)
  }

  /** Fetch all files for a project from R2 (Python files by default). */
  async getAllContents(projectId: string): Promise<GeneratedFile[]> {
    const prefix = `projects/${projectId}/`
    const objects = await r2Client.listObjects(prefix)

    const results = await Promise.all(
      objects.map(async obj => {
        const relativePath = obj.key.replace(prefix, '')
        try {
          const content = await r2Client.getObject(obj.key)
          return { path: relativePath, content, source: 'llm' as const, validated: false }
        } catch {
          return null
        }
      })
    )

    return results.filter(f => f !== null) as GeneratedFile[]
  }

  /** Bulk upload a list of generated files to R2. */
  async putAllContents(projectId: string, files: GeneratedFile[]): Promise<void> {
    for (const file of files) {
      const key = `projects/${projectId}/${file.path}`
      await r2Client.putObject(key, file.content)
    }
  }
}

export const getOptions = (app: Application): MongoDBAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then(db => db.collection('files'))
      .then(async collection => {
        await collection.createIndex({ projectId: 1 })
        await collection.createIndex({ messageId: 1 })
        await collection.createIndex({ createdAt: -1 })
        await collection.createIndex({ path: 1 })

        return collection
      })
  }
}
