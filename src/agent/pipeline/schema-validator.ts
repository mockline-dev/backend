import { logger } from '../../logger'
import type { IntentSchema } from './intent-analyzer'

export interface ValidationError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
  relationships: Relationship[]
}

export interface Relationship {
  from: string
  to: string
  type: 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many'
  foreignKey?: string
  bidirectional: boolean
}

export class SchemaValidator {
  /**
   * Validates the schema and extracts relationships with comprehensive checks.
   * This runs after Intent Analysis (Stage 1.5) to ensure the schema is valid
   * before proceeding to task planning and file generation.
   */
  validate(schema: IntentSchema): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []
    const relationships: Relationship[] = []

    logger.debug('SchemaValidator: validating schema with %d entities', schema.entities?.length ?? 0)

    // 1. Validate basic schema structure
    this.validateBasicStructure(schema, errors)

    // 2. Validate entities
    if (schema.entities) {
      for (const entity of schema.entities) {
        this.validateEntity(entity, errors, warnings)
      }
    }

    // 3. Validate and extract relationships
    if (schema.entities) {
      const extractedRelations = this.extractAndValidateRelationships(schema, errors, warnings)
      relationships.push(...extractedRelations)
    }

    // 4. Check for circular dependencies
    this.checkCircularDependencies(relationships, warnings)

    // 5. Validate authentication entities
    if (schema.authType !== 'none') {
      this.validateAuthenticationEntities(schema, errors, warnings)
    }

    // 6. Validate features
    this.validateFeatures(schema, warnings)

    const isValid = errors.length === 0

    if (!isValid) {
      logger.error('SchemaValidator: validation failed with %d errors', errors.length)
      for (const error of errors) {
        logger.error('  - %s: %s', error.field, error.message)
      }
    } else {
      logger.debug('SchemaValidator: validation passed with %d warnings', warnings.length)
      for (const warning of warnings) {
        logger.warn('  - %s: %s', warning.field, warning.message)
      }
    }

    logger.debug('SchemaValidator: extracted %d relationships', relationships.length)

