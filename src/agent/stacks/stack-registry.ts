/**
 * Universal Prompt System - Stack Registry
 *
 * Manages available stack configurations and provides lookup functionality.
 * Acts as a central registry for all supported language/framework combinations.
 */

import { logger } from '../../logger'
import type {
  CodePatterns,
  Dependencies,
  NamingConventions,
  PackageDefinition,
  StackConfig,
  StackStructure,
  TestingConfig,
  TypeSystem,
  ValidationConfig
} from './stack-config.types'

/**
 * Registry for managing stack configurations
 */
export class StackRegistry {
  private stacks: Map<string, StackConfig> = new Map()
  private defaultStackId: string = 'python-fastapi'

  /**
   * Register a stack configuration
   * @param stack - Stack configuration to register
   * @throws Error if stack with same ID already exists
   */
  register(stack: StackConfig): void {
    if (this.stacks.has(stack.id)) {
      throw new Error(`Stack with ID '${stack.id}' is already registered`)
    }

    // Validate stack configuration
    this.validateStack(stack)

    this.stacks.set(stack.id, stack)
    logger.info('StackRegistry: registered stack %s (%s %s)', stack.id, stack.language, stack.framework)
  }

  /**
   * Register multiple stacks at once
   * @param stacks - Array of stack configurations
   */
  registerAll(stacks: StackConfig[]): void {
    stacks.forEach(stack => this.register(stack))
  }

  /**
   * Get a stack configuration by ID
   * @param stackId - Stack identifier
   * @returns Stack configuration or undefined if not found
   */
  get(stackId: string): StackConfig | undefined {
    return this.stacks.get(stackId)
  }

  /**
   * Get all registered stacks
   * @returns Array of all stack configurations
   */
  getAll(): StackConfig[] {
    return Array.from(this.stacks.values())
  }

  /**
   * Get stacks by programming language
   * @param language - Programming language name
   * @returns Array of stacks for the specified language
   */
  getByLanguage(language: string): StackConfig[] {
    return this.getAll().filter(stack => stack.language.toLowerCase() === language.toLowerCase())
  }

  /**
   * Get stacks by framework
   * @param framework - Framework name
   * @returns Array of stacks for the specified framework
   */
  getByFramework(framework: string): StackConfig[] {
    return this.getAll().filter(stack => stack.framework.toLowerCase() === framework.toLowerCase())
  }

  /**
   * Search for stacks by query string
   * @param query - Search query (matches against name, language, framework, description)
   * @returns Array of matching stacks
   */
  search(query: string): StackConfig[] {
    const lowerQuery = query.toLowerCase()
    return this.getAll().filter(
      stack =>
        stack.name.toLowerCase().includes(lowerQuery) ||
        stack.language.toLowerCase().includes(lowerQuery) ||
        stack.framework.toLowerCase().includes(lowerQuery) ||
        stack.description.toLowerCase().includes(lowerQuery)
    )
  }

  /**
   * Get the default stack configuration
   * @returns Default stack (Python/FastAPI by default)
   */
  getDefault(): StackConfig {
    const defaultStack = this.stacks.get(this.defaultStackId)
    if (!defaultStack) {
      throw new Error(`Default stack '${this.defaultStackId}' is not registered`)
    }
    return defaultStack
  }

  /**
   * Set the default stack ID
   * @param stackId - Stack ID to set as default
   * @throws Error if stack is not registered
   */
  setDefault(stackId: string): void {
    if (!this.stacks.has(stackId)) {
      throw new Error(`Cannot set default: stack '${stackId}' is not registered`)
    }
    this.defaultStackId = stackId
    logger.info('StackRegistry: default stack set to %s', stackId)
  }

  /**
   * Check if a stack is registered
   * @param stackId - Stack identifier
   * @returns True if stack is registered
   */
  has(stackId: string): boolean {
    return this.stacks.has(stackId)
  }

