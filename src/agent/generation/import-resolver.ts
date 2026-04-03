import type { ProjectPlan, PlanEntity } from '../../types'

// ─── Known module sets ────────────────────────────────────────────────────────

const STDLIB_MODULES = new Set([
  '__future__', 'abc', 'asyncio', 'base64', 'collections', 'contextlib',
  'copy', 'dataclasses', 'datetime', 'enum', 'functools', 'hashlib',
  'hmac', 'inspect', 'io', 'itertools', 'json', 'logging', 'math',
  'os', 'pathlib', 're', 'random', 'string', 'sys', 'threading',
  'time', 'traceback', 'typing', 'uuid', 'warnings',
])

const PACKAGE_MODULES = new Set([
  'alembic', 'anyio', 'bcrypt', 'email_validator', 'fastapi',
  'httpx', 'jose', 'multipart', 'passlib', 'pydantic',
  'pydantic_settings', 'pytest', 'sqlalchemy', 'starlette', 'uvicorn',
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase()
}

function toPascalCase(s: string): string {
  return s.replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^(.)/, c => c.toUpperCase())
}

/**
 * Extracts `def func_name(params) -> ReturnType` signatures from Python source.
 */
function extractFunctionSignatures(code: string): string[] {
  const regex = /^(?:async\s+)?def\s+([a-z_][a-z0-9_]*)\(([^)]*)\)(?:\s*->\s*([^\n:]+))?/gm
  const sigs: string[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(code)) !== null) {
    const name = m[1]
    const params = m[2].trim()
    const ret = m[3]?.trim() ?? 'None'
    sigs.push(`  ${name}(${params}) -> ${ret}`)
  }
  return sigs
}

function findEntityForFile(filePath: string, entities: PlanEntity[]): PlanEntity | undefined {
  // Match snake_case entity name in the file path segment
  for (const entity of entities) {
    const snake = toSnakeCase(entity.name)
    if (
      filePath.includes(`/${snake}_service.py`) ||
      filePath.includes(`/routes/${snake}.py`) ||
      filePath.includes(`/test_${snake}.py`) ||
      filePath.endsWith(`/${snake}.py`)
    ) {
      return entity
    }
  }
  return undefined
}

function schemaNames(entityName: string): string {
  const pascal = toPascalCase(entityName)
  return `${pascal}Base, ${pascal}Create, ${pascal}Update, ${pascal}Response`
}

// ─── CRUD method block ────────────────────────────────────────────────────────

function crudMethodBlock(entityName: string): string {
  const pascal = toPascalCase(entityName)
  const snake = toSnakeCase(entityName)
  return [
    `  crud_${snake}.get(db, id: int) -> Optional[${pascal}]`,
    `  crud_${snake}.get_multi(db, skip: int = 0, limit: int = 100) -> List[${pascal}]`,
    `  crud_${snake}.create(db, obj_in: ${pascal}Create) -> ${pascal}`,
    `  crud_${snake}.update(db, db_obj: ${pascal}, obj_in: ${pascal}Update) -> ${pascal}`,
    `  crud_${snake}.remove(db, id: int) -> Optional[${pascal}]`,
  ].join('\n')
}

// ─── Per-file-type resolvers ──────────────────────────────────────────────────

function resolveServiceImports(entity: PlanEntity, authRequired: boolean): string {
  const pascal = toPascalCase(entity.name)
  const snake = toSnakeCase(entity.name)
  const lines: string[] = [
    'Available imports (use ONLY these, do not invent others):',
    '',
    'Standard library:',
    '  from typing import List, Optional',
    '  from sqlalchemy.orm import Session',
    '',
    'Project model:',
    `  from app.models.${snake} import ${pascal}`,
    '',
    'Project schemas:',
    `  from app.schemas.${snake} import ${schemaNames(entity.name)}`,
    '',
    'Project CRUD:',
    `  from app.crud.${snake} import crud_${snake}`,
    `  crud_${snake} methods:`,
    crudMethodBlock(entity.name),
    '',
    'Exceptions:',
    '  from app.core.exceptions import NotFoundException, BadRequestException',
  ]
  if (authRequired) {
    lines.push('', 'Security:', '  from app.core.security import get_password_hash, verify_password')
  }
  return lines.join('\n')
}

function resolveRouteImports(
  entity: PlanEntity,
  authRequired: boolean,
  generatedFiles: Map<string, string>
): string {
  const pascal = toPascalCase(entity.name)
  const snake = toSnakeCase(entity.name)
  const servicePath = `app/services/${snake}_service.py`
  const serviceCode = generatedFiles.get(servicePath) ?? ''
  const sigs = extractFunctionSignatures(serviceCode)

  const lines: string[] = [
    'Available imports (use ONLY these, do not invent others):',
    '',
    'FastAPI:',
    '  from fastapi import APIRouter, Depends, HTTPException, status',
    '  from typing import List',
    '',
    'Database dependency:',
    '  from app.api.deps import get_db',
  ]
  if (authRequired) {
    lines.push('  from app.api.deps import get_current_user')
  }
  lines.push(
    '',
    'Schemas:',
    `  from app.schemas.${snake} import ${pascal}Create, ${pascal}Update, ${pascal}Response`,
    '',
    `Service functions (from ${servicePath}):`,
  )
  if (sigs.length > 0) {
    lines.push(`  from app.services.${snake}_service import (`)
    for (const sig of sigs) {
      const fnName = sig.trim().split('(')[0]
      lines.push(`      ${fnName},`)
    }
    lines.push('  )')
    lines.push('  Signatures:')
    lines.push(...sigs)
  } else {
    lines.push(`  from app.services.${snake}_service import *  # service not yet generated`)
  }
  return lines.join('\n')
}