    return { isValid, errors, warnings, relationships }
  }

  private validateBasicStructure(schema: IntentSchema, errors: ValidationError[]): void {
    if (!schema.projectName || typeof schema.projectName !== 'string' || schema.projectName.trim() === '') {
      errors.push({
        field: 'projectName',
        message: 'Project name is required and must be a non-empty string',
        severity: 'error'
      })
    }

    if (!schema.description || typeof schema.description !== 'string' || schema.description.trim() === '') {
      errors.push({
        field: 'description',
        message: 'Description is required and must be a non-empty string',
        severity: 'error'
      })
    }

    if (!Array.isArray(schema.entities) || schema.entities.length === 0) {
      errors.push({
        field: 'entities',
        message: 'At least one entity is required',
        severity: 'error'
      })
    }

    if (!['jwt', 'none', 'oauth2'].includes(schema.authType)) {
      errors.push({
        field: 'authType',
        message: `authType must be one of: jwt, none, oauth2. Got: ${schema.authType}`,
        severity: 'error'
      })
    }
  }

  private validateEntity(entity: any, errors: ValidationError[], warnings: ValidationError[]): void {
    // Validate entity name
    if (!entity.name || typeof entity.name !== 'string' || entity.name.trim() === '') {
      errors.push({
        field: 'entity.name',
        message: 'Entity name is required and must be a non-empty string',
        severity: 'error'
      })
      return
    }

    // Validate PascalCase naming convention
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(entity.name)) {
      warnings.push({
        field: `entity.${entity.name}.name`,
        message: 'Entity name should follow PascalCase convention (e.g., User, Task, Project)',
        severity: 'warning'
      })
    }

    // Validate fields
    if (!Array.isArray(entity.fields) || entity.fields.length === 0) {
      errors.push({
        field: `entity.${entity.name}.fields`,
        message: `Entity ${entity.name} must have at least one field`,
        severity: 'error'
      })
      return
    }

    const fieldNames = new Set<string>()
    for (const field of entity.fields) {
      this.validateField(entity.name, field, fieldNames, errors, warnings)
    }

    // Validate endpoints
    if (!Array.isArray(entity.endpoints) || entity.endpoints.length === 0) {
      warnings.push({
        field: `entity.${entity.name}.endpoints`,
        message: `Entity ${entity.name} should have at least one endpoint`,
        severity: 'warning'
      })
    }
  }

  private validateField(
    entityName: string,
    field: any,
    fieldNames: Set<string>,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    // Validate field name
    if (!field.name || typeof field.name !== 'string' || field.name.trim() === '') {
      errors.push({
        field: `entity.${entityName}.field.name`,
        message: 'Field name is required and must be a non-empty string',
        severity: 'error'
      })
      return
    }

    // Check for duplicate field names
    if (fieldNames.has(field.name)) {
      errors.push({
        field: `entity.${entityName}.field.${field.name}`,
        message: `Duplicate field name: ${field.name}`,
        severity: 'error'
      })
      return
    }
    fieldNames.add(field.name)

    // Validate snake_case naming convention
    if (!/^[a-z][a-z0-9_]*$/.test(field.name)) {
      warnings.push({
        field: `entity.${entityName}.field.${field.name}`,
        message: 'Field name should follow snake_case convention (e.g., user_id, created_at)',
        severity: 'warning'
      })
    }

    // Validate field type
    if (!field.type || typeof field.type !== 'string' || field.type.trim() === '') {
      errors.push({
        field: `entity.${entityName}.field.${field.name}.type`,
        message: `Field ${field.name} must have a valid type`,
        severity: 'error'
      })
    } else {
      const validTypes = [
        'str',
        'int',
        'float',
        'bool',
        'datetime',
        'List[str]',
        'List[int]',
        'List[float]',
        'List[dict]',
        'dict',
        'json'
      ]
      const baseType = field.type.replace(/\[.*\]/, '')
      if (!validTypes.includes(baseType) && !validTypes.includes(field.type)) {
        warnings.push({
          field: `entity.${entityName}.field.${field.name}.type`,
          message: `Field type "${field.type}" may not be supported. Recommended types: ${validTypes.join(', ')}`,
          severity: 'warning'
        })
      }
    }

    // Validate required field - only warn if explicitly set to non-boolean value
    if (field.required !== undefined && typeof field.required !== 'boolean') {
      warnings.push({
        field: `entity.${entityName}.field.${field.name}.required`,
        message: `Field ${field.name} 'required' property should be a boolean (defaults to false if not specified)`,
        severity: 'warning'
      })
    }

    // Validate indexed field - only warn if explicitly set to non-boolean value
    if (field.indexed !== undefined && typeof field.indexed !== 'boolean') {
      warnings.push({
        field: `entity.${entityName}.field.${field.name}.indexed`,
        message: `Field ${field.name} 'indexed' property should be a boolean (defaults to false if not specified)`,
        severity: 'warning'
      })
    }
  }

  private extractAndValidateRelationships(
    schema: IntentSchema,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): Relationship[] {
    const relationships: Relationship[] = []
    const entityNames = new Map<string, string>()

    // Build entity name map (case-insensitive lookup)
    for (const entity of schema.entities) {
      entityNames.set(entity.name.toLowerCase(), entity.name)
    }

    const seen = new Set<string>()

    for (const entity of schema.entities) {
      for (const field of entity.fields) {
        const fieldLower = field.name.toLowerCase()

        for (const [targetLower, targetName] of entityNames) {
          if (targetLower === entity.name.toLowerCase()) continue

          const relationship = this.detectRelationship(
            entity.name,
            targetName,
            field,
            fieldLower,
            targetLower
          )

          if (relationship) {
            const key = `${relationship.from}:${relationship.to}:${relationship.type}`
            if (!seen.has(key)) {
              seen.add(key)
              relationships.push(relationship)

              // Validate that foreign key field exists
              if (relationship.foreignKey) {
                const hasForeignKey = entity.fields.some(f => f.name === relationship.foreignKey)
                if (!hasForeignKey) {
                  errors.push({
                    field: `entity.${entity.name}.fields`,
                    message: `Foreign key field "${relationship.foreignKey}" is missing for relationship ${entity.name} → ${targetName}`,
                    severity: 'error'
                  })
                }
              }
            }
          }
        }
      }
    }

    // Check for missing bidirectional relationships
    this.validateBidirectionalRelationships(relationships, entityNames, warnings)

    return relationships
  }

  private detectRelationship(
    fromEntity: string,
    toEntity: string,
    field: any,
    fieldLower: string,
    targetLower: string
  ): Relationship | null {
    // Direct reference: userId, project_id, etc.
    if (fieldLower === `${targetLower}id` || fieldLower === `${targetLower}_id`) {
      return {
        from: fromEntity,
        to: toEntity,
        type: 'many-to-one',
        foreignKey: field.name,
        bidirectional: false
      }
    }

    // List reference: tasks, projects, etc.
    if (fieldLower === targetLower || fieldLower === `${targetLower}s`) {
      const isList =
        field.type.toLowerCase().includes('list') ||
        field.type.toLowerCase().includes('array') ||
        field.type.toLowerCase().includes('[]')

      return {
        from: fromEntity,
        to: toEntity,
        type: isList ? 'one-to-many' : 'one-to-one',
        bidirectional: false
      }
    }

    // Compound reference: user_id, project_id, etc.
    if (fieldLower.startsWith(`${targetLower}_`)) {
      const isList =
        field.type.toLowerCase().includes('list') ||
        field.type.toLowerCase().includes('array') ||
        field.type.toLowerCase().includes('[]')

      return {
        from: fromEntity,
        to: toEntity,
        type: isList ? 'one-to-many' : 'one-to-one',
        foreignKey: field.name,
        bidirectional: false
      }
    }

    return null
  }

  private validateBidirectionalRelationships(
    relationships: Relationship[],
    entityNames: Map<string, string>,
    warnings: ValidationError[]
  ): void {
    // Create a map of relationships
    const relMap = new Map<string, Relationship[]>()
    for (const rel of relationships) {
      const key = `${rel.from}:${rel.to}`
      if (!relMap.has(key)) {
        relMap.set(key, [])
      }
      relMap.get(key)!.push(rel)
    }

    // Check for bidirectional relationships
    for (const rel of relationships) {
      const reverseKey = `${rel.to}:${rel.from}`
      const reverseRels = relMap.get(reverseKey)

      if (reverseRels && reverseRels.length > 0) {
        rel.bidirectional = true
        reverseRels[0].bidirectional = true

        // Validate that the relationship types are compatible
        const compatible = this.areRelationshipTypesCompatible(rel.type, reverseRels[0].type)
        if (!compatible) {
          warnings.push({
            field: `relationship.${rel.from}.${rel.to}`,
            message: `Bidirectional relationship types may be incompatible: ${rel.from}→${rel.to} (${rel.type}) vs ${rel.to}→${rel.from} (${reverseRels[0].type})`,
            severity: 'warning'
          })
        }
      }
    }
  }

  private areRelationshipTypesCompatible(type1: string, type2: string): boolean {
    const compatiblePairs = [
      ['one-to-many', 'many-to-one'],
      ['many-to-one', 'one-to-many'],
      ['one-to-one', 'one-to-one'],
      ['many-to-many', 'many-to-many']
    ]

    return compatiblePairs.some(
      ([t1, t2]) => (type1 === t1 && type2 === t2) || (type1 === t2 && type2 === t1)
    )
  }

  private checkCircularDependencies(relationships: Relationship[], warnings: ValidationError[]): void {
    // Build adjacency list
    const graph = new Map<string, Set<string>>()
    for (const rel of relationships) {
      if (!graph.has(rel.from)) {
        graph.set(rel.from, new Set())
      }
      graph.get(rel.from)!.add(rel.to)
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
          // Found a cycle
          const cycleStart = path.indexOf(neighbor)
          const cyclePath = [...path.slice(cycleStart), neighbor].join(' → ')
          warnings.push({
            field: 'relationships',
            message: `Circular dependency detected: ${cyclePath}`,
            severity: 'warning'
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

  private validateAuthenticationEntities(
    schema: IntentSchema,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    // Check if User entity exists
    const userEntity = schema.entities?.find(e => e.name.toLowerCase() === 'user')

    if (!userEntity) {
      warnings.push({
        field: 'entities',
        message: 'No User entity found, but authentication is enabled. Consider adding a User entity.',
        severity: 'warning'
      })
      return
    }

    // Validate User entity has required authentication fields
    const requiredFields = ['id', 'email', 'password_hash']
    const fieldNames = new Set(userEntity.fields.map(f => f.name.toLowerCase()))

    for (const requiredField of requiredFields) {
      if (!fieldNames.has(requiredField)) {
        errors.push({
          field: `entity.User.fields`,
          message: `User entity is missing required authentication field: ${requiredField}`,
          severity: 'error'
        })
      }
    }

    // Check for common authentication fields
    const recommendedFields = ['username', 'created_at', 'updated_at']
    for (const recommendedField of recommendedFields) {
      if (!fieldNames.has(recommendedField)) {
        warnings.push({
          field: `entity.User.fields`,
          message: `User entity is missing recommended field: ${recommendedField}`,
          severity: 'warning'
        })
      }
    }
  }

  private validateFeatures(schema: IntentSchema, warnings: ValidationError[]): void {
    if (!Array.isArray(schema.features)) {
      warnings.push({
        field: 'features',
        message: 'Features should be an array of strings',
        severity: 'warning'
      })
      return
    }

    const validFeatures = [
      'authentication',
      'authorization',
      'pagination',
      'search',
      'file-upload',
      'caching',
      'rate-limiting',
      'logging',
      'monitoring',
      'testing',
      'documentation',
      'audit-trail',
      'soft-delete',
      'advanced-filtering'
    ]

    for (const feature of schema.features) {
      if (typeof feature !== 'string') {
        warnings.push({
          field: 'features',
          message: `Feature "${feature}" should be a string`,
          severity: 'warning'
        })
      } else if (!validFeatures.includes(feature)) {
        warnings.push({
          field: 'features',
          message: `Unknown feature: "${feature}". Valid features: ${validFeatures.join(', ')}`,
          severity: 'warning'
        })
      }
    }
  }
}
