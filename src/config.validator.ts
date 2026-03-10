import { app } from './app'

const REQUIRED_CONFIG = [
  'authentication.secret',
  'mongodb',
  'ollama.baseUrl',
  'aws.accessKeyId',
  'aws.secretAccessKey',
  'aws.bucket'
]

export function validateConfig(): void {
  const missing: string[] = []

  for (const key of REQUIRED_CONFIG) {
    const parts = key.split('.')
    let value: any = app.get(parts[0] as any)
    for (const part of parts.slice(1)) {
      value = value?.[part]
    }
    if (!value || (typeof value === 'string' && value.startsWith('${'))) {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    console.error('Missing required configuration:')
    missing.forEach(k => console.error(`   - ${k}`))
    process.exit(1)
  }

  console.log('Configuration validated')
}
