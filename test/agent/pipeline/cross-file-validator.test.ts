import { describe, it, expect } from 'vitest'
import { CrossFileValidator } from '../../../src/agent/pipeline/cross-file-validator'
import type { GeneratedFile } from '../../../src/agent/pipeline/file-generator'
import type { IntentSchema } from '../../../src/agent/pipeline/intent-analyzer'
import type { Relationship } from '../../../src/agent/pipeline/schema-validator'

describe('CrossFileValidator', () => {
  const validator = new CrossFileValidator()

  describe('import validation', () => {
    it('should not report errors for standard library imports', () => {
      const files: GeneratedFile[] = [
        {
          path: 'app/main.py',
          content: `
import os
import sys
from typing import List, Dict
from datetime import datetime
`
        }
      ]

      const schema: IntentSchema = {
        entities: [],
        relationships: []
      }

      const relationships: Relationship[] = []

      const result = validator.validate(files, schema, relationships)

      expect(result.isValid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should not report errors for third-party package imports', () => {
      const files: GeneratedFile[] = [
        {
          path: 'app/core/config.py',
          content: `
from pydantic_settings import BaseSettings
from fastapi import HTTPException
from sqlalchemy import create_engine, declarative_base
from passlib.context import CryptContext
from jwt import encode, decode
`
        }
      ]

      const schema: IntentSchema = {
        entities: [],
        relationships: []
      }

      const relationships: Relationship[] = []

      const result = validator.validate(files, schema, relationships)

      expect(result.isValid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should report errors for missing local imports', () => {
      const files: GeneratedFile[] = [
        {
          path: 'app/main.py',
          content: `
from app.models.user import User
from app.services.auth import AuthService
`
        }
      ]

      const schema: IntentSchema = {
        entities: [],
        relationships: []
      }

      const relationships: Relationship[] = []

      const result = validator.validate(files, schema, relationships)

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.message.includes('app/models/user.py'))).toBe(true)
      expect(result.errors.some(e => e.message.includes('app/services/auth.py'))).toBe(true)
    })

    it('should not report errors for existing local imports', () => {
      const files: GeneratedFile[] = [
        {
          path: 'app/main.py',
          content: `
from app.models.user import User
from app.services.auth import AuthService
`
        },
        {
          path: 'app/models/user.py',
          content: `
class User:
    pass
`
        },
        {
          path: 'app/services/auth.py',
          content: `
class AuthService:
    pass
`
        }
      ]

      const schema: IntentSchema = {
        entities: [],
        relationships: []
      }

      const relationships: Relationship[] = []

      const result = validator.validate(files, schema, relationships)

      expect(result.isValid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should handle relative imports correctly', () => {
      const files: GeneratedFile[] = [
        {
          path: 'app/models/user.py',
          content: `
from .base import BaseModel
`
        },
        {
          path: 'app/models/base.py',
          content: `
class BaseModel:
    pass
`
        }
      ]

      const schema: IntentSchema = {
        entities: [],
        relationships: []
      }

      const relationships: Relationship[] = []

      const result = validator.validate(files, schema, relationships)

      expect(result.isValid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should handle mixed imports correctly', () => {
      const files: GeneratedFile[] = [
        {
          path: 'app/main.py',
          content: `
import os
from typing import List
from fastapi import FastAPI
from pydantic import BaseModel
from app.models.user import User
from app.services.auth import AuthService
`
        },
        {
          path: 'app/models/user.py',
          content: `
from pydantic import BaseModel

class User(BaseModel):
    pass
`
        },
        {
          path: 'app/services/auth.py',
          content: `
from passlib.context import CryptContext

class AuthService:
    pass
`
        }
      ]

      const schema: IntentSchema = {
        entities: [],
        relationships: []
      }

      const relationships: Relationship[] = []

      const result = validator.validate(files, schema, relationships)

      expect(result.isValid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should not report false positives for common web development packages', () => {
      const files: GeneratedFile[] = [
        {
          path: 'app/core/security.py',
          content: `
from fastapi import HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
`
        }
      ]

      const schema: IntentSchema = {
        entities: [],
        relationships: []
      }

      const relationships: Relationship[] = []

      const result = validator.validate(files, schema, relationships)

      expect(result.isValid).toBe(true)
      expect(result.errors.length).toBe(0)
    })
  })
})
