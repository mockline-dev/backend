/**
 * Universal Prompt System - Python/FastAPI Stack Configuration
 *
 * Stack configuration for Python with FastAPI framework.
 * Extracted from existing Python-specific prompt system.
 */

import type { StackConfig } from '../stack-config.types'

export const pythonFastApiStack: StackConfig = {
  id: 'python-fastapi',
  name: 'FastAPI',
  language: 'Python',
  framework: 'FastAPI',
  description:
    'Modern, fast web framework for building APIs with Python 3.7+ based on standard Python type hints',

  typeSystem: {
    primitiveTypes: {
      string: 'str',
      number: 'int',
      float: 'float',
      boolean: 'bool',
      date: 'datetime',
      object: 'dict'
    },
    collectionTypes: {
      array: 'List[T]',
      map: 'Dict[K, V]',
      set: 'Set[T]'
    },
    specialTypes: {
      id: 'str',
      email: 'str',
      phone: 'str',
      url: 'str',
      monetary: 'float',
      datetime: 'datetime',
      foreignKey: 'str'
    }
  },

  naming: {
    entityCase: 'PascalCase',
    fieldCase: 'snake_case',
    fileCase: 'snake_case'
  },

  structure: {
    directories: [
      'app/',
      'app/api/',
      'app/core/',
      'app/models/',
      'app/schemas/',
      'app/services/',
      'app/utils/',
      'tests/',
      'alembic/',
      'alembic/versions/'
    ],
    fileExtensions: ['.py'],
    packageFile: 'requirements.txt',
    configFiles: ['.env.example', 'alembic.ini']
  },

  dependencies: {
    packageManager: 'pip',
    dependencyFile: 'requirements.txt',
    corePackages: [
      {
        name: 'fastapi',
        version: '0.104.1',
        description: 'Modern, fast web framework for building APIs',
        required: true,
        category: 'core'
      },
      {
        name: 'uvicorn[standard]',
        version: '0.24.0',
        description: 'ASGI server for running FastAPI',
        required: true,
        category: 'core'
      },
      {
        name: 'sqlalchemy',
        version: '2.0.23',
        description: 'SQL toolkit and ORM',
        required: true,
        category: 'database'
      },
      {
        name: 'pydantic',
        version: '2.5.0',
        description: 'Data validation using Python type annotations',
        required: true,
        category: 'validation'
      },
      {
        name: 'pydantic-settings',
        version: '2.1.0',
        description: 'Settings management using Pydantic',
        required: true,
        category: 'core'
      },
      {
        name: 'alembic',
        version: '1.12.1',
        description: 'Database migration tool',
        required: true,
        category: 'database'
      }
    ],
    optionalPackages: {
      authentication: [
        {
          name: 'python-jose[cryptography]',
          version: '3.3.0',
          description: 'JWT token creation and verification',
          required: false,
          category: 'security'
        },
        {
          name: 'passlib[bcrypt]',
          version: '1.7.4',
          description: 'Password hashing library',
          required: false,
          category: 'security'
        },
        {
          name: 'python-multipart',
          version: '0.0.6',
          description: 'Form data parsing for file uploads',
          required: false,
          category: 'utility'
        }
      ],
      database: [
        {
          name: 'psycopg2-binary',
          version: '2.9.9',
          description: 'PostgreSQL database adapter',
          required: false,
          category: 'database'
        },
        {
          name: 'pymysql',
          version: '1.1.0',
          description: 'MySQL database adapter',
          required: false,
          category: 'database'
        },
        {
          name: 'oracledb',
          version: '2.0.0',
          description: 'Oracle database adapter',
          required: false,
          category: 'database'
        }
      ],
      validation: [
        {
          name: 'email-validator',
          version: '2.1.0',
          description: 'Email address validation',
          required: false,
          category: 'validation'
        }
      ]
    }
  },

  patterns: {
    imports: [
      {
        template: 'from {{IMPORTS}} import {{NAMES}}',
        description: 'Python import statement',
        examples: {
          controller: 'from fastapi import APIRouter, Depends, HTTPException',
          model: 'from sqlalchemy import Column, Integer, String',
          service: 'from app.models.user import User'
        }
      }
    ],
    models: {
      template: `from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class {{ENTITY_NAME}}(Base):
    __tablename__ = '{{TABLE_NAME}}'

    id = Column({{TYPE_SYSTEM.idType}}, primary_key=True)

{{FIELDS}}

{{RELATIONSHIPS}}`,
      fieldsTemplate: `    {{FIELD_NAME}} = Column({{FIELD_TYPE}})`,
      relationshipsTemplate: `    {{RELATIONSHIP_NAME}} = relationship("{{RELATED_ENTITY}}", back_populates="{{BACK_REFERENCE}}")`,
      example: `from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    posts = relationship("Post", back_populates="author")`
    },
    schemas: {
      template: `from pydantic import BaseModel, EmailStr, Field

class {{SCHEMA_NAME}}(BaseModel):
{{FIELDS}}`,
      fieldsTemplate: `    {{FIELD_NAME}}: {{FIELD_TYPE}} = Field(..., description="{{DESCRIPTION}}")`,
      example: `from pydantic import BaseModel, EmailStr, Field

class CreateUserSchema(BaseModel):
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=8, description="User password")`
    },
    services: {
      template: `from sqlalchemy.orm import Session
from app.models.{{MODEL_NAME_LOWER}} import {{MODEL_NAME}}
from app.schemas.{{MODEL_NAME_LOWER}} import {{MODEL_NAME}}Schema

class {{SERVICE_NAME}}:
    def __init__(self, db: Session):
        self.db = db

{{CRUD_METHODS}}`,
      crudTemplate: `    def create(self, {{SCHEMA_NAME_LOWER}}: {{MODEL_NAME}}Schema) -> {{MODEL_NAME}}:
        db_obj = {{MODEL_NAME}}(**{{SCHEMA_NAME_LOWER}}.dict())
        self.db.add(db_obj)
        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj

    def get(self, id: str) -> {{MODEL_NAME}} | None:
        return self.db.query({{MODEL_NAME}}).filter({{MODEL_NAME}}.id == id).first()

    def get_all(self, skip: int = 0, limit: int = 100) -> list[{{MODEL_NAME}}]:
        return self.db.query({{MODEL_NAME}}).offset(skip).limit(limit).all()

    def update(self, id: str, {{SCHEMA_NAME_LOWER}}: {{MODEL_NAME}}Schema) -> {{MODEL_NAME}} | None:
        db_obj = self.get(id)
        if db_obj:
            for key, value in {{SCHEMA_NAME_LOWER}}.dict(exclude_unset=True).items():
                setattr(db_obj, key, value)
            self.db.commit()
            self.db.refresh(db_obj)
        return db_obj

    def delete(self, id: str) -> bool:
        db_obj = self.get(id)
        if db_obj:
            self.db.delete(db_obj)
            self.db.commit()
            return True
        return False`,
      example: `from sqlalchemy.orm import Session
from app.models.user import User
from app.schemas.user import UserSchema

class UserService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, user_schema: UserSchema) -> User:
        db_obj = User(**user_schema.dict())
        self.db.add(db_obj)
        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj

    def get(self, id: str) -> User | None:
        return self.db.query(User).filter(User.id == id).first()`
    },
    controllers: {
      template: `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.{{SERVICE_NAME_LOWER}} import {{SERVICE_NAME}}
from app.schemas.{{MODEL_NAME_LOWER}} import {{MODEL_NAME}}Schema

router = APIRouter(prefix='/{{ROUTE_PREFIX}}', tags=['{{RESOURCE_NAME}}'])

{{ENDPOINTS}}`,
      endpointTemplate: `@router.get('/')
async def list_{{RESOURCE_NAME_LOWER}}(db: Session = Depends(get_db)):
    return {{SERVICE_INSTANCE}}.get_all()

@router.get('/{id}')
async def get_{{RESOURCE_NAME_LOWER}}(id: str, db: Session = Depends(get_db)):
    item = {{SERVICE_INSTANCE}}.get(id)
    if not item:
        raise HTTPException(status_code=404, detail="{{RESOURCE_NAME}} not found")
    return item

@router.post('/')
async def create_{{RESOURCE_NAME_LOWER}}({{SCHEMA_NAME_LOWER}}: {{MODEL_NAME}}Schema, db: Session = Depends(get_db)):
    return {{SERVICE_INSTANCE}}.create({{SCHEMA_NAME_LOWER}})

@router.put('/{id}')
async def update_{{RESOURCE_NAME_LOWER}}(id: str, {{SCHEMA_NAME_LOWER}}: {{MODEL_NAME}}Schema, db: Session = Depends(get_db)):
    item = {{SERVICE_INSTANCE}}.update(id, {{SCHEMA_NAME_LOWER}})
    if not item:
        raise HTTPException(status_code=404, detail="{{RESOURCE_NAME}} not found")
    return item

@router.delete('/{id}')
async def delete_{{RESOURCE_NAME_LOWER}}(id: str, db: Session = Depends(get_db)):
    success = {{SERVICE_INSTANCE}}.delete(id)
    if not success:
        raise HTTPException(status_code=404, detail="{{RESOURCE_NAME}} not found")
    return {"message": "Deleted successfully"}`,
      example: `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.user_service import UserService
from app.schemas.user import UserSchema

router = APIRouter(prefix='/users', tags=['users'])

@router.get('/')
async def list_users(db: Session = Depends(get_db)):
    return UserService(db).get_all()

@router.get('/{id}')
async def get_user(id: str, db: Session = Depends(get_db)):
    user = UserService(db).get(id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user`
    },
    config: {
      template: `from pydantic_settings import BaseSettings

class Settings(BaseSettings):
{{CONFIG_FIELDS}}

    class Config:
        env_file = ".env"

settings = Settings()`,
      envTemplate: `    {{FIELD_NAME}}: {{FIELD_TYPE}} = Field(default="{{DEFAULT_VALUE}}", description="{{DESCRIPTION}}")`,
      example: `from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = Field(default="sqlite:///./test.db", description="Database connection URL")
    secret_key: str = Field(default="secret", description="Secret key for JWT")
    
    class Config:
        env_file = ".env"

settings = Settings()`
    },
    database: {
      template: `from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()`,
      connectionTemplate: `from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)`,
      sessionTemplate: `def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()`,
      migrationTemplate: `"""{{MIGRATION_NAME}}

Revision ID: {{REVISION_ID}}
Revises: {{PREV_REVISION}}
Create Date: {{CREATE_DATE}}

"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    pass

def downgrade():
    pass`,
      example: `from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()`
    },
    security: {
      passwordHashTemplate: `from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)`,
      jwtTemplate: `from jose import JWTError, jwt
from datetime import datetime, timedelta

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm="HS256")
    return encoded_jwt

def verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        return payload
    except JWTError:
        return None`,
      middlewareTemplate: `from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError

security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )
    return payload`,
      example: `from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)`
    }
  },

  validation: {
    linter: 'ruff',
    linterCommand: 'ruff check --quiet --output-format=json',
    errorPatterns: [
      {
        regex: 'F821',
        category: 'Undefined name',
        fixStrategy: 'Add missing import or check for typos in variable names'
      },
      {
        regex: 'E999',
        category: 'Syntax error',
        fixStrategy: 'Fix syntax errors (missing colons, incorrect indentation, etc.)'
      },
      {
        regex: 'F401',
        category: 'Unused import',
        fixStrategy: 'Remove unused import statements'
      }
    ]
  },

  testing: {
    framework: 'pytest',
    testDirectory: 'tests/',
    testFilePattern: 'test_*.py'
  },

  fileStaging: [
    {
      stage: 0,
      patterns: ['requirements.txt', '.env', '.env.example', 'alembic.ini', 'app/core/**'],
      description: 'Configuration files and core utilities'
    },
    {
      stage: 1,
      patterns: ['app/models/**'],
      description: 'Database models'
    },
    {
      stage: 2,
      patterns: ['app/schemas/**'],
      description: 'Pydantic schemas'
    },
    {
      stage: 3,
      patterns: ['app/services/**', 'app/utils/**'],
      description: 'Business logic and utilities'
    },
    {
      stage: 4,
      patterns: ['app/api/**'],
      description: 'API routes and controllers'
    },
    {
      stage: 5,
      patterns: ['main.py', 'app/__init__.py'],
      description: 'Application entry point'
    },
    {
      stage: 6,
      patterns: ['tests/**', 'docs/**', 'readme.md', 'README.md'],
      description: 'Tests and documentation'
    }
  ],

  tokenBudgets: {
    'app/models/**': { maxTokens: 3200, contextWindow: 12288 },
    'app/services/**': { maxTokens: 3200, contextWindow: 12288 },
    'app/api/**': { maxTokens: 2600, contextWindow: 10240 },
    'app/schemas/**': { maxTokens: 2600, contextWindow: 10240 },
    'requirements.txt': { maxTokens: 1800, contextWindow: 8192 },
    'readme.md': { maxTokens: 1800, contextWindow: 8192 },
    'README.md': { maxTokens: 1800, contextWindow: 8192 },
    'docs/**': { maxTokens: 1800, contextWindow: 8192 },
    'tests/**': { maxTokens: 2200, contextWindow: 8192 },
    default: { maxTokens: 2400, contextWindow: 8192 }
  }
}
