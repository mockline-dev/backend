// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  userDataResolver,
  userDataValidator,
  userExternalResolver,
  userPatchResolver,
  userPatchValidator,
  userQueryResolver,
  userQueryValidator,
  userResolver
} from './users.schema'

import type { Application, HookContext } from '../../declarations'
import { UserService, getOptions } from './users.class'
import { userMethods, userPath } from './users.shared'

export * from './users.class'
export * from './users.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const user = (app: Application) => {
  // Register our service on the Feathers application
  app.use(userPath, new UserService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: userMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(userPath).hooks({
    around: {
      all: [schemaHooks.resolveExternal(userExternalResolver), schemaHooks.resolveResult(userResolver)],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [],
      update: [authenticate('jwt')],
      patch: [authenticate('jwt')],
      remove: [authenticate('jwt')]
    },
    before: {
      all: [schemaHooks.validateQuery(userQueryValidator), schemaHooks.resolveQuery(userQueryResolver)],
      find: [],
      get: [],
      create: [
        async (context: HookContext) => {
          const { data } = context

          if (data.role === 'super-admin') {
            throw new Error('Super-admin role is not allowed to be created')
          }

          // if (data.companyId) {
          //   const company = await app.service('companies').find({
          //     query: { name: data.companyId }
          //   })

          //   if (company.data[0]?.name === data.companyId) {
          //     if (data.firebaseUid) {
          //       try {
          //         const user = await admin.auth().getUser(data.firebaseUid)
          //         if (user) {
          //           await admin.auth().deleteUser(data.firebaseUid)
          //         }
          //       } catch (error: any) {
          //         if (error.code === 'auth/user-not-found') {
          //           console.warn(`Firebase user not found: ${data.firebaseUid}`)
          //         } else {
          //           console.error('Error deleting Firebase user:', error)
          //           throw error
          //         }
          //       }
          //     } else {
          //       console.warn('No firebaseUid provided for deletion.')
          //     }

          //     throw new Conflict('company-exists')
          //   }
          // }

          return context
        },
        schemaHooks.validateData(userDataValidator),
        schemaHooks.resolveData(userDataResolver)
      ],
      patch: [
        async (context: HookContext) => {
          const { data } = context
          if (data.role === 'super-admin') {
            throw new Error('Super-admin role is not allowed to be updated')
          }
          return context
        },
        schemaHooks.validateData(userPatchValidator),
        schemaHooks.resolveData(userPatchResolver)
      ],
      remove: []
    },
    after: {
      all: [],
      create: [
        // async (context: HookContext) => {
        //   const { app, result } = context
        //   if (result && result.role === 'company') {
        //     try {
        //       const data = {
        //         name: result.companyId,
        //         ownerId: result._id,
        //         region: result.region,
        //         isActive: true,
        //         isVerified: false
        //       }
        //       const company = await app.service('companies').create(data)
        //       if (company && result._id) {
        //         const updateData = {
        //           ...result,
        //           companyId: company._id
        //         }
        //         const updatedUser = await app.service('users').update(result._id, updateData)
        //         context.result = updatedUser
        //       } else {
        //         console.error('Failed to update companyId in user data.')
        //       }
        //     } catch (error) {
        //       console.error('Failed to create company or update user:', error)
        //     }
        //   }
        //   return context
        // }
      ],
      patch: [
        // async (context: HookContext) => {
        //   const { app, result } = context
        //   if (result && result.role === 'company') {
        //     try {
        //       const data = {
        //         region: result.region,
        //         name: result.companyId,
        //         ownerId: result._id,
        //         isActive: true,
        //         isVerified: false
        //       }
        //       const company = await app.service('companies').create(data)
        //       if (company && result._id) {
        //         const updateData = {
        //           ...result,
        //           companyId: company._id
        //         }
        //         const updatedUser = await app.service('users').update(result._id, updateData)
        //         context.result = updatedUser
        //       } else {
        //         console.error('Failed to update companyId in user data.')
        //       }
        //     } catch (error) {
        //       console.error('Failed to create company or update user:', error)
        //     }
        //   }
        //   return context
        // }
      ]
    },
    error: {
      all: []
    }
  })
}

// Add this service to the service type index
declare module '../../declarations' {
  interface ServiceTypes {
    [userPath]: UserService
  }
}
