export async function hashFileName(originalFilename: string): Promise<string> {
  const fileExtension = originalFilename.split('.').pop() || ''
  const salt = cryptoRandomString(16)
  const data = new TextEncoder().encode(`${originalFilename}-${Date.now()}-${salt}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hashHex}-${salt}.${fileExtension}`
}

function cryptoRandomString(length: number): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  const values = new Uint8Array(length)
  window.crypto.getRandomValues(values)
  values.forEach(byte => {
    result += charset[byte % charset.length]
  })
  return result
}
