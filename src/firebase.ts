import type { Application } from '@feathersjs/feathers'
import admin from 'firebase-admin'
import fs from 'fs'

let firebaseAdmin: admin.app.App | null = null

export const initializeFirebase = (app: Application) => {
  if (firebaseAdmin) {
    return firebaseAdmin
  }

  const config = app.get('firebase')
  if (!config?.serviceAccountPath) {
    throw new Error('Firebase serviceAccountPath is not configured')
  }

  let serviceAccount: Record<string, unknown>

  try {
    const raw = fs.readFileSync(config.serviceAccountPath, 'utf8')
    serviceAccount = JSON.parse(raw)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to load Firebase service account from ${config.serviceAccountPath}: ${reason}`)
  }

  firebaseAdmin = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  })

  return firebaseAdmin
}

export const getFirebaseAdmin = () => {
  if (!firebaseAdmin) {
    throw new Error('Firebase admin not initialized. Call initializeFirebase first.')
  }
  return firebaseAdmin
}
export default admin
