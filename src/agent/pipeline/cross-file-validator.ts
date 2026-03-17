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

    // Pattern 1: "from MODULE import ..." — captures MODULE (the path before `import`)
    // This is safe: we stop at the whitespace before `import`, so we never grab names.
    const fromPattern = /from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import/g

    // Pattern 2: bare "import MODULE" at the start of a logical line.
    // MUST NOT match the `import` keyword that appears inside "from X import Y" —
    // use a negative lookbehind on `from\s+\S+\s+` to exclude those cases, or
    // anchor to line start with the multiline flag.
    const barePattern = /^import\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gm

    let match: RegExpExecArray | null
    while ((match = fromPattern.exec(content)) !== null) {
      imports.push(match[1])
    }
    while ((match = barePattern.exec(content)) !== null) {
      imports.push(match[1])
    }

    return Array.from(new Set(imports)) // Remove duplicates
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
      'typing_extensions',
      'zoneinfo',
      'graphlib'
    ])

    // Common third-party packages used in web development
    const thirdPartyPackages = new Set([
      'fastapi',
      'pydantic',
      'pydantic_settings',
      'sqlalchemy',
      'alembic',
      'passlib',
      'python-jose',
      'python-multipart',
      'bcrypt',
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
      'opencv-python',
      'jose',
      'email_validator',
      'aiofiles',
      'python_multipart'
    ])

    // Extract the first component of the import path
    // Handle cases like "from typing import List" -> "typing"
    // Handle cases like "from app.models.user import User" -> "app"
    const firstComponent = imp.split('.')[0].split(',')[0].trim()

    // Check if it's a standard library import
    if (standardLibrary.has(firstComponent)) {
      return true
    }

    // Check if it's a third-party package import
    if (thirdPartyPackages.has(firstComponent)) {
      return true
    }

    // Check for relative imports - these are always local
    if (imp.startsWith('.')) {
      return false
    }

    // Check if it's a project-local import (starts with common project prefixes)
    // For example: 'app.models', 'app.services', etc.
    if (imp.startsWith('app.') || imp.startsWith('src.')) {
      return false
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
      for (const neighbor of Array.from(neighbors)) {
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

    for (const node of Array.from(graph.keys())) {
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

    // Check if all schema entities have corresponding models.
    // Entities are PascalCase (ShoppingCart) but the LLM may generate snake_case class
    // names (Shopping_cart) derived from the snake_case filename.  Accept any variant.
    for (const entity of schema.entities) {
      const variants = this.entityNameVariants(entity.name)
      if (!variants.some(v => definedModels.has(v))) {
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

  /**
   * Returns all reasonable variations of an entity name so that validation is
   * robust against LLMs that output snake_case class names instead of PascalCase.
   *
   * Example: ShoppingCart → ['ShoppingCart', 'Shopping_cart', 'Shopping_Cart']
   *          OrderItem    → ['OrderItem', 'Order_item', 'Order_Item']
   */
  private entityNameVariants(pascal: string): string[] {
    const variants = new Set<string>([pascal])

    // Insert underscores before each uppercase letter that follows a lowercase letter
    // e.g. ShoppingCart → Shopping_Cart
    const withUnderscores = pascal.replace(/([a-z])([A-Z])/g, '$1_$2')
    variants.add(withUnderscores)           // Shopping_Cart
    variants.add(withUnderscores.toLowerCase())  // shopping_cart
    // First letter uppercase, rest lowercase snake
    const lowerSnake = withUnderscores.toLowerCase()
    variants.add(lowerSnake.charAt(0).toUpperCase() + lowerSnake.slice(1)) // Shopping_cart

    return Array.from(variants)
  }

  private extractModelDefinitions(content: string): string[] {
    const models: string[] = []

    // Primary: SQLAlchemy class extending any variant of Base (most common)
    const basePattern = /class\s+([A-Z][a-zA-Z0-9]*)\s*\([^)]*Base[^)]*\)/g
    let match: RegExpExecArray | null
    while ((match = basePattern.exec(content)) !== null) {
      models.push(match[1])
    }

    // Fallback: any PascalCase class definition — catches SQLModel, db.Model, etc.
    // Only add if not already captured above to avoid duplicates.
    const existing = new Set(models)
    const fallbackPattern = /class\s+([A-Z][a-zA-Z0-9]*)\s*\([^)]+\)/g
    while ((match = fallbackPattern.exec(content)) !== null) {
      if (!existing.has(match[1])) {
        models.push(match[1])
        existing.add(match[1])
      }
    }

    return models
  }

  private extractModelReferences(content: string): string[] {
    const references: string[] = []

    // Match type annotations and ForeignKey references
    const patterns = [
      // More specific pattern for type annotations - must be followed by = or :
      // This avoids matching variable assignments like "expire="
      // Only match if it's NOT a built-in type
      /:\s*([A-Z][a-zA-Z0-9_]*)\s*(?:=|,|\)|:)/g, // Type annotations (PascalCase)
      /ForeignKey\(['"]([a-z_][a-z0-9_]*)['"]\)/g, // ForeignKey references (snake_case table names)
      /relationship\(['"]([A-Z][a-zA-Z0-9_]*)['"]\)/g // SQLAlchemy relationships (PascalCase model names)
    ]

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        const ref = match[1]
        // Skip built-in types and common Python types
        if (!this.isBuiltInType(ref)) {
          references.push(ref)
        }
      }
    }

    return Array.from(new Set(references)) // Remove duplicates
  }

  private isBuiltInType(type: string): boolean {
    const builtInTypes = [
      // Basic types
      'str',
      'int',
      'float',
      'bool',
      'bytes',
      // Date/time types
      'datetime',
      'date',
      'time',
      'timedelta',
      // Collection types from typing module
      'List',
      'Dict',
      'Set',
      'Tuple',
      'Optional',
      'Union',
      'Any',
      'Sequence',
      'Mapping',
      'Callable',
      'Iterator',
      'Iterable',
      'Type',
      'TypeVar',
      'Generic',
      'Protocol',
      'ClassVar',
      // Pydantic types
      'BaseModel',
      'Field',
      'EmailStr',
      'HttpUrl',
      'Json',
      'PositiveInt',
      'NegativeInt',
      'NonNegativeInt',
      'NonPositiveInt',
      'PositiveFloat',
      'NegativeFloat',
      'NonNegativeFloat',
      'NonPositiveFloat',
      'StrictStr',
      'StrictInt',
      'StrictFloat',
      'StrictBool',
      'validator',
      'root_validator',
      'field_validator',
      'model_validator',
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
      'String',
      'VARCHAR',
      'CHAR',
      'TEXT',
      'BIGINT',
      'SMALLINT',
      'BigInteger',
      'SmallInteger',
      'Numeric',
      'Float',
      'Double',
      'LargeBinary',
      'Binary',
      'Boolean',
      'Boolean',
      'Date',
      'DateTime',
      'Time',
      'Interval',
      'Enum',
      'ARRAY',
      'JSON',
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
      'Decimal',
      'NullType',
      'TypeEngine',
      'TypeDecorator',
      // FastAPI types
      'APIRouter',
      'Depends',
      'HTTPException',
      'status',
      'Request',
      'Response',
      'BackgroundTasks',
      'UploadFile',
      'Form',
      'File',
      'Header',
      'Cookie',
      'Query',
      'Path',
      'Body',
      'Security',
      // Common patterns
      'Session',
      'AsyncSession',
      'create_engine',
      'sessionmaker',
      'declarative_base',
      'Mapped',
      'mapped_column'
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

        for (const [file, models] of Array.from(modelsByFile.entries())) {
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
