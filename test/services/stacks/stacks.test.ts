import { NotFound } from '@feathersjs/errors'

describe('Stacks Service', () => {
  const stacksService = app.service('stacks')

  describe('find() - Get all stacks', () => {
    it('should return an array of all available stacks', async () => {
      const result = await stacksService.find()

      // Result should be an array
      assert.ok(Array.isArray(result), 'Result should be an array')

      // Should have at least 5 stacks (python-fastapi, nodejs-nestjs, go-gin, rust-actix, java-springboot)
      assert.ok(result.length >= 5, `Should have at least 5 stacks, got ${result.length}`)
    })

    it('should return stacks with correct structure', async () => {
      const result = await stacksService.find()
      const stack = result[0] as any

      // Verify stack structure
      assert.ok(typeof stack.id === 'string', 'Stack should have id')
      assert.ok(typeof stack.name === 'string', 'Stack should have name')
      assert.ok(typeof stack.language === 'string', 'Stack should have language')
      assert.ok(typeof stack.framework === 'string', 'Stack should have framework')
      assert.ok(typeof stack.description === 'string', 'Stack should have description')
      assert.ok(Array.isArray(stack.features), 'Stack should have features array')
      assert.ok(
        stack.icon === undefined || typeof stack.icon === 'string',
        'Stack icon should be string or undefined'
      )
      assert.ok(
        stack.color === undefined || typeof stack.color === 'string',
        'Stack color should be string or undefined'
      )
    })

    it('should include expected stacks', async () => {
      const result = await stacksService.find()
      const stackIds = result.map((stack: any) => stack.id)

      // Verify expected stack IDs are present
      assert.ok(stackIds.includes('python-fastapi'), 'Should include python-fastapi stack')
      assert.ok(stackIds.includes('nodejs-nestjs'), 'Should include nodejs-nestjs stack')
      assert.ok(stackIds.includes('go-gin'), 'Should include go-gin stack')
      assert.ok(stackIds.includes('rust-actix'), 'Should include rust-actix stack')
      assert.ok(stackIds.includes('java-springboot'), 'Should include java-springboot stack')
    })

    it('should include features for each stack', async () => {
      const result = await stacksService.find()
      const stack = result[0] as any

      // Features should be a non-empty array
      assert.ok(stack.features.length > 0, 'Stack should have at least one feature')

      // Each feature should be a string
      stack.features.forEach((feature: string) => {
        assert.ok(typeof feature === 'string', 'Each feature should be a string')
      })
    })
  })

  describe('find() - Pagination', () => {
    it('should support pagination with $limit', async () => {
      const result = await stacksService.find({
        query: { $limit: 2 }
      })

      // Result should be paginated
      assert.ok('data' in result, 'Result should have data property')
      assert.ok('total' in result, 'Result should have total property')
      assert.ok('limit' in result, 'Result should have limit property')
      assert.ok('skip' in result, 'Result should have skip property')

      const paginatedResult = result as any
      assert.strictEqual(paginatedResult.data.length, 2, 'Should return exactly 2 stacks')
      assert.ok(paginatedResult.total >= 5, 'Total should be at least 5')
      assert.strictEqual(paginatedResult.limit, 2, 'Limit should be 2')
      assert.strictEqual(paginatedResult.skip, 0, 'Skip should be 0')
    })

    it('should support pagination with $skip', async () => {
      const result = await stacksService.find({
        query: { $limit: 2, $skip: 1 }
      })

      const paginatedResult = result as any
      assert.strictEqual(paginatedResult.data.length, 2, 'Should return exactly 2 stacks')
      assert.strictEqual(paginatedResult.skip, 1, 'Skip should be 1')
    })

    it('should return all stacks without pagination params', async () => {
      const result = await stacksService.find()

      // Without pagination, result should be an array
      assert.ok(Array.isArray(result), 'Result should be an array without pagination')
    })
  })

  describe('get() - Get specific stack', () => {
    it('should return a specific stack by ID', async () => {
      const stack = await stacksService.get('python-fastapi')

      // Verify stack properties
      assert.strictEqual(stack.id, 'python-fastapi', 'Stack ID should match')
      assert.strictEqual(stack.name, 'FastAPI', 'Stack name should be FastAPI')
      assert.strictEqual(stack.language, 'Python', 'Stack language should be Python')
      assert.strictEqual(stack.framework, 'FastAPI', 'Stack framework should be FastAPI')
      assert.ok(typeof stack.description === 'string', 'Stack should have description')
      assert.ok(Array.isArray(stack.features), 'Stack should have features array')
    })

    it('should return correct stack for nodejs-nestjs', async () => {
      const stack = await stacksService.get('nodejs-nestjs')

      assert.strictEqual(stack.id, 'nodejs-nestjs', 'Stack ID should match')
      assert.strictEqual(stack.name, 'NestJS', 'Stack name should be NestJS')
      assert.strictEqual(stack.language, 'TypeScript', 'Stack language should be TypeScript')
      assert.strictEqual(stack.framework, 'NestJS', 'Stack framework should be NestJS')
    })

    it('should return correct stack for go-gin', async () => {
      const stack = await stacksService.get('go-gin')

      assert.strictEqual(stack.id, 'go-gin', 'Stack ID should match')
      assert.strictEqual(stack.name, 'Gin', 'Stack name should be Gin')
      assert.strictEqual(stack.language, 'Go', 'Stack language should be Go')
      assert.strictEqual(stack.framework, 'Gin', 'Stack framework should be Gin')
    })

    it('should return correct stack for rust-actix', async () => {
      const stack = await stacksService.get('rust-actix')

      assert.strictEqual(stack.id, 'rust-actix', 'Stack ID should match')
      assert.strictEqual(stack.name, 'Actix Web', 'Stack name should be Actix Web')
      assert.strictEqual(stack.language, 'Rust', 'Stack language should be Rust')
      assert.strictEqual(stack.framework, 'Actix Web', 'Stack framework should be Actix Web')
    })

    it('should return correct stack for java-springboot', async () => {
      const stack = await stacksService.get('java-springboot')

      assert.strictEqual(stack.id, 'java-springboot', 'Stack ID should match')
      assert.strictEqual(stack.name, 'Spring Boot', 'Stack name should be Spring Boot')
      assert.strictEqual(stack.language, 'Java', 'Stack language should be Java')
      assert.strictEqual(stack.framework, 'Spring Boot', 'Stack framework should be Spring Boot')
    })

    it('should include icon URL for known stacks', async () => {
      const stack = await stacksService.get('python-fastapi')

      assert.ok(typeof stack.icon === 'string', 'Stack should have icon URL')
      assert.ok(stack.icon.startsWith('http'), 'Icon should be a valid URL')
    })

    it('should include color theme for known stacks', async () => {
      const stack = await stacksService.get('python-fastapi')

      assert.ok(typeof stack.color === 'string', 'Stack should have color')
      assert.ok(stack.color.startsWith('#'), 'Color should be a hex color code')
    })
  })

  describe('get() - Error handling', () => {
    it('should throw NotFound for invalid stack ID', async () => {
      try {
        await stacksService.get('invalid-stack-id')
        assert.fail('Should have thrown NotFound error')
      } catch (error: any) {
        assert.ok(error instanceof NotFound, 'Should throw NotFound error')
        assert.ok(error.message.includes('not found'), 'Error message should mention not found')
      }
    })

    it('should throw NotFound for empty stack ID', async () => {
      try {
        await stacksService.get('')
        assert.fail('Should have thrown NotFound error')
      } catch (error: any) {
        assert.ok(error instanceof NotFound, 'Should throw NotFound error')
      }
    })

    it('should throw NotFound for non-existent stack', async () => {
      try {
        await stacksService.get('non-existent-stack-12345')
        assert.fail('Should have thrown NotFound error')
      } catch (error: any) {
        assert.ok(error instanceof NotFound, 'Should throw NotFound error')
      }
    })
  })

  describe('Stack features extraction', () => {
    it('should include language and framework in features', async () => {
      const stack = await stacksService.get('python-fastapi')

      assert.ok(
        stack.features.some((f: string) => f.includes('Python')),
        'Features should include language'
      )
      assert.ok(
        stack.features.some((f: string) => f.includes('FastAPI')),
        'Features should include framework'
      )
    })

    it('should include testing framework in features', async () => {
      const stack = await stacksService.get('python-fastapi')

      assert.ok(
        stack.features.some((f: string) => f.includes('Testing')),
        'Features should include testing framework'
      )
    })

    it('should include linter in features', async () => {
      const stack = await stacksService.get('python-fastapi')

      assert.ok(
        stack.features.some((f: string) => f.includes('Linting')),
        'Features should include linter'
      )
    })

    it('should include package manager in features', async () => {
      const stack = await stacksService.get('python-fastapi')

      assert.ok(
        stack.features.some((f: string) => f.includes('Package Manager')),
        'Features should include package manager'
      )
    })
  })

  describe('Service methods', () => {
    it('should only expose find and get methods', () => {
      const service = stacksService as any

      // Verify find and get methods exist
      assert.ok(typeof service.find === 'function', 'Service should have find method')
      assert.ok(typeof service.get === 'function', 'Service should have get method')

      // Verify create, update, patch, remove methods don't exist (stacks are read-only)
      assert.ok(typeof service.create === 'undefined', 'Service should not have create method')
      assert.ok(typeof service.update === 'undefined', 'Service should not have update method')
      assert.ok(typeof service.patch === 'undefined', 'Service should not have patch method')
      assert.ok(typeof service.remove === 'undefined', 'Service should not have remove method')
    })
  })
})
