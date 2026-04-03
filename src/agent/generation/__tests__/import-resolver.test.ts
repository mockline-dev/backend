import { describe, it, expect } from 'vitest'

import { resolveAvailableImports, findUnknownImports } from '../import-resolver'
import type { ProjectPlan } from '../../../types'

// ─── Fixture ─────────────────────────────────────────────────────────────────

const plan: ProjectPlan = {
  projectName: 'BlogApp',
  description: 'A blog',
  features: [],
  authRequired: true,
  externalPackages: [],
  entities: [
    {
      name: 'User',
      tableName: 'users',
      timestamps: true,
      softDelete: false,
      fields: [
        { name: 'email', type: 'email', required: true, unique: true },
        { name: 'username', type: 'string', required: true, unique: true },
        { name: 'password_hash', type: 'password', required: true, unique: false },
      ],
    },
    {
      name: 'Post',
      tableName: 'posts',
      timestamps: true,
      softDelete: false,
      fields: [
        { name: 'title', type: 'string', required: true, unique: false },
        { name: 'body', type: 'text', required: true, unique: false },
        {
          name: 'author_id',
          type: 'number',
          required: true,
          unique: false,
          reference: { entity: 'User', field: 'id' },
        },
      ],
    },
  ],
  relationships: [],
  endpoints: [],
}

const emptyGeneratedFiles = new Map<string, string>()

// ─── Service file tests ────────────────────────────────────────────────────────

describe('resolveAvailableImports — service file', () => {
  const result = resolveAvailableImports(
    'app/services/user_service.py',
    plan,
    emptyGeneratedFiles
  )

  it('includes model import', () => {
    expect(result).toContain('from app.models.user import User')
  })

  it('includes schema imports', () => {
    expect(result).toContain('UserCreate')
    expect(result).toContain('UserUpdate')
    expect(result).toContain('UserResponse')
  })

  it('includes CRUD import', () => {
    expect(result).toContain('from app.crud.user import crud_user')
  })

  it('includes CRUD method signatures', () => {
    expect(result).toContain('crud_user.get(')
    expect(result).toContain('crud_user.create(')
    expect(result).toContain('crud_user.get_multi(')
  })

  it('includes exception imports', () => {
    expect(result).toContain('NotFoundException')
    expect(result).toContain('BadRequestException')
  })

  it('includes Session import', () => {
    expect(result).toContain('from sqlalchemy.orm import Session')
  })
})

// ─── Route file tests ──────────────────────────────────────────────────────────

describe('resolveAvailableImports — route file', () => {
  it('includes FastAPI imports', () => {
    const result = resolveAvailableImports(
      'app/api/routes/user.py',
      plan,
      emptyGeneratedFiles
    )
    expect(result).toContain('from fastapi import')
    expect(result).toContain('APIRouter')
    expect(result).toContain('Depends')
  })

  it('includes schema imports', () => {
    const result = resolveAvailableImports(
      'app/api/routes/user.py',
      plan,
      emptyGeneratedFiles
    )
    expect(result).toContain('UserCreate')
    expect(result).toContain('UserResponse')
  })

  it('includes get_db dependency', () => {
    const result = resolveAvailableImports(
      'app/api/routes/user.py',
      plan,
      emptyGeneratedFiles
    )
    expect(result).toContain('get_db')
    expect(result).toContain('app.api.deps')
  })

  it('includes get_current_user when authRequired=true', () => {
    const result = resolveAvailableImports(
      'app/api/routes/user.py',
      plan,
      emptyGeneratedFiles
    )
    expect(result).toContain('get_current_user')
  })

  it('includes service function signatures parsed from generated service code', () => {
    const serviceCode = `
def get_user_or_404(db: Session, user_id: int) -> User:
    pass

def list_users(db: Session, skip: int = 0, limit: int = 100) -> list:
    pass
`
    const withService = new Map([['app/services/user_service.py', serviceCode]])
    const result = resolveAvailableImports('app/api/routes/user.py', plan, withService)

    expect(result).toContain('get_user_or_404')
    expect(result).toContain('list_users')
  })
})

// ─── Auth route tests ─────────────────────────────────────────────────────────

describe('resolveAvailableImports — auth route', () => {
  const result = resolveAvailableImports(
    'app/api/routes/auth.py',
    plan,
    emptyGeneratedFiles
  )

  it('includes OAuth2PasswordRequestForm', () => {
    expect(result).toContain('OAuth2PasswordRequestForm')
  })

  it('includes security imports', () => {
    expect(result).toContain('create_access_token')
    expect(result).toContain('verify_password')
    expect(result).toContain('get_password_hash')
  })

  it('includes user CRUD', () => {
    expect(result).toContain('crud_user')
  })
})

// ─── Test file tests ──────────────────────────────────────────────────────────

describe('resolveAvailableImports — test file', () => {
  it('includes pytest and TestClient', () => {
    const result = resolveAvailableImports(
      'tests/test_user.py',
      plan,
      emptyGeneratedFiles
    )
    expect(result).toContain('pytest')
    expect(result).toContain('TestClient')
  })

  it('includes route function signatures from generated route code', () => {
    const routeCode = `
async def list_users_endpoint(skip: int = 0, limit: int = 100, db: Session = None) -> list:
    pass
`
    const withRoute = new Map([['app/api/routes/user.py', routeCode]])
    const result = resolveAvailableImports('tests/test_user.py', plan, withRoute)
    expect(result).toContain('list_users_endpoint')
  })
})

// ─── findUnknownImports tests ─────────────────────────────────────────────────

describe('findUnknownImports', () => {
  const projectPaths = [
    'app/models/user.py',
    'app/schemas/user.py',
    'app/crud/user.py',
    'app/services/user_service.py',
  ]

  it('accepts stdlib imports', () => {
    const code = 'from typing import List, Optional\nimport os\nfrom datetime import datetime'
    expect(findUnknownImports(code, projectPaths)).toHaveLength(0)
  })

  it('accepts known package imports', () => {
    const code = 'from fastapi import APIRouter\nfrom sqlalchemy.orm import Session\nimport pytest'
    expect(findUnknownImports(code, projectPaths)).toHaveLength(0)
  })

  it('accepts project app.* imports', () => {
    const code = 'from app.models.user import User\nfrom app.schemas.user import UserCreate'
    expect(findUnknownImports(code, projectPaths)).toHaveLength(0)
  })

  it('flags unknown third-party imports', () => {
    const code = 'from unknown_package import something\nfrom fastapi import APIRouter'
    const unknown = findUnknownImports(code, projectPaths)
    expect(unknown).toContain('unknown_package')
    expect(unknown).not.toContain('fastapi')
  })

  it('returns empty for clean code', () => {
    const code = [
      'from fastapi import APIRouter, Depends',
      'from sqlalchemy.orm import Session',
      'from app.api.deps import get_db',
      'from app.models.user import User',
    ].join('\n')
    expect(findUnknownImports(code, projectPaths)).toHaveLength(0)
  })
})
