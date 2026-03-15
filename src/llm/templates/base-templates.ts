/**
 * Universal Prompt System - Base Templates
 *
 * Language-agnostic prompt templates that use variable substitution
 * for stack-specific code generation.
 */

export const BASE_TEMPLATES = {
  /**
   * Schema extraction prompt
   * Extracts project schema from user description
   */
  schemaExtraction: `
You are a backend architecture expert.
Extract a structured project schema from the description below.
Return ONLY valid JSON. No markdown. No explanation. No preamble.

Description: "{{prompt}}"

IMPORTANT - Relationship Extraction Rules:
1. Identify ALL relationships between entities based on the description
2. For each relationship, determine the correct type:
   - one-to-many: One entity can have many of another
   - many-to-one: Many entities belong to one entity
   - one-to-one: One entity has exactly one of another
   - many-to-many: Entities are related in both directions
3. Include foreign key fields when applicable
4. Ensure bidirectional relationships are properly defined

Complex Relationship Examples:
- Simple one-to-many: "User has many projects" → { "from": "User", "to": "Project", "type": "one-to-many" }
- Simple many-to-one: "Task belongs to a project" → { "from": "Task", "to": "Project", "type": "many-to-one", "foreignKey": "project_id" }
- Simple one-to-one: "User has one profile" → { "from": "User", "to": "Profile", "type": "one-to-one" }
- Simple many-to-many: "User has many roles, roles have many users" → { "from": "User", "to": "Role", "type": "many-to-many" }
- Many-to-many with junction table: "Students enroll in courses" → { "from": "Student", "to": "Course", "type": "many-to-many", "junctionTable": "enrollment" }
- Self-referential: "Employee has a manager (also an Employee)" → { "from": "Employee", "to": "Employee", "type": "many-to-one", "foreignKey": "manager_id" }
- Polymorphic: "Comment can be on Post or Video" → Create separate relationships or use a commentable_type field

Authentication Detection Rules:
- If ANY of these are mentioned: "login", "register", "auth", "authentication", "user", "password", "session", "token", "JWT", "OAuth"
- Include a User entity with these REQUIRED fields:
   * id ({{TYPE_SYSTEM.idType}}, required, indexed, primary key)
   * email ({{TYPE_SYSTEM.emailType}}, required, indexed, unique)
   * password_hash ({{TYPE_SYSTEM.foreignKeyType}}, required)
   * username ({{TYPE_SYSTEM.foreignKeyType}}, optional, indexed, unique)
   * is_active ({{TYPE_SYSTEM.primitiveTypes.boolean}}, optional, default: true)
   * is_verified ({{TYPE_SYSTEM.primitiveTypes.boolean}}, optional, default: false)
   * created_at ({{TYPE_SYSTEM.datetimeType}}, required)
   * updated_at ({{TYPE_SYSTEM.datetimeType}}, required)
- Set authType to "jwt" if JWT tokens mentioned, "oauth2" if OAuth mentioned, otherwise "jwt" as default
- Add "authentication" to features array

Pagination, Search, and Filtering Detection:
- If ANY of these are mentioned: "paginate", "pagination", "page", "limit", "offset", "infinite scroll" → Add "pagination" to features
- If ANY of these are mentioned: "search", "filter", "query", "find", "lookup", "sort", "order" → Add "search" to features
- If ANY of these are mentioned: "advanced search", "complex filter", "multiple filters" → Add "advanced-filtering" to features

Field Type and Constraint Guidelines:
- Use these types: {{TYPE_SYSTEM.primitiveTypes}}
- For email fields: Use type "{{TYPE_SYSTEM.emailType}}"
- For phone numbers: Use type "{{TYPE_SYSTEM.phoneType}}"
- For URLs: Use type "{{TYPE_SYSTEM.urlType}}"
- For monetary values: Use type "{{TYPE_SYSTEM.monetaryType}}"
- For timestamps: Use type "{{TYPE_SYSTEM.datetimeType}}"
- For foreign keys: Use type "{{TYPE_SYSTEM.foreignKeyType}}"
- For required fields: Set required: true
- For unique fields: Set indexed: true and note uniqueness in field name (e.g., "email")
- For searchable fields: Set indexed: true
- For optional fields: Set required: false

Soft Delete Detection:
- If ANY of these are mentioned: "soft delete", "archive", "trash", "recover deleted", "restore"
- Add "deleted_at" field ({{TYPE_SYSTEM.datetimeType}}, optional, indexed) to entities that support soft delete
- Add "soft-delete" to features array

Audit Trail Detection:
- If ANY of these are mentioned: "audit", "track changes", "history", "who modified", "when modified", "version", "audit trail"
- Add these fields to entities that need audit trails:
   * created_at ({{TYPE_SYSTEM.datetimeType}}, required)
   * updated_at ({{TYPE_SYSTEM.datetimeType}}, required)
   * created_by ({{TYPE_SYSTEM.foreignKeyType}}, optional, indexed) - foreign key to User
   * updated_by ({{TYPE_SYSTEM.foreignKeyType}}, optional, indexed) - foreign key to User
- Add "audit-trail" to features array

Entity Validation Rules:
- Entity names must be {{NAMING.entityCase}} (e.g., {{EXAMPLES.entityName}})
- Field names must be {{NAMING.fieldCase}} (e.g., {{EXAMPLES.fieldName}})
- Each entity must have an "id" field ({{TYPE_SYSTEM.idType}}, required, indexed)
- Each entity should have appropriate endpoints: ["list", "get", "create", "update", "delete"]
- Remove endpoints that don't make sense (e.g., don't include "delete" for immutable entities)

Return this exact structure:
{
  "projectName": "{{NAMING.projectCase}}_name",
  "description": "one sentence description",
  "entities": [
    {
      "name": "{{NAMING.entityCase}}Name",
      "fields": [
        { "name": "{{NAMING.fieldCase}}Name", "type": "{{TYPE_SYSTEM.exampleType}}", "required": true, "indexed": false }
      ],
      "endpoints": ["list", "get", "create", "update", "delete"]
    }
  ],
  "features": ["authentication", "pagination", "search", "file-upload", "soft-delete", "audit-trail", "advanced-filtering"],
  "authType": "jwt|none|oauth2",
  "relationships": [
    { "from": "EntityName", "to": "EntityName", "type": "one-to-many|many-to-one|one-to-one|many-to-many", "foreignKey": "optional_field_name", "junctionTable": "optional_junction_table_name" }
  ]
}
  `,

  /**
   * File planning prompt
   * Generates a file plan based on schema
   */
  filePlanning: `
You are a {{FRAMEWORK.name}} expert. Generate a production-ready file plan.
Return ONLY a JSON array. No markdown. No explanation.

Project: "{{prompt}}"
Schema: \${JSON.stringify(schema)}

Framework: {{FRAMEWORK.name}}
Language: {{FRAMEWORK.language}}

Directory Structure Rules:
- Organize files by domain/feature, not just by type
- Create these directories:
{{STRUCTURE.directories}}

Configuration Files Required:
- {{STRUCTURE.packageFile}}: {{DEPENDENCIES.description}}
- {{STRUCTURE.configFiles}}

File Ordering Rules:
- Order files by dependency (dependencies first):
{{STRUCTURE.fileOrdering}}

Additional Files Based on Features:
{{FEATURES.fileTemplates}}

Return:
[
  { "path": "{{EXAMPLES.filePath}}", "description": "{{EXAMPLES.fileDescription}}" }
]
  `,

  /**
   * File generation prompt
   * Generates individual file content
   */
  fileGeneration: `
You are a senior backend engineer generating production-ready files.

Strict requirements:
- Return only raw file content for {{filePath}}
- No markdown fences, no explanations
- Preserve architectural consistency with provided schema and relationships
- Include complete imports and deterministic, executable code
- For {{FRAMEWORK.language}}: use {{FRAMEWORK.framework}} best practices
- Add robust error handling, clear exceptions, and practical logging
- Keep code concise but complete; avoid placeholders or TODOs
- If context files are provided, integrate with them and avoid duplicate/conflicting definitions
- Ensure all code is syntactically correct and can be executed without errors

{{FILE_SPECIFIC_INSTRUCTIONS}}

Quality checklist:
- Keep architecture consistent with schema and relationships
- Use complete imports and executable code
- Preserve compatibility with existing files
- Add practical validation, error handling, and logging
- For API/service/model files, provide production-ready implementations
- For docs/config/tests, keep concise and accurate

Return only the final file content.
  `
}
