// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#custom-services
import type { Id, NullableId, Params, ServiceInterface } from '@feathersjs/feathers'

import type { Application } from '../../declarations'
import type { Uploads, UploadsData, UploadsPatch, UploadsQuery } from './uploads.schema'

export type { Uploads, UploadsData, UploadsPatch, UploadsQuery }

export interface UploadsServiceOptions {
  app: Application
}

export interface UploadsParams extends Params<UploadsQuery> {
  s3: any
}

// This is a skeleton for a custom service class. Remove or add the methods you need here
export class UploadsService<ServiceParams extends UploadsParams = UploadsParams>
  implements ServiceInterface<Uploads, UploadsData, ServiceParams, UploadsPatch>
{
  constructor(public options: UploadsServiceOptions) {}

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
      return Promise.all(data.map((current) => this.create(current, params)))
    }

    return {
      _id: '',
      ...data,
      uri: data.uri,
      contentType: '',
      size: 0
    }
  }

  // This method has to be added to the 'methods' option to make it available to clients
  async update(id: NullableId, data: UploadsData, _params?: ServiceParams): Promise<Uploads> {
    return {
      _id: id as string,
      ...data,
      uri: data.uri,
      contentType: '',
      size: 0
    }
  }

  async patch(id: NullableId, data: UploadsPatch, _params?: ServiceParams): Promise<Uploads> {
    return {
      _id: id as string,
      uri: `Fallback for ${id}`,
      ...data,
      contentType: '',
      size: 0,
      createdAt: data.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }
  }

  async remove(id: NullableId, _params?: ServiceParams): Promise<Uploads> {
    return {
      _id: id as string,
      uri: 'removed',
      size: 0,
      contentType: '',
      createdAt: 0,
      updatedAt: 0
    }
  }
}

export const getOptions = (app: Application) => {
  return { app }
}
