/**
 * Universal Prompt System - Stack Configuration Types
 *
 * This module defines TypeScript interfaces for stack configurations,
 * which describe language and framework-specific patterns for code generation.
 */

/**
 * Defines how types are represented in a programming language
 */
export interface TypeSystem {
  /** Primitive types (string, int, bool, etc.) */
  primitiveTypes: Record<string, string>
  /** Collection types (arrays, maps, sets, etc.) */
  collectionTypes: Record<string, string>
  /** Special types with language-specific representations */
  specialTypes: {
    id: string
    email: string
    phone: string
    url: string
    monetary: string
    datetime: string
    foreignKey: string
  }
}

/**
 * Naming conventions for entities, fields, and files
 */
export interface NamingConventions {
  /** Case style for entity/class names */
  entityCase: 'PascalCase' | 'camelCase' | 'snake_case' | 'UPPER_CASE'
  /** Case style for field/property names */
  fieldCase: 'PascalCase' | 'camelCase' | 'snake_case' | 'UPPER_CASE'
  /** Case style for file names */
  fileCase: 'PascalCase' | 'camelCase' | 'snake_case' | 'kebab-case'
}

/**
 * Directory structure and file organization
 */
export interface StackStructure {
  /** Required directories */
  directories: string[]
  /** File extensions for source code */
  fileExtensions: string[]
  /** Package/dependency file name */
  packageFile: string
  /** Configuration files required */
  configFiles: string[]
}

/**
 * Package dependency definition
 */
export interface PackageDefinition {
  /** Package name */
  name: string
  /** Specific version (if pinned) */
  version?: string
  /** Version range (if not pinned) */
  versionRange?: string
  /** Description of package purpose */
  description: string
  /** Whether package is required for basic functionality */
  required: boolean
  /** Package category for organization */
  category: 'core' | 'database' | 'security' | 'validation' | 'testing' | 'utility'
}

/**
 * Dependency management configuration
 */
export interface Dependencies {
  /** Package manager (npm, pip, go get, cargo, maven) */
  packageManager: string
  /** Dependency file name */
  dependencyFile: string
  /** Core packages always required */
  corePackages: PackageDefinition[]
  /** Optional packages by feature */
  optionalPackages: Record<string, PackageDefinition[]>
}

/**
 * Import statement pattern
 */
export interface ImportPattern {
  /** Template for import statements with {{IMPORTS}} placeholder */
  template: string
  /** Description of when to use this pattern */
  description: string
  /** Examples of import statements */
  examples: Record<string, string>
}

/**
 * Model/entity code pattern
 */
export interface ModelPattern {
  /** Template for entire model class */
  template: string
  /** Template for individual field definitions */
  fieldsTemplate: string
  /** Template for relationship definitions */
  relationshipsTemplate: string
  /** Complete example implementation */
  example: string
}

/**
 * Schema/DTO code pattern
 */
export interface SchemaPattern {
  /** Template for schema class */
  template: string
  /** Template for field definitions */
  fieldsTemplate: string
  /** Complete example implementation */
  example: string
}

/**
 * Service/business logic pattern
 */
export interface ServicePattern {
  /** Template for service class */
  template: string
  /** Template for CRUD operations */
  crudTemplate: string
  /** Complete example implementation */
  example: string
}

/**
 * Controller/router pattern
 */
export interface ControllerPattern {
  /** Template for controller class */
  template: string
  /** Template for endpoint definitions */
  endpointTemplate: string
  /** Complete example implementation */
  example: string
}

/**
 * Configuration file pattern
 */
export interface ConfigPattern {
  /** Template for config file */
  template: string
  /** Template for environment variable loading */
  envTemplate: string
  /** Complete example implementation */
  example: string
}

/**
 * Database connection and migration pattern
 */
export interface DatabasePattern {
  /** Template for database configuration */
  template: string
  /** Template for connection setup */
  connectionTemplate: string
  /** Template for session management */
  sessionTemplate: string
  /** Template for migration files */
  migrationTemplate: string
  /** Complete example implementation */
  example: string
}

/**
 * Security/authentication pattern
 */
export interface SecurityPattern {
  /** Template for password hashing */
  passwordHashTemplate: string
  /** Template for JWT token handling */
  jwtTemplate: string
  /** Template for authentication middleware */
  middlewareTemplate: string
  /** Complete example implementation */
  example: string
}

/**
 * Code patterns organized by type
 */
export interface CodePatterns {
  /** Import statement patterns */
  imports: ImportPattern[]
  /** Model/entity patterns */
  models: ModelPattern
  /** Schema/DTO patterns */
  schemas: SchemaPattern
  /** Service patterns */
  services: ServicePattern
  /** Controller/router patterns */
  controllers: ControllerPattern
  /** Configuration patterns */
  config: ConfigPattern
  /** Database patterns */
  database: DatabasePattern
  /** Security patterns */
  security: SecurityPattern
}

/**
 * Error pattern for validation
 */
export interface ErrorPattern {
  /** Regex to match error message */
  regex: string
  /** Error category */
  category: string
  /** Strategy for fixing the error */
  fixStrategy: string
}

/**
 * Validation configuration
 */
export interface ValidationConfig {
  /** Linter tool name */
  linter: string
  /** Command to run linter */
  linterCommand: string
  /** Error patterns to recognize and fix */
  errorPatterns: ErrorPattern[]
}

/**
 * Testing configuration
 */
export interface TestingConfig {
  /** Testing framework name */
  framework: string
  /** Directory for test files */
  testDirectory: string
  /** Pattern for test file names */
  testFilePattern: string
}

/**
 * File staging rule for generation order
 */
export interface FileStagingRule {
  /** Stage number (0-9, lower numbers generated first) */
  stage: number
  /** Path patterns to match (glob patterns) */
  patterns: string[]
  /** Description of what this stage contains */
  description: string
}

/**
 * Token budget configuration for file generation
 */
export interface TokenBudget {
  /** Maximum tokens to generate for this file type */
  maxTokens: number
  /** Context window size for this file type */
  contextWindow: number
}

/**
 * Complete stack configuration
 *
 * Defines all language and framework-specific patterns for code generation
 */
export interface StackConfig {
  /** Unique identifier for this stack (e.g., 'python-fastapi') */
  id: string
  /** Human-readable name (e.g., 'FastAPI') */
  name: string
  /** Programming language (e.g., 'Python', 'TypeScript') */
  language: string
  /** Framework name (e.g., 'FastAPI', 'NestJS') */
  framework: string
  /** Description of this stack */
  description: string

  /** Type system definitions */
  typeSystem: TypeSystem

  /** Naming conventions */
  naming: NamingConventions

  /** Directory and file structure */
  structure: StackStructure

  /** Dependency management */
  dependencies: Dependencies

  /** Code patterns for different file types */
  patterns: CodePatterns

  /** Validation configuration */
  validation: ValidationConfig

  /** Testing configuration */
  testing: TestingConfig

  /** File staging rules for generation order */
  fileStaging: FileStagingRule[]

  /** Token budgets by file type */
  tokenBudgets: Record<string, TokenBudget>
}

/**
 * Stack context passed to template engine
 */
export interface StackContext {
  /** Stack configuration */
  stack: StackConfig
  /** Additional context variables */
  variables: Record<string, any>
}
