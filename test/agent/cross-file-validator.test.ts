import assert from 'assert'

import { CrossFileValidator } from '../../src/agent/pipeline/cross-file-validator'

describe('CrossFileValidator', () => {
  it('flags missing imported symbol from local module', () => {
    const validator = new CrossFileValidator()

    const files = [
      {
        path: 'main.py',
        content: `from app.schemas.user import UserCreate, UserResponse\n\nprint('ready')\n`
      },
      {
        path: 'app/schemas/user.py',
        content: `class UserCreate:\n    pass\n`
      }
    ]

    const schema = {
      projectName: 'mini',
      description: 'test',
      entities: [
        {
          name: 'User',
          fields: [{ name: 'id', type: 'str', required: true, indexed: true }],
          endpoints: []
        }
      ],
      features: [],
      authType: 'none' as const,
      relationships: []
    }

    const result = validator.validate(files as any, schema, [])

    assert.strictEqual(result.isValid, false)
    assert.ok(
      result.errors.some(
        error =>
          error.type === 'import' &&
          error.message.includes('missing symbol "UserResponse"') &&
          error.message.includes('app/schemas/user.py')
      )
    )
  })

  it('accepts common app/core alias imports and external jwt/session usage', () => {
    const validator = new CrossFileValidator()

    const files = [
      {
        path: 'app/core/config.py',
        content: `settings = object()`
      },
      {
        path: 'app/core/database.py',
        content: `def get_db():\n    return None`
      },
      {
        path: 'app/schemas/user.py',
        content: `class UserCreate:\n    pass\n\nclass UserResponse:\n    pass\n`
      },
      {
        path: 'main.py',
        content: `from app.config import settings\nfrom app.db import get_db\nfrom app.schemas.user import UserCreate, UserResponse\nimport jwt\nfrom sqlalchemy.orm import Session\n\ndef run(db: Session):\n    return db\n`
      }
    ]

    const schema = {
      projectName: 'mini',
      description: 'test',
      entities: [],
      features: [],
      authType: 'none' as const,
      relationships: []
    }

    const result = validator.validate(files as any, schema as any, [])

    assert.ok(
      !result.errors.some(
        error =>
          error.message.includes('app/config.py') ||
          error.message.includes('app/db.py') ||
          error.message.includes('jwt.py') ||
          error.message.includes('Reference to undefined model: Session')
      )
    )
  })
})