  /**
   * Get count of registered stacks
   * @returns Number of registered stacks
   */
  count(): number {
    return this.stacks.size
  }

  /**
   * Validate a stack configuration
   * @param stack - Stack configuration to validate
   * @throws Error if validation fails
   */
  private validateStack(stack: StackConfig): void {
    // Validate required fields
    if (!stack.id || typeof stack.id !== 'string') {
      throw new Error('Stack must have a valid id')
    }
    if (!stack.name || typeof stack.name !== 'string') {
      throw new Error('Stack must have a valid name')
    }
    if (!stack.language || typeof stack.language !== 'string') {
      throw new Error('Stack must have a valid language')
    }
    if (!stack.framework || typeof stack.framework !== 'string') {
      throw new Error('Stack must have a valid framework')
    }

    // Validate type system
    this.validateTypeSystem(stack.typeSystem)

    // Validate naming conventions
    this.validateNamingConventions(stack.naming)

    // Validate structure
    this.validateStructure(stack.structure)

    // Validate dependencies
    this.validateDependencies(stack.dependencies)

    // Validate patterns
    this.validatePatterns(stack.patterns)

    // Validate validation config
    this.validateValidationConfig(stack.validation)

    // Validate testing config
    this.validateTestingConfig(stack.testing)
  }

  /**
   * Validate type system configuration
   */
  private validateTypeSystem(typeSystem: TypeSystem): void {
    if (!typeSystem.primitiveTypes || typeof typeSystem.primitiveTypes !== 'object') {
      throw new Error('Type system must have primitiveTypes object')
    }
    if (!typeSystem.collectionTypes || typeof typeSystem.collectionTypes !== 'object') {
      throw new Error('Type system must have collectionTypes object')
    }
    if (!typeSystem.specialTypes || typeof typeSystem.specialTypes !== 'object') {
      throw new Error('Type system must have specialTypes object')
    }

    // Validate required special types
    const requiredSpecialTypes = ['id', 'email', 'phone', 'url', 'monetary', 'datetime', 'foreignKey']
    for (const type of requiredSpecialTypes) {
      if (!typeSystem.specialTypes[type as keyof typeof typeSystem.specialTypes]) {
        throw new Error(`Type system must have specialTypes.${type}`)
      }
    }
  }

  /**
   * Validate naming conventions
   */
  private validateNamingConventions(naming: NamingConventions): void {
    const validCases = ['PascalCase', 'camelCase', 'snake_case', 'UPPER_CASE', 'kebab-case']

    if (!naming.entityCase || !validCases.includes(naming.entityCase)) {
      throw new Error(`Naming must have valid entityCase: ${validCases.join(', ')}`)
    }
    if (!naming.fieldCase || !validCases.includes(naming.fieldCase)) {
      throw new Error(`Naming must have valid fieldCase: ${validCases.join(', ')}`)
    }
    if (!naming.fileCase || !validCases.includes(naming.fileCase)) {
      throw new Error(`Naming must have valid fileCase: ${validCases.join(', ')}`)
    }
  }

  /**
   * Validate structure configuration
   */
  private validateStructure(structure: StackStructure): void {
    if (!Array.isArray(structure.directories) || structure.directories.length === 0) {
      throw new Error('Structure must have non-empty directories array')
    }
    if (!Array.isArray(structure.fileExtensions) || structure.fileExtensions.length === 0) {
      throw new Error('Structure must have non-empty fileExtensions array')
    }
    if (!structure.packageFile || typeof structure.packageFile !== 'string') {
      throw new Error('Structure must have a valid packageFile')
    }
    if (!Array.isArray(structure.configFiles)) {
      throw new Error('Structure must have configFiles array')
    }
  }

