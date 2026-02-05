import admin from 'firebase-admin'
import fs from 'fs'

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './mockline-1a0e0-firebase-adminsdk-fbsvc-3f81f63b5b.json'
    
    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(`Firebase service account file not found: ${serviceAccountPath}`)
    }
    
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
    })
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error)
    throw new Error('Firebase configuration error')
  }
}

export default admin
