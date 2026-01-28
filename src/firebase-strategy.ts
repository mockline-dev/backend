import { AuthenticationBaseStrategy, AuthenticationResult } from '@feathersjs/authentication'
import { BadRequest } from '@feathersjs/errors'
import { Params as FeathersParams } from '@feathersjs/feathers'
import { Application } from './declarations'
import admin from './firebase'

interface Params extends FeathersParams {
  session?: {
    user?: UserData
  }
}

interface DecodedToken {
  uid: string
  email?: string
}

interface UserData {
  firebaseUid: string
  email: string
}

interface AuthenticationPayload {
  accessToken: string
}

class FirebaseStrategy extends AuthenticationBaseStrategy {
  async authenticate(authentication: AuthenticationPayload, params: Params): Promise<AuthenticationResult> {
    try {
      const decodedToken = await this.verifyToken(authentication.accessToken)
      console.log('Decoded token:', decodedToken)
      const user = await this.processUserAuthentication(decodedToken)

      if (params.session) {
        params.session.user = user
        console.log('User authenticated:', user)
      }

      return {
        authentication: { strategy: 'firebase' },
        user
      }
    } catch (error: unknown) {
      this.handleError(error)
    }
  }

  private async verifyToken(accessToken: string): Promise<DecodedToken> {
    try {
      return await admin.auth().verifyIdToken(accessToken)
    } catch (error) {
      throw new BadRequest('Invalid Firebase token', {
        originalError: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  private async processUserAuthentication(decodedToken: DecodedToken): Promise<UserData> {
    const { uid, email } = decodedToken

    if (!email) {
      throw new BadRequest('Email is required')
    }

    return await this.getOrCreateUser(decodedToken)
  }

  private async getOrCreateUser(decodedToken: DecodedToken): Promise<UserData> {
    const { uid, email } = decodedToken
    const app = this.app as Application

    const users = await app.service('users').find({ query: { firebaseUid: uid } })

    if (users.total === 0) {
      return await app.service('users').create({
        firebaseUid: uid,
        email: email || '',
        firstName: '',
        lastName: ''
      })
    }

    return users.data[0] as UserData
  }

  private handleError(error: unknown): never {
    if (error instanceof Error && 'className' in error) {
      throw error
    }

    throw new BadRequest('Authentication failed', {
      originalError: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default FirebaseStrategy
