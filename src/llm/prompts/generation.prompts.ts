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

  generateFile: (
    prompt: string,
    schema: any,
    file: { path: string; description: string },
    context: { path: string; content: string }[],
    existingFiles?: { path: string; content: string }[],
    memoryBlock?: string,
    relationships?: any[]
  ): string => `
Generate the complete content of: ${file.path}
Purpose: ${file.description}

Project context: "${prompt}"
Schema: ${JSON.stringify(schema, null, 2)}
${memoryBlock ? `\n${memoryBlock}\n` : ''}
${
  relationships && relationships.length > 0
    ? `Relationships (use these for proper foreign key implementation):\n${JSON.stringify(relationships, null, 2)}\n\n`
    : ''
}
${
  existingFiles && existingFiles.length > 0
    ? `Existing project files (already in the codebase — do NOT duplicate, only extend/modify):\n${existingFiles.map(c => `=== ${c.path} ===\n${c.content}`).join('\n\n')}`
    : ''
}

${
  context.length > 0
    ? `Previously generated files (this session):\n${context.map(c => `=== ${c.path} ===\n${c.content}`).join('\n\n')}`
    : ''
}

=== COMPREHENSIVE GENERATION RULES ===

GENERAL RULES:
- Output ONLY the raw file content
- NO markdown code fences
- NO explanation text before or after the code
- Write complete, production-ready code
- Include all imports
- Add docstrings to all functions and classes
- If existing files are provided, ensure this file integrates with them correctly

=== ERROR HANDLING GUIDELINES ===
- Always wrap database operations in try-except blocks
- Use specific exception types (SQLAlchemyError, IntegrityError, etc.)
- Raise HTTPException with appropriate status codes:
   * 400: Bad Request (validation errors, invalid input)
   * 401: Unauthorized (authentication required)
   * 403: Forbidden (insufficient permissions)
   * 404: Not Found (resource doesn't exist)
   * 409: Conflict (duplicate entries, constraint violations)
   * 422: Unprocessable Entity (validation errors)
   * 500: Internal Server Error (unexpected errors)
- Log errors with appropriate severity (ERROR, WARNING, INFO)
- Never expose sensitive information in error messages (passwords, tokens, etc.)
- Provide clear, actionable error messages to clients

=== LOGGING IMPLEMENTATION ===
- Import logging module: import logging
- Create logger: logger = logging.getLogger(__name__)
- Use appropriate log levels:
   * DEBUG: Detailed diagnostic information
   * INFO: General informational messages
   * WARNING: Something unexpected but not an error
   * ERROR: Serious problem occurred
   * CRITICAL: Critical condition
- Log important operations (database queries, API calls, errors)
- Include context in log messages (user IDs, request IDs)
- Use structured logging when possible

=== PYDANTIC VALIDATION ===
- Use Pydantic v2 (from pydantic import BaseModel, Field, EmailStr, validator)
- Define separate schemas for:
   * Create operations (input without id, created_at, etc.)
   * Update operations (all fields optional)
   * Response operations (include all fields)
   * List operations (minimal fields for performance)
- Use Field() for constraints:
   * Field(..., min_length=1, max_length=100)
   * Field(..., ge=0, le=100)  # greater/equal, less/equal
   * Field(..., pattern=r'^[a-z]+$')
- Use EmailStr for email fields (requires email-validator package)
- Use field_validator for custom validation (Pydantic v2)
- Add example values to fields for API documentation

=== EXCEPTION HANDLING ===
- Import HTTPException from fastapi
- Create custom exception classes for domain-specific errors
- Use dependency injection for common error handling
- Implement exception handlers in main.py:
   * @app.exception_handler(IntegrityError)
   * @app.exception_handler(HTTPException)
- Return consistent error response format:
   { "detail": "Error message", "error_code": "VALIDATION_ERROR", "field": "email" }

=== PAGINATION IMPLEMENTATION ===
- Create pagination utility with:
   * page: int = 1 (default to 1)
   * page_size: int = 10 (default to 10, max 100)
   * Calculate offset: offset = (page - 1) * page_size
- Use SQLAlchemy's limit() and offset() methods
- Return paginated response with metadata:
   {
     "items": [...],
     "total": 150,
     "page": 1,
     "page_size": 10,
     "pages": 15,
     "has_next": true,
     "has_prev": false
   }
- Add pagination to list endpoints
- Validate page and page_size parameters

=== SEARCH AND FILTERING ===
- Implement search using SQLAlchemy's ilike() for case-insensitive search
- Support multiple search fields with OR logic
- Implement filtering using exact matches or ranges:
   * Filter by field: ?field=value
   * Filter by range: ?min_price=10&max_price=100
   * Filter by date: ?start_date=2024-01-01&end_date=2024-12-31
- Support sorting: ?sort_by=created_at&order=desc
- Use dynamic filtering with **kwargs
- Validate filter parameters

=== RELATIONSHIPS IMPLEMENTATION ===
- IMPORTANT: Use the relationships to properly implement foreign keys and relationships:
   * For many-to-one: Add foreign key field (e.g., user_id, project_id)
   * For one-to-many: Add relationship field (e.g., SQLAlchemy relationship)
   * For one-to-one: Add foreign key with unique constraint
   * For many-to-many: Add association table
- Ensure all foreign key fields referenced in relationships exist in the model
- Use SQLAlchemy relationships with lazy loading options:
   * lazy="select" (default, load when accessed)
   * lazy="joined" (load via JOIN)
   * lazy="subquery" (load via subquery)
- Use back_populates for bidirectional relationships
- Handle cascade operations (cascade="all, delete-orphan")
- Use foreign key constraints with proper indexes

=== AUTHENTICATION AND AUTHORIZATION ===
- If authType is "jwt", implement JWT authentication:
   * Create security.py with password hashing (bcrypt)
   * Create token creation and verification functions
   * Create OAuth2PasswordBearer for token extraction
   * Create get_current_user dependency
   * Create get_current_active_user dependency
- Protect endpoints with @Depends(get_current_user)
- Implement role-based access control if needed
- Use password hashing with passlib and bcrypt
- Store only password_hash, never plain passwords
- Implement password validation (length, complexity)
- Use Pydantic EmailStr for email validation

=== CRUD OPERATIONS ===
- Use proper HTTP methods:
   * GET: Retrieve resources (list, get by id)
   * POST: Create new resources
   * PUT: Update entire resource (all fields required)
   * PATCH: Partial update (fields optional)
   * DELETE: Remove resources
- Implement idempotent operations where possible
- Return appropriate status codes:
   * 200: OK (GET, PUT, PATCH, DELETE)
   * 201: Created (POST)
   * 204: No Content (DELETE)
- Use async/await for database operations
- Use database sessions with proper context management

=== RESPONSE SCHEMAS ===
- Create separate Pydantic models for:
   * Request bodies (CreateSchema, UpdateSchema)
   * Response bodies (ResponseSchema, ListResponseSchema)
   * Include all necessary fields in responses
   * Exclude sensitive fields (password_hash, tokens)
- Use nested schemas for relationships
- Add computed fields with @computed_field (Pydantic v2)
- Add example values for API documentation
- Use Config class for model configuration

=== DATABASE TRANSACTIONS ===
- Use database sessions with proper transaction management
- Implement commit/rollback patterns:
   try:
       # database operations
       db.commit()
   except Exception as e:
       db.rollback()
       raise
- Use context managers for sessions
- Implement optimistic locking for concurrent updates
- Use database constraints for data integrity

=== INDEXING ===
- Add indexes to frequently queried fields
- Add indexes to foreign key fields
- Add indexes to fields used in WHERE, JOIN, ORDER BY clauses
- Add unique indexes for fields that must be unique
- Consider composite indexes for multi-field queries
- Add indexes to fields used in search and filtering

=== CACHING ===
- Consider caching for frequently accessed, rarely changed data
- Use Redis or in-memory caching
- Implement cache invalidation strategies
- Cache expensive database queries
- Cache API responses with appropriate TTL
- Use cache keys that include query parameters

=== RATE LIMITING ===
- Implement rate limiting to prevent abuse
- Use token bucket or sliding window algorithm
- Set appropriate limits per endpoint:
   * Public endpoints: 100 requests/minute
   * Authenticated endpoints: 1000 requests/minute
   * Write operations: Lower limits
- Return rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining)
- Use Redis for distributed rate limiting

=== CORS IMPLEMENTATION ===
- Configure CORS middleware in main.py:
   from fastapi.middleware.cors import CORSMiddleware
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["http://localhost:3000"],  # Frontend URL
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],
   )
- Use specific origins in production, not "*"
- Allow only necessary methods and headers

=== API DOCUMENTATION ===
- FastAPI automatically generates OpenAPI/Swagger docs
- Add detailed docstrings to endpoints
- Add descriptions to parameters and request bodies
- Add example values to Pydantic models
- Add tags to endpoints for grouping
- Add summary and description to route decorators
- Use @app.post(..., summary="Create user", description="Creates a new user account")
- Add response models to route decorators
- Add status code descriptions

=== HEALTH CHECK ENDPOINTS ===
- Implement health check endpoint at /health
- Check database connectivity
- Check external service dependencies
- Return JSON response with status:
   {
     "status": "healthy",
     "database": "connected",
     "timestamp": "2024-01-01T00:00:00Z"
   }
- Use appropriate HTTP status codes (200 for healthy, 503 for unhealthy)

=== ENVIRONMENT VARIABLE HANDLING ===
- Use Pydantic Settings for configuration:
   from pydantic_settings import BaseSettings
   class Settings(BaseSettings):
       DATABASE_URL: str
       SECRET_KEY: str
       class Config:
           env_file = ".env"
- Load environment variables from .env file
- Provide .env.example with all required variables
- Never commit .env file to version control
- Use sensible defaults for non-sensitive settings
- Validate required environment variables at startup

=== LOGGING LEVELS ===
- Set appropriate logging level based on environment:
   * Development: DEBUG
   * Production: INFO or WARNING
- Configure logging format with timestamps
- Log to console in development
- Log to file in production
- Use structured logging (JSON format) in production
- Include request ID in logs for tracing

=== ERROR RESPONSES ===
- Return consistent error response format:
   {
     "detail": "Error message",
     "error_code": "VALIDATION_ERROR",
     "field": "email",
     "timestamp": "2024-01-01T00:00:00Z"
   }
- Use appropriate HTTP status codes
- Include error codes for programmatic handling
- Provide helpful error messages for debugging
- Log full error details server-side
- Sanitize error messages before sending to clients

=== EMAIL VALIDATION ===
- CRITICAL: If email fields exist, use EmailStr from pydantic
- Ensure email-validator is in requirements.txt
- Example: email: EmailStr = Field(..., description="User email address")
- EmailStr automatically validates email format

=== SOFT DELETE ===
- If "soft-delete" in features, implement soft delete:
   * Add deleted_at field (datetime, nullable)
   * Add index on deleted_at field
   * Filter out soft-deleted records in queries
   * Provide restore endpoint if needed
   * Use cascade soft delete for related records

=== AUDIT TRAIL ===
- If "audit-trail" in features, implement audit trail:
   * Add created_at and updated_at fields
   * Add created_by and updated_by fields (foreign keys to User)
   * Automatically set timestamps on create/update
   * Track who made changes
   * Consider audit log table for full history

Output the complete content of ${file.path} now:`
}
