import { logger } from '../../logger'
import type { GeneratedFile } from './file-generator'
import type { IntentSchema } from './intent-analyzer'
import type { Relationship } from './schema-validator'

export interface CrossFileValidationError {
  file: string
  message: string
  severity: 'error' | 'warning'
  type: 'import' | 'circular-dependency' | 'missing-model' | 'relationship'
}

export interface CrossFileValidationResult {
  isValid: boolean
  errors: CrossFileValidationError[]
  warnings: CrossFileValidationError[]
}

export class CrossFileValidator {
  /**
   * Validates cross-file dependencies, imports, and relationships across generated files.
   * This ensures that all imports are valid, no circular dependencies exist,
   * and all referenced models are properly defined.
   */
  validate(
    files: GeneratedFile[],
    schema: IntentSchema,
    relationships: Relationship[]
  ): CrossFileValidationResult {
    const errors: CrossFileValidationError[] = []
    const warnings: CrossFileValidationError[] = []

    logger.debug('CrossFileValidator: validating %d files', files.length)

    // 1. Validate imports across files
    this.validateImports(files, errors, warnings)

    // 2. Check for circular dependencies
    this.checkCircularDependencies(files, errors, warnings)

    // 3. Validate that all referenced models exist
    this.validateReferencedModels(files, schema, errors)

    // 4. Validate relationship implementations
    this.validateRelationships(files, relationships, errors, warnings)

    const isValid = errors.length === 0

    if (!isValid) {
      logger.error('CrossFileValidator: validation failed with %d errors', errors.length)
      for (const error of errors) {
        logger.error('  - %s: %s', error.file, error.message)
      }
    } else {
      logger.debug('CrossFileValidator: validation passed with %d warnings', warnings.length)
      for (const warning of warnings) {
        logger.warn('  - %s: %s', warning.file, warning.message)
      }
    }

    return { isValid, errors, warnings }
  }

  private validateImports(
    files: GeneratedFile[],
    errors: CrossFileValidationError[],
    warnings: CrossFileValidationError[]
  ): void {
    const filePaths = new Map<string, string>()

    // Build a map of file paths (normalized)
    for (const file of files) {
      const normalizedPath = this.normalizePath(file.path)
      filePaths.set(normalizedPath, file.path)
    }

    // Check each file's imports
    for (const file of files) {
      if (!file.path.endsWith('.py')) continue

      const imports = this.extractImports(file.content)

      for (const imp of imports) {
        // Skip external package imports - only validate local module imports
        if (this.isExternalPackage(imp)) {
          continue
        }

        // Check if the imported file exists
        const importedPath = this.resolveImportPath(file.path, imp)
        if (importedPath && !filePaths.has(importedPath)) {
          errors.push({
            file: file.path,
            message: `Import "${imp}" references non-existent file: ${importedPath}`,
            severity: 'error',
            type: 'import'
          })
        }
      }
    }
  }

  private extractImports(content: string): string[] {
    const imports: string[] = []

    // Match Python import statements
    // Use more specific patterns to capture only the module path
    const patterns = [
      // Match "from module.path import" - capture the module path
      // This pattern matches "from" followed by whitespace, then captures the module path
      // until we encounter whitespace followed by "import"
      /from\s+([a-zA-Z_][a-zA-Z0-9_.]*?)\s+import(?=[\s\(])/g,
      // Match "import module.path" - capture the module path
      // This pattern matches "import" followed by whitespace, then captures the module path
      /import\s+([a-zA-Z_][a-zA-Z0-9_.]*?)(?:\s|;|$)/g
    ]

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        imports.push(match[1])
      }
    }

    // Filter out individual symbols that might have been captured
    // We only want module paths (e.g., "sqlalchemy.orm", "app.models")
    // not individual symbols (e.g., "BaseSettings", "relationship")
    const modulePaths = imports.filter(imp => {
      // If it's a single word and looks like a symbol (PascalCase or mixed case),
      // it's likely an imported symbol, not a module path
      if (!imp.includes('.') && /^[A-Z][a-zA-Z0-9_]*$/.test(imp)) {
        return false
      }
      // If it's a single word and is a known Python built-in or common symbol name, skip it
      if (!imp.includes('.') && this.isCommonSymbolName(imp)) {
        return false
      }
      return true
    })

