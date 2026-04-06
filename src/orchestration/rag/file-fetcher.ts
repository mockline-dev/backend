import { createModuleLogger } from '../../logging'

const log = createModuleLogger('file-fetcher')

/**
 * Fetches raw text content for a file stored in R2.
 * Returns null (and logs a warning) on any failure.
 */
export async function fetchFileContent(
  key: string,
  app: { service: (name: string) => any }
): Promise<string | null> {
  try {
    const streamService = app.service('file-stream')
    const signedUrl = await streamService.get(null, { query: { key } })
    const url = typeof signedUrl === 'string' ? signedUrl : signedUrl?.url

    if (!url) return null

    const response = await fetch(url)
    if (!response.ok) return null
    return await response.text()
  } catch (err: unknown) {
    log.warn('Failed to fetch file content', {
      key,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
