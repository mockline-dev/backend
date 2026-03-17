export const buildGenerationPrompts = {
  extractSchema: (prompt: string): string => `
You are a backend architecture expert.
Extract a structured project schema from the description below.
Return ONLY valid JSON. No markdown. No explanation. No preamble.

Description: "${prompt}"

IMPORTANT - Relationship Extraction Rules:
1. Identify ALL relationships between entities based on the description
2. For each relationship, determine the correct type:
   - one-to-many: One entity can have many of another (e.g., User → Projects)
   - many-to-one: Many entities belong to one entity (e.g., Task → Project)
   - one-to-one: One entity has exactly one of another (e.g., User → Profile)
   - many-to-many: Entities are related in both directions (e.g., User ↔ Roles)
3. Include foreign key fields when applicable (e.g., "user_id", "project_id")
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
   * id (str, required, indexed, primary key)
   * email (str, required, indexed, unique)
   * password_hash (str, required)
   * username (str, optional, indexed, unique)
   * is_active (bool, optional, default: true)
   * is_verified (bool, optional, default: false)
   * created_at (datetime, required)
   * updated_at (datetime, required)
- Set authType to "jwt" if JWT tokens mentioned, "oauth2" if OAuth mentioned, otherwise "jwt" as default
- Add "authentication" to features array

Pagination, Search, and Filtering Detection:
- If ANY of these are mentioned: "paginate", "pagination", "page", "limit", "offset", "infinite scroll" → Add "pagination" to features
- If ANY of these are mentioned: "search", "filter", "query", "find", "lookup", "sort", "order" → Add "search" to features
- If ANY of these are mentioned: "advanced search", "complex filter", "multiple filters" → Add "advanced-filtering" to features

Field Type and Constraint Guidelines:
- Use these types: "str", "int", "float", "bool", "datetime", "List[str]", "List[int]", "List[float]", "dict", "json"
- For email fields: Use type "str" and set indexed: true
- For phone numbers: Use type "str" (not int)
- For URLs: Use type "str"
- For monetary values: Use type "float" or "int" (cents)
- For status fields: Use type "str" with common values (e.g., "active", "inactive", "pending")
- For timestamps: Use type "datetime"
- For foreign keys: Use type "str" with indexed: true
- For required fields: Set required: true
- For unique fields: Set indexed: true and note uniqueness in field name (e.g., "email")
- For searchable fields: Set indexed: true
- For optional fields: Set required: false

Soft Delete Detection:
- If ANY of these are mentioned: "soft delete", "archive", "trash", "recover deleted", "restore"
- Add "deleted_at" field (datetime, optional, indexed) to entities that support soft delete
- Add "soft-delete" to features array

Audit Trail Detection:
- If ANY of these are mentioned: "audit", "track changes", "history", "who modified", "when modified", "version"
- Add these fields to entities that need audit trails:
   * created_at (datetime, required)
   * updated_at (datetime, required)
   * created_by (str, optional, indexed) - foreign key to User
   * updated_by (str, optional, indexed) - foreign key to User
- Add "audit-trail" to features array

Entity Validation Rules:
- Entity names must be PascalCase (e.g., User, UserProfile, OrderItem)
- Field names must be snake_case (e.g., user_id, created_at, first_name)
- Each entity must have an "id" field (str, required, indexed)
- Each entity should have appropriate endpoints: ["list", "get", "create", "update", "delete"]
- Remove endpoints that don't make sense (e.g., don't include "delete" for immutable entities)

Return this exact structure:
{
  "projectName": "snake_case_name",
  "description": "one sentence description",
  "entities": [
    {
      "name": "PascalCaseName",
      "fields": [
        { "name": "fieldName", "type": "str|int|float|bool|datetime|List[str]", "required": true, "indexed": false }
      ],
      "endpoints": ["list", "get", "create", "update", "delete"]
    }
  ],
  "features": ["authentication", "pagination", "search", "file-upload", "soft-delete", "audit-trail", "advanced-filtering"],
  "authType": "jwt|none|oauth2",
  "relationships": [
    { "from": "EntityName", "to": "EntityName", "type": "one-to-many|many-to-one|one-to-one|many-to-many", "foreignKey": "optional_field_name", "junctionTable": "optional_junction_table_name" }
  ]
}`,

  filePlan: (prompt: string, schema: any): string => `
You are a FastAPI expert. Generate a production-ready file plan.
Return ONLY a JSON array. No markdown. No explanation.

Project: "${prompt}"
Schema: ${JSON.stringify(schema)}

CRITICAL - Email Validation Requirement:
- If ANY entity has an email field (type: "str", name contains "email"), you MUST include "email-validator" in requirements.txt
- Email validation is required for all email fields using Pydantic's EmailStr type

Dependency Management Rules:
- Use specific version pinning for critical dependencies (e.g., "fastapi==0.104.1")
- Use compatible version ranges for less critical dependencies (e.g., "pydantic>=2.0.0,<3.0.0")
- Always include these core dependencies:
   * fastapi (with specific version)
   * uvicorn[standard] (ASGI server)
   * sqlalchemy (if using SQL database)
   * pydantic (for validation)
   * pydantic-settings (for environment variables)
   * python-jose[cryptography] (for JWT if authType is jwt)
   * passlib[bcrypt] (for password hashing if authType is jwt)
   * python-multipart (for file uploads if file-upload in features)
   * alembic (for database migrations)
   * email-validator (if email fields detected)
- Include database driver:
   * psycopg2-binary (for PostgreSQL)
   * pymysql (for MySQL)
   * oracledb (for Oracle)
   * None (for SQLite - built-in)
- Include additional dependencies based on features:
   * "pagination" in features: No extra deps needed
   * "search" in features: No extra deps needed
   * "file-upload" in features: python-multipart, aiofiles
   * "soft-delete" in features: No extra deps needed
   * "audit-trail" in features: No extra deps needed

Directory Structure Rules:
- Organize files by domain/feature, not just by type
- Create these directories:
   * app/ (main application package)
   * app/core/ (core functionality: config, security, database)
   * app/models/ (SQLAlchemy models)
   * app/schemas/ (Pydantic schemas for request/response)
   * app/api/ (API routers, organized by entity)
   * app/services/ (business logic, organized by entity)
   * app/utils/ (utility functions, helpers)
   * tests/ (test files)
   * alembic/ (database migrations)
   * alembic/versions/ (migration scripts)
- For each entity, create:
   * app/models/{entity_name_lower}.py (SQLAlchemy model)
   * app/schemas/{entity_name_lower}.py (Pydantic schemas)
   * app/api/{entity_name_lower}.py (FastAPI router)
   * app/services/{entity_name_lower}.py (business logic)

Configuration Files Required:
- requirements.txt: All Python dependencies with version pinning
- .env.example: Template for environment variables with comments
- README.md: Project documentation with setup instructions
- app/core/config.py: Configuration management using Pydantic Settings
- app/core/security.py: Security utilities (password hashing, JWT tokens)
- app/core/database.py: Database connection and session management
- alembic.ini: Alembic configuration for database migrations
- app/__init__.py: App package initialization

Testing Structure:
- tests/__init__.py: Test package initialization
- tests/conftest.py: Pytest fixtures and configuration
- tests/test_api/: API endpoint tests (one file per entity)
- tests/test_services/: Service layer tests (one file per entity)
- tests/test_models/: Model tests (one file per entity)
- tests/test_core/: Core functionality tests (config, security, database)

Documentation Requirements:
- README.md must include:
   * Project description
   * Features list
   * Installation instructions
   * Environment variables documentation
   * Running the application
   * API endpoints overview
   * Testing instructions
- Consider adding:
   * docs/api.md: Detailed API documentation
   * docs/architecture.md: System architecture overview
   * docs/deployment.md: Deployment guide

File Ordering Rules:
- Order files by dependency (dependencies first):
  1. Configuration files (requirements.txt, .env.example)
  2. Core files (app/core/config.py, app/core/security.py, app/core/database.py)
  3. Models (app/models/*.py)
  4. Schemas (app/schemas/*.py)
  5. Services (app/services/*.py)
  6. API routers (app/api/*.py)
  7. Main application (app/__init__.py, main.py)
  8. Migration files (alembic.ini, alembic/env.py)
  9. Test files (tests/conftest.py, tests/*.py)
  10. Documentation (README.md, docs/*.md)

Additional Files Based on Features:
- If "authentication" in features:
   * app/api/auth.py (authentication endpoints)
   * app/schemas/token.py (JWT token schemas)
   * app/core/deps.py (dependency injection for auth)
- If "file-upload" in features:
   * app/utils/file_handler.py (file upload utilities)
   * app/api/files.py (file upload endpoints)
- If "pagination" in features:
   * app/utils/pagination.py (pagination utilities)
- If "search" in features:
   * app/utils/search.py (search utilities)
- If "soft-delete" in features:
   * app/utils/soft_delete.py (soft delete utilities)
- If "audit-trail" in features:
   * app/utils/audit.py (audit trail utilities)

Return:
[
  { "path": "requirements.txt", "description": "Python dependencies with version pinning" },
  { "path": ".env.example", "description": "Environment variables template" },
  { "path": "app/core/config.py", "description": "Configuration management using Pydantic Settings" },
  { "path": "app/core/security.py", "description": "Security utilities (password hashing, JWT)" },
  { "path": "app/core/database.py", "description": "Database connection and session management" },
  { "path": "app/models/{entity}.py", "description": "SQLAlchemy model for {entity}" },
  { "path": "app/schemas/{entity}.py", "description": "Pydantic schemas for {entity}" },
  { "path": "app/services/{entity}.py", "description": "Business logic for {entity}" },
  { "path": "app/api/{entity}.py", "description": "FastAPI router for {entity}" },
  { "path": "main.py", "description": "FastAPI application entry point" },
  { "path": "README.md", "description": "Project documentation" }
]`,

  generateFileSystemPrompt: (filePath: string): string => `
You are a senior backend engineer generating production-ready files.

Strict requirements:
- Return only raw file content for ${'${filePath}'}.
- No markdown fences, no explanations.
- Preserve architectural consistency with provided schema and relationships.
- Include complete imports and deterministic, executable code.
- For Python: use Pydantic v2 and FastAPI best practices.
- Add robust error handling, clear exceptions, and practical logging.
- Keep code concise but complete; avoid placeholders or TODOs.
- If context files are provided, integrate with them and avoid duplicate/conflicting definitions.

CRITICAL - Python Class Naming Rule:
- Python filenames are snake_case (e.g. shopping_cart.py, order_item.py).
- Python CLASS names in those files MUST be PascalCase matching the entity schema name exactly.
- The conversion rule: remove underscores and capitalize each word segment.
  ✓ shopping_cart.py   → class ShoppingCart(Base)     NOT class Shopping_cart
  ✓ order_item.py      → class OrderItem(Base)         NOT class Order_item
  ✓ user_profile.py    → class UserProfile(Base)       NOT class User_profile
- This rule applies to SQLAlchemy models, Pydantic schemas, service classes, and all other classes.
- Schema Pydantic classes follow the same pattern: ShoppingCartBase, ShoppingCartCreate, ShoppingCartUpdate, ShoppingCartResponse.

CRITICAL - Python Import Guidelines:
- Standard library imports (typing, datetime, os, sys, etc.) are NOT file references - they are Python built-in modules
- Third-party imports (fastapi, pydantic, sqlalchemy, etc.) are NOT file references - they are installed packages
- Type annotations like List, Dict, Optional, EmailStr, Session are from typing/pydantic, NOT files
- Only project-local imports (app.models.*, app.services.*, app.schemas.*) reference actual project files
- NEVER treat import statements as file references - imports are module names, not file paths
- Examples:
  ✓ from typing import List, Optional  (Correct - standard library)
  ✓ from pydantic import BaseModel, EmailStr  (Correct - third-party package)
  ✓ from app.models.user import User  (Correct - project file)
  ✗ from List import ...  (WRONG - List is a type, not a module)
  ✗ from EmailStr import ...  (WRONG - EmailStr is a type from pydantic, not a file)
`,

  generateFileUserPrompt: (
    prompt: string,
    schema: any,
    file: { path: string; description: string },
    context: { path: string; content: string }[],
    existingFiles?: { path: string; content: string }[],
    memoryBlock?: string,
    relationships?: any[],
    contextBlock?: string,
    projectManifest?: string
  ): string => `
Generate the complete content for file: ${file.path}
Purpose: ${file.description}

Project prompt:
${prompt}

${
  projectManifest
    ? `${projectManifest}

`
    : ''
}Schema JSON:
${JSON.stringify(schema)}

${memoryBlock ? `Memory context:\n${memoryBlock}\n` : ''}
${relationships && relationships.length > 0 ? `Relationships JSON:\n${JSON.stringify(relationships)}\n` : ''}
${
  existingFiles && existingFiles.length > 0
    ? `Existing files:\n${existingFiles.map(c => `=== ${c.path} ===\n${c.content}`).join('\n\n')}\n`
    : ''
}
${
  context.length > 0
    ? `Dependency files:\n${context.map(c => `=== ${c.path} ===\n${c.content}`).join('\n\n')}\n`
    : ''
}
${contextBlock ? `Context Block:\n${contextBlock}\n` : ''}

CRITICAL - Python Import Guidelines:
- Standard library imports (typing, datetime, os, sys, etc.) are NOT file references
- Third-party imports (fastapi, pydantic, sqlalchemy, etc.) are NOT file references
- Type annotations like List, Dict, Optional, EmailStr, Session are from typing/pydantic, NOT files
- Only project-local imports (app.models.*, app.services.*, app.schemas.*) reference actual project files
- NEVER treat import statements as file references - imports are module names, not file paths
- Common imports you should use:
  * from typing import List, Optional, Dict, Any
  * from datetime import datetime, date, time, timedelta
  * from pydantic import BaseModel, Field, EmailStr, validator
  * from fastapi import APIRouter, Depends, HTTPException, status
  * from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, relationship
  * from sqlalchemy.orm import Session, declarative_base
${
  projectManifest
    ? `
IMPORT CONSISTENCY RULE:
- When importing from any project file listed in the PROJECT FILE MANIFEST above, use ONLY the
  exact names shown in its [exports] annotation.
- If a file has no [exports] annotation, it has no public API conventions yet — use standard patterns.
- This is MANDATORY. Inventing class or function names not in the manifest will break the project.`
    : ''
}

Quality checklist:
- Keep architecture consistent with schema and relationships.
- Use complete imports and executable code.
- Preserve compatibility with existing files.
- Add practical validation, error handling, and logging.
- For API/service/model files, provide production-ready implementations.
- For docs/config/tests, keep concise and accurate.

Return only the final file content.`
}