    return [...new Set(modulePaths)] // Remove duplicates
  }

  /**
   * Checks if a name is a common Python symbol name that's likely
   * not a module path (e.g., BaseSettings, CryptContext, relationship)
   */
  private isCommonSymbolName(name: string): boolean {
    const commonSymbols = new Set([
      // Pydantic symbols
      'BaseSettings',
      'EmailStr',
      'Field',
      'validator',
      'root_validator',
      // SQLAlchemy symbols
      'Column',
      'Integer',
      'String',
      'Boolean',
      'DateTime',
      'Date',
      'Time',
      'Float',
      'Numeric',
      'JSON',
      'ForeignKey',
      'relationship',
      'declarative_base',
      'create_engine',
      'sessionmaker',
      // Authentication symbols
      'CryptContext',
      'JWTError',
      'jwt',
      'OAuth2PasswordBearer',
      'OAuth2PasswordRequestForm',
      'Token',
      // FastAPI symbols
      'FastAPI',
      'APIRouter',
      'Depends',
      'HTTPException',
      'status',
      'CORSMiddleware',
      'Request',
      'Response',
      // Common Python types
      'Optional',
      'List',
      'Dict',
      'Union',
      'Any',
      'Type',
      // Database symbols
      'Session',
      'engine',
      'Base',
      'metadata',
      // Other common symbols
      'Enum',
      'UUID',
      'Binary',
      'LargeBinary',
      'Interval'
    ])
    return commonSymbols.has(name)
  }

  private resolveImportPath(currentFile: string, imp: string): string | null {
    // Simple resolution logic - can be enhanced
    const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/'))

    // Handle relative imports
    if (imp.startsWith('.')) {
      const parts = imp.split('/')
      let resolvedPath = currentDir

      for (const part of parts) {
        if (part === '..') {
          resolvedPath = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'))
        } else if (part !== '.') {
          resolvedPath = `${resolvedPath}/${part}`
        }
      }

      // Try .py extension
      return this.normalizePath(`${resolvedPath}.py`)
    }

    // Handle absolute imports (project-relative)
    return this.normalizePath(`${imp.replace(/\./g, '/')}.py`)
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\//, '')
  }

  /**
   * Checks if an import is an external package (not a local module).
   * Returns true for standard library and third-party packages.
   */
  private isExternalPackage(imp: string): boolean {
    // Clean the import string by removing any trailing commas or whitespace
    const cleanedImp = imp.replace(/,\s*$/, '').trim()

    // Common Python standard library modules
    const standardLibrary = new Set([
      'os',
      'sys',
      're',
      'json',
      'datetime',
      'time',
      'math',
      'random',
      'typing',
      'collections',
      'itertools',
      'functools',
      'pathlib',
      'io',
      'uuid',
      'hashlib',
      'base64',
      'secrets',
      'enum',
      'dataclasses',
      'contextlib',
      'asyncio',
      'threading',
      'multiprocessing',
      'logging',
      'decimal',
      'fractions',
      'statistics',
      'inspect',
      'warnings',
      'abc',
      'copy',
      'pickle',
      'shutil',
      'tempfile',
      'csv',
      'sqlite3',
      'http',
      'urllib',
      'email',
      'html',
      'xml',
      'socket',
      'ssl',
      'subprocess',
      'signal',
      'traceback',
      'gc',
      'weakref',
      'types',
      'zoneinfo',
      'typing_extensions',
      'dataclasses',
      'enum',
      'abc'
    ])

    // Common third-party packages used in web development
    const thirdPartyPackages = new Set([
      'fastapi',
      'pydantic',
      'pydantic_settings',
      'sqlalchemy',
      'alembic',
      'passlib',
      'python_jose',
      'python_multipart',
      'bcrypt',
      'python_dotenv',
      'uvicorn',
      'pytest',
      'httpx',
      'requests',
      'aiohttp',
      'celery',
      'redis',
      'pymongo',
      'motor',
      'beanie',
      'odmantic',
      'typer',
      'click',
      'jinja2',
      'itsdangerous',
      'werkzeug',
      'flask',
      'django',
      'numpy',
      'pandas',
      'matplotlib',
      'pillow',
      'opencv',
      'jwt',
      'PyJWT',
      'passlib',
      'context',
      'bcrypt',
      'python-jose',
      'python-multipart',
      'python-dotenv',
      'uvicorn',
      'pytest',
      'httpx',
      'requests',
      'aiohttp',
      'celery',
      'redis',
      'pymongo',
      'motor',
      'beanie',
      'odmantic',
      'typer',
      'click',
      'jinja2',
      'itsdangerous',
      'werkzeug',
      'flask',
      'django',
      'numpy',
      'pandas',
      'matplotlib',
      'pillow',
      'opencv',
      'starlette',
      'pydantic_core',
      'annotated_types',
      'email_validator',
      'orjson',
      'pydantic_extra_types',
      // Additional common packages
      'jose',
      'passlib',
      'context',
      'bcrypt',
      'python-jose',
      'python-multipart',
      'python-dotenv',
      'uvicorn',
      'pytest',
      'httpx',
      'requests',
      'aiohttp',
      'celery',
      'redis',
      'pymongo',
      'motor',
      'beanie',
      'odmantic',
      'typer',
      'click',
      'jinja2',
      'itsdangerous',
      'werkzeug',
      'flask',
      'django',
      'numpy',
      'pandas',
      'matplotlib',
      'pillow',
      'opencv',
      'starlette',
      'pydantic_core',
      'annotated_types',
      'email_validator',
      'orjson',
      'pydantic_extra_types'
    ])

    // Check for relative imports - these are always local
    if (cleanedImp.startsWith('.')) {
      return false
    }

    // Check if it's a project-local import (starts with common project prefixes)
    // For example: 'app.models', 'app.services', etc.
    if (cleanedImp.startsWith('app.') || cleanedImp.startsWith('src.')) {
      return false
    }

    // Extract the first component of the import path
    const firstComponent = cleanedImp.split('.')[0].trim()

    // Check if it's a standard library import
    if (standardLibrary.has(firstComponent)) {
      return true
    }

    // Check if it's a third-party package import
    if (thirdPartyPackages.has(firstComponent)) {
      return true
    }

    // Check for multi-level imports from known packages
    // e.g., "sqlalchemy.orm", "passlib.context", "pydantic_settings"
    if (cleanedImp.includes('.')) {
      const components = cleanedImp.split('.')
      // Check if any component (or combination) is a known package
      for (let i = 0; i < components.length; i++) {
        const prefix = components.slice(0, i + 1).join('.')
        if (thirdPartyPackages.has(prefix) || standardLibrary.has(prefix)) {
          return true
        }
      }
    }

    // If it's a multi-component import and the first component looks like a package
    // (not a single lowercase word that could be a local module), assume it's external
    if (cleanedImp.includes('.') && /^[A-Z]/.test(firstComponent)) {
      return true
    }

    // If it doesn't start with a dot and isn't in the known packages,
    // assume it's a local module (to be safe)
    return false
  }

  private checkCircularDependencies(
    files: GeneratedFile[],
    errors: CrossFileValidationError[],
    warnings: CrossFileValidationError[]
  ): void {
    // Build dependency graph
    const graph = new Map<string, Set<string>>()

    for (const file of files) {
      if (!file.path.endsWith('.py')) continue

      const dependencies = new Set<string>()
      const imports = this.extractImports(file.content)

      for (const imp of imports) {
        // Skip external packages - only track local module dependencies
        if (this.isExternalPackage(imp)) {
          continue
        }

        const importedPath = this.resolveImportPath(file.path, imp)
        if (importedPath) {
          dependencies.add(importedPath)
        }
      }

      graph.set(file.path, dependencies)
    }

    // Detect cycles using DFS
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const detectCycle = (node: string, path: string[]): boolean => {
      visited.add(node)
      recursionStack.add(node)
      path.push(node)

      const neighbors = graph.get(node) || new Set()
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (detectCycle(neighbor, path)) {
            return true
          }
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle - convert to warning since circular dependencies can sometimes be worked around
          const cycleStart = path.indexOf(neighbor)
          const cyclePath = [...path.slice(cycleStart), neighbor].join(' → ')
          warnings.push({
            file: node,
            message: `Circular dependency detected: ${cyclePath}. Consider refactoring or using lazy imports to resolve this.`,
            severity: 'warning',
            type: 'circular-dependency'
          })
          return true
        }
      }

      recursionStack.delete(node)
      path.pop()
      return false
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        detectCycle(node, [])
      }
    }
  }

  private validateReferencedModels(
    files: GeneratedFile[],
    schema: IntentSchema,
    errors: CrossFileValidationError[]
  ): void {
    const definedModels = new Set<string>()

    // Extract all defined models from files
    for (const file of files) {
      if (!file.path.endsWith('.py')) continue

      const models = this.extractModelDefinitions(file.content)
      for (const model of models) {
        definedModels.add(model)
      }
    }

    // Check if all schema entities have corresponding models
    for (const entity of schema.entities) {
      if (!definedModels.has(entity.name)) {
        errors.push({
          file: 'schema',
          message: `Schema entity "${entity.name}" has no corresponding model definition`,
          severity: 'error',
          type: 'missing-model'
        })
      }
    }

    // Check for references to undefined models in relationships
    for (const file of files) {
      if (!file.path.endsWith('.py')) continue

      const references = this.extractModelReferences(file.content)
      for (const ref of references) {
        if (!definedModels.has(ref) && !this.isBuiltInType(ref)) {
          errors.push({
            file: file.path,
            message: `Reference to undefined model: ${ref}`,
            severity: 'error',
            type: 'missing-model'
          })
        }
      }
    }
  }

  private extractModelDefinitions(content: string): string[] {
    const models: string[] = []

    // Match SQLAlchemy model definitions
    const pattern = /class\s+(\w+)\s*\([^)]*Base[^)]*\)/g
    let match: RegExpExecArray | null

    while ((match = pattern.exec(content)) !== null) {
      models.push(match[1])
    }

    return models
  }

  private extractModelReferences(content: string): string[] {
    const references: string[] = []

    // Match type annotations and ForeignKey references
    const patterns = [
      // More specific pattern for type annotations - must be followed by = or :
      // This avoids matching variable assignments like "expire="
      /:\s*([A-Z][a-zA-Z0-9_]*)\s*(?:=|,|\)|:)/g, // Type annotations (PascalCase)
      /ForeignKey\(['"]([a-z_][a-z0-9_]*)['"]\)/g, // ForeignKey references (snake_case table names)
      /relationship\(['"]([A-Z][a-zA-Z0-9_]*)['"]\)/g // SQLAlchemy relationships (PascalCase model names)
    ]

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        references.push(match[1])
      }
    }

    return [...new Set(references)] // Remove duplicates
  }

  private isBuiltInType(type: string): boolean {
    const builtInTypes = [
      // Basic types
      'str',
      'int',
      'float',
      'bool',
      // Date/time types
      'datetime',
      'date',
      'time',
      'timedelta',
      // Collection types
      'List',
      'Dict',
      'Set',
      'Tuple',
      'Optional',
      'Union',
      'Any',
      // SQLAlchemy types
      'Column',
      'Integer',
      'String',
      'Text',
      'Boolean',
      'DateTime',
      'Date',
      'Time',
      'Float',
      'Numeric',
      'JSON',
      'ForeignKey',
      'relationship',
      'Table',
      'Index',
      'UniqueConstraint',
      // SQLAlchemy ORM types
      'declarative_base',
      'create_engine',
      'sessionmaker',
      'Session',
      // Common variables/attributes
      'db',
      'Base',
      'engine',
      'session',
      'metadata',
      // Special attributes
      '__tablename__',
      '__table_args__',
      '__mapper_args__',
      // Other common types
      'Enum',
      'UUID',
      'Binary',
      'LargeBinary',
      'Interval',
      // Pydantic types
      'BaseSettings',
      'EmailStr',
      'Field',
      'validator',
      'root_validator',
      'model_validator',
      'computed_field',
      'field_validator',
      // Authentication types
      'CryptContext',
      'JWTError',
      'jwt',
      'OAuth2PasswordBearer',
      'OAuth2PasswordRequestForm',
      'Token',
      'TokenData',
      // FastAPI types
      'FastAPI',
      'APIRouter',
      'Depends',
      'HTTPException',
      'status',
      'CORSMiddleware',
      'Request',
      'Response',
      'Body',
      'Query',
      'Path',
      'Header',
      'Cookie',
      'Form',
      'File',
      'UploadFile',
      // Database types
      'AsyncSession',
      'async_sessionmaker'
    ]
    return builtInTypes.includes(type)
  }

  private validateRelationships(
    files: GeneratedFile[],
    relationships: Relationship[],
    errors: CrossFileValidationError[],
    warnings: CrossFileValidationError[]
  ): void {
    // Build a map of model definitions by file
    const modelsByFile = new Map<string, Set<string>>()

    for (const file of files) {
      if (!file.path.endsWith('.py')) continue

      const models = this.extractModelDefinitions(file.content)
      modelsByFile.set(file.path, new Set(models))
    }

    // Validate each relationship
    for (const rel of relationships) {
      // Check if both entities exist
      const fromExists = Array.from(modelsByFile.values()).some(models => models.has(rel.from))
      const toExists = Array.from(modelsByFile.values()).some(models => models.has(rel.to))

      if (!fromExists) {
        errors.push({
          file: 'relationships',
          message: `Relationship references non-existent entity: ${rel.from}`,
          severity: 'error',
          type: 'relationship'
        })
      }

      if (!toExists) {
        errors.push({
          file: 'relationships',
          message: `Relationship references non-existent entity: ${rel.to}`,
          severity: 'error',
          type: 'relationship'
        })
      }

      // Check if foreign key field exists (for many-to-one and one-to-one relationships)
      if (rel.foreignKey && (rel.type === 'many-to-one' || rel.type === 'one-to-one')) {
        let foreignKeyFound = false

        for (const [file, models] of modelsByFile.entries()) {
          if (models.has(rel.from)) {
            const fileContent = files.find(f => f.path === file)?.content
            if (fileContent) {
              foreignKeyFound = fileContent.includes(rel.foreignKey!)
              break
            }
          }
        }

        if (!foreignKeyFound) {
          warnings.push({
            file: 'relationships',
            message: `Foreign key field "${rel.foreignKey}" may be missing in ${rel.from} for relationship ${rel.from} → ${rel.to}`,
            severity: 'warning',
            type: 'relationship'
          })
        }
      }
    }
  }
}
