import { Application } from '../declarations'

export interface MediaFile {
  uid: string
  url: string
  name: string
  fileType?: string
}

export const getMedia = async (itemId: string, app: Application): Promise<MediaFile | undefined> => {
  if (!itemId) return undefined

  try {
    const media = await app.service('files').get(itemId)
    if (media) {
      const streamResponse = await app.service('file-stream').get({
        key: media.name,
        fileType: media.fileType
      })
      return {
        uid: media._id.toString(),
        name: media.name,
        fileType: media.fileType,
        url: streamResponse.url
      }
    }

    return undefined
  } catch (error) {
    console.error('Error getting media:', error)
    return undefined
  }
}
