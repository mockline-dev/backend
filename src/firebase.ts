import type { Application } from '@feathersjs/feathers'
import admin from 'firebase-admin'
import fs from 'fs'

let firebaseAdmin: admin.app.App | null = null

export const initializeFirebase = (app: Application) => {
  if (firebaseAdmin) {
    return firebaseAdmin
  }

  const config = app.get('firebase')
  const serviceAccount = JSON.parse(fs.readFileSync(config.serviceAccountPath, 'utf8'))

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