function resolveAuthRouteImports(
  entities: PlanEntity[],
  generatedFiles: Map<string, string>
): string {
  const userEntity = entities.find(e => e.name.toLowerCase() === 'user') ?? entities[0]
  const pascal = userEntity ? toPascalCase(userEntity.name) : 'User'
  const snake = userEntity ? toSnakeCase(userEntity.name) : 'user'

  const servicePath = `app/services/${snake}_service.py`
  const serviceCode = generatedFiles.get(servicePath) ?? ''
  const sigs = extractFunctionSignatures(serviceCode)

  const lines: string[] = [
    'Available imports (use ONLY these, do not invent others):',
    '',
    'FastAPI:',
    '  from fastapi import APIRouter, Depends, HTTPException, status',
    '  from fastapi.security import OAuth2PasswordRequestForm',
    '',
    'Security:',
    '  from app.core.security import create_access_token, get_password_hash, verify_password',
    '',
    `${pascal} CRUD:`,
    `  from app.crud.${snake} import crud_${snake}`,
    `  crud_${snake} methods:`,
    crudMethodBlock(userEntity?.name ?? 'User'),
    '',
    'Schemas:',
    `  from app.schemas.${snake} import ${pascal}Create, ${pascal}Response`,
    '',
    'Database dependency:',
    '  from app.api.deps import get_db',
  ]
  if (sigs.length > 0) {
    lines.push('', `Service functions (from ${servicePath}):`)
    lines.push(...sigs)
  }
  return lines.join('\n')
}

function resolveTestImports(entity: PlanEntity, generatedFiles: Map<string, string>): string {
  const snake = toSnakeCase(entity.name)
  const routePath = `app/api/routes/${snake}.py`
  const routeCode = generatedFiles.get(routePath) ?? ''
  const sigs = extractFunctionSignatures(routeCode)

  const lines: string[] = [
    'Available imports (use ONLY these, do not invent others):',
    '',
    'Test utilities (use pytest fixtures from conftest.py):',
    '  import pytest',
    '  from fastapi.testclient import TestClient',
    '  # Fixtures available: client (TestClient), db (Session)',
    '',
    'All API routes are prefixed with /api/v1',
    `Entity routes: /api/v1/${snake}s/`,
  ]
  if (sigs.length > 0) {
    lines.push('', `Route handlers (from ${routePath}):`)
    lines.push(...sigs)
  }
  return lines.join('\n')
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Computes the exact import context string for a file about to be LLM-generated.
 *
 * Prevents the LLM from hallucinating imports by listing only what is available.
 */
export function resolveAvailableImports(
  targetFile: string,
  plan: ProjectPlan,
  generatedFiles: Map<string, string>
): string {
  // Auth route
  if (targetFile === 'app/api/routes/auth.py') {
    return resolveAuthRouteImports(plan.entities, generatedFiles)
  }

  // Test file
  if (targetFile.startsWith('tests/test_')) {
    const entity = findEntityForFile(targetFile, plan.entities)
    if (entity) return resolveTestImports(entity, generatedFiles)
  }

  // Service file
  if (targetFile.startsWith('app/services/') && targetFile.endsWith('_service.py')) {
    const entity = findEntityForFile(targetFile, plan.entities)
    if (entity) return resolveServiceImports(entity, plan.authRequired)
  }

  // Route file
  if (targetFile.startsWith('app/api/routes/')) {
    const entity = findEntityForFile(targetFile, plan.entities)
    if (entity) return resolveRouteImports(entity, plan.authRequired, generatedFiles)
  }

  // Fallback — generic imports
  return [
    'Available imports:',
    '  from fastapi import APIRouter, Depends, HTTPException, status',
    '  from sqlalchemy.orm import Session',
    '  from app.api.deps import get_db',
    '  from app.core.exceptions import NotFoundException, BadRequestException',
  ].join('\n')
}

// ─── Import validator ─────────────────────────────────────────────────────────

/**
 * Checks every import in Python source against known stdlib, packages, and project paths.
 * Returns a list of unrecognised module names (empty = all OK).
 */
export function findUnknownImports(
  code: string,
  projectPaths: string[]
): string[] {
  const knownProjectRoots = new Set(
    projectPaths
      .map(p => p.replace(/\//g, '.').replace(/\.py$/, ''))
      .flatMap(p => {
        // 'app.models.user' → ['app', 'app.models', 'app.models.user']
        const parts = p.split('.')
        return parts.map((_, i) => parts.slice(0, i + 1).join('.'))
      })
  )
  // Always allow 'app' and 'tests' root
  knownProjectRoots.add('app')
  knownProjectRoots.add('tests')

  const importRegex = /^(?:from\s+(\S+)|import\s+(\S+))/gm
  const unknown: string[] = []
  let m: RegExpExecArray | null

  while ((m = importRegex.exec(code)) !== null) {
    const modulePath = (m[1] ?? m[2]).split('.')[0]
    const full = m[1] ?? m[2]

    if (
      !STDLIB_MODULES.has(modulePath) &&
      !PACKAGE_MODULES.has(modulePath) &&
      !knownProjectRoots.has(full) &&
      !full.startsWith('app') &&
      !full.startsWith('tests')
    ) {
      unknown.push(full)
    }
  }

  return [...new Set(unknown)]
}
