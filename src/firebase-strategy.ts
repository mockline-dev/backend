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
  firstName: string
  lastName: string
}

interface AuthenticationPayload {
  accessToken: string
  userData: {
    firstName: string
    lastName: string
  }
}

class FirebaseStrategy extends AuthenticationBaseStrategy {
  async authenticate(authentication: AuthenticationPayload, params: Params): Promise<AuthenticationResult> {
    try {
      const decodedToken = await this.verifyToken(authentication.accessToken)
      const user = await this.processUserAuthentication(decodedToken, authentication.userData)

      if (params.session) {
        params.session.user = user
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

  private async processUserAuthentication(
    decodedToken: DecodedToken,
    userData?: AuthenticationPayload['userData']
  ): Promise<UserData> {
    const { uid, email } = decodedToken
    const { firstName, lastName } = userData || {}

    if (!email) {
      throw new BadRequest('Email is required')
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      throw new BadRequest('Invalid email format')
    }

    return await this.getOrCreateUser(decodedToken, firstName, lastName)
  }

  private async getOrCreateUser(
    decodedToken: DecodedToken,
    firstName?: string,
    lastName?: string
  ): Promise<UserData> {
    const { uid, email } = decodedToken
    const app = this.app as Application

    try {
      const users = await app.service('users').find({ query: { firebaseUid: uid } })

      if (users.total === 0) {
        // Sanitize input data
        const sanitizedFirstName = firstName?.trim().slice(0, 50) || ''
        const sanitizedLastName = lastName?.trim().slice(0, 50) || ''

        return await app.service('users').create({
          firebaseUid: uid,
          email: email || '',
          firstName: sanitizedFirstName,
          lastName: sanitizedLastName
        })
      }

      return users.data[0] as UserData
    } catch (error) {
      throw new BadRequest('Failed to process user data', {
        originalError: error instanceof Error ? error.message : 'Database error'
      })
    }
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