  /**
   * Validate dependencies configuration
   */
  private validateDependencies(dependencies: Dependencies): void {
    if (!dependencies.packageManager || typeof dependencies.packageManager !== 'string') {
      throw new Error('Dependencies must have a valid packageManager')
    }
    if (!dependencies.dependencyFile || typeof dependencies.dependencyFile !== 'string') {
      throw new Error('Dependencies must have a valid dependencyFile')
    }
    if (!Array.isArray(dependencies.corePackages)) {
      throw new Error('Dependencies must have corePackages array')
    }
    if (typeof dependencies.optionalPackages !== 'object') {
      throw new Error('Dependencies must have optionalPackages object')
    }

    // Validate package definitions
    dependencies.corePackages.forEach((pkg, index) => {
      this.validatePackageDefinition(pkg, `corePackages[${index}]`)
    })

    Object.entries(dependencies.optionalPackages).forEach(([feature, packages]) => {
      packages.forEach((pkg, index) => {
        this.validatePackageDefinition(pkg, `optionalPackages.${feature}[${index}]`)
      })
    })
  }

  /**
   * Validate a package definition
   */
  private validatePackageDefinition(pkg: PackageDefinition, path: string): void {
    if (!pkg.name || typeof pkg.name !== 'string') {
      throw new Error(`${path} must have a valid name`)
    }
    if (!pkg.description || typeof pkg.description !== 'string') {
      throw new Error(`${path} must have a valid description`)
    }
    if (typeof pkg.required !== 'boolean') {
      throw new Error(`${path} must have a valid required flag`)
    }
    if (!pkg.version && !pkg.versionRange) {
      throw new Error(`${path} must have either version or versionRange`)
    }
    const validCategories = ['core', 'database', 'security', 'validation', 'testing', 'utility']
    if (!validCategories.includes(pkg.category)) {
      throw new Error(`${path} must have valid category: ${validCategories.join(', ')}`)
    }
  }

  /**
   * Validate patterns configuration
   */
  private validatePatterns(patterns: CodePatterns): void {
    if (!Array.isArray(patterns.imports)) {
      throw new Error('Patterns must have imports array')
    }
    if (!patterns.models || typeof patterns.models !== 'object') {
      throw new Error('Patterns must have models object')
    }
    if (!patterns.schemas || typeof patterns.schemas !== 'object') {
      throw new Error('Patterns must have schemas object')
    }
    if (!patterns.services || typeof patterns.services !== 'object') {
      throw new Error('Patterns must have services object')
    }
    if (!patterns.controllers || typeof patterns.controllers !== 'object') {
      throw new Error('Patterns must have controllers object')
    }
    if (!patterns.config || typeof patterns.config !== 'object') {
      throw new Error('Patterns must have config object')
    }
    if (!patterns.database || typeof patterns.database !== 'object') {
      throw new Error('Patterns must have database object')
    }
    if (!patterns.security || typeof patterns.security !== 'object') {
      throw new Error('Patterns must have security object')
    }
  }

  /**
   * Validate validation configuration
   */
  private validateValidationConfig(validation: ValidationConfig): void {
    if (!validation.linter || typeof validation.linter !== 'string') {
      throw new Error('Validation must have a valid linter')
    }
    if (!validation.linterCommand || typeof validation.linterCommand !== 'string') {
      throw new Error('Validation must have a valid linterCommand')
    }
    if (!Array.isArray(validation.errorPatterns)) {
      throw new Error('Validation must have errorPatterns array')
    }
  }

  /**
   * Validate testing configuration
   */
  private validateTestingConfig(testing: TestingConfig): void {
    if (!testing.framework || typeof testing.framework !== 'string') {
      throw new Error('Testing must have a valid framework')
    }
    if (!testing.testDirectory || typeof testing.testDirectory !== 'string') {
      throw new Error('Testing must have a valid testDirectory')
    }
    if (!testing.testFilePattern || typeof testing.testFilePattern !== 'string') {
      throw new Error('Testing must have a valid testFilePattern')
    }
  }
}

/**
 * Create a singleton instance of the stack registry
 */
export function createStackRegistry(): StackRegistry {
  return new StackRegistry()
}
