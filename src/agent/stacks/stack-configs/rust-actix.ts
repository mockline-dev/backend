/**
 * Universal Prompt System - Rust/Actix Stack Configuration
 *
 * Stack configuration for Rust with Actix Web framework.
 */

import type { StackConfig } from '../stack-config.types'

export const rustActixStack: StackConfig = {
  id: 'rust-actix',
  name: 'Actix',
  language: 'Rust',
  framework: 'Actix',
  description: 'Powerful, pragmatic, extremely fast web framework for Rust',

  typeSystem: {
    primitiveTypes: {
      string: 'String',
      number: 'i32',
      float: 'f64',
      boolean: 'bool',
      date: 'chrono::DateTime<chrono::Utc>',
      object: 'serde_json::Value'
    },
    collectionTypes: {
      array: 'Vec<T>',
      map: 'HashMap<K, V>',
      set: 'HashSet<T>'
    },
    specialTypes: {
      id: 'String',
      email: 'String',
      phone: 'String',
      url: 'String',
      monetary: 'f64',
      datetime: 'chrono::DateTime<chrono::Utc>',
      foreignKey: 'String'
    }
  },

  naming: {
    entityCase: 'PascalCase',
    fieldCase: 'camelCase',
    fileCase: 'snake_case'
  },

  structure: {
    directories: [
      'src/',
      'src/models/',
      'src/handlers/',
      'src/services/',
      'src/config/',
      'src/db/',
      'tests/'
    ],
    fileExtensions: ['.rs'],
    packageFile: 'Cargo.toml',
    configFiles: ['.env.example', 'config.toml']
  },

  dependencies: {
    packageManager: 'cargo',
    dependencyFile: 'Cargo.toml',
    corePackages: [
      {
        name: 'actix-web',
        version: '4.4.0',
        description: 'Actix web framework',
        required: true,
        category: 'core'
      },
      {
        name: 'tokio',
        version: '1.35.0',
        description: 'Async runtime',
        required: true,
        category: 'core'
      },
      {
        name: 'serde',
        version: '1.0.193',
        description: 'Serialization framework',
        required: true,
        category: 'core'
      },
      {
        name: 'serde_json',
        version: '1.0.108',
        description: 'JSON serialization',
        required: true,
        category: 'core'
      },
      {
        name: 'sqlx',
        version: '0.7.3',
        description: 'SQL toolkit',
        required: true,
        category: 'database'
      },
      {
        name: 'chrono',
        version: '0.4.31',
        description: 'Date and time library',
        required: true,
        category: 'core'
      },
      {
        name: 'uuid',
        version: '1.6.1',
        description: 'UUID generation',
        required: true,
        category: 'core'
      },
      {
        name: 'dotenv',
        version: '0.15.0',
        description: 'Environment variable loading',
        required: true,
        category: 'core'
      }
    ],
    optionalPackages: {
      database: [
        {
          name: 'sqlx-postgres',
          version: '0.7.3',
          description: 'PostgreSQL driver for SQLx',
          required: false,
          category: 'database'
        },
        {
          name: 'sqlx-mysql',
          version: '0.7.3',
          description: 'MySQL driver for SQLx',
          required: false,
          category: 'database'
        },
        {
          name: 'sqlx-sqlite',
          version: '0.7.3',
          description: 'SQLite driver for SQLx',
          required: false,
          category: 'database'
        }
      ],
      security: [
        {
          name: 'jsonwebtoken',
          version: '9.2.0',
          description: 'JWT implementation',
          required: false,
          category: 'security'
        },
        {
          name: 'bcrypt',
          version: '0.15.0',
          description: 'Password hashing',
          required: false,
          category: 'security'
        }
      ],
      validation: [
        {
          name: 'validator',
          version: '0.16.1',
          description: 'Struct validation',
          required: false,
          category: 'validation'
        }
      ]
    }
  },

  patterns: {
    imports: [
      {
        template: 'use {{IMPORTS}};',
        description: 'Rust use statement',
        examples: {
          controller: 'use actix_web::{web, HttpResponse, Responder};',
          model: 'use serde::{Serialize, Deserialize};',
          service: 'use sqlx::PgPool;'
        }
      }
    ],
    models: {
      template: `use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, {{MODEL_TRAITS}})]
pub struct {{ENTITY_NAME}} {
    pub id: String,
{{FIELDS}}

{{RELATIONSHIPS}}
}`,
      fieldsTemplate: `    pub {{FIELD_NAME}}: {{FIELD_TYPE}},`,
      relationshipsTemplate: `    pub {{RELATIONSHIP_NAME}}: Vec<{{RELATED_ENTITY}}>,`,
      example: `use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub created_at: chrono::DateTime<chrono::Utc>,

    pub posts: Vec<Post>,
}`
    },
    schemas: {
      template: `use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct {{SCHEMA_NAME}} {
{{FIELDS}}
}`,
      fieldsTemplate: `    #[serde(rename = "{{JSON_TAG}}")]
    pub {{FIELD_NAME}}: {{FIELD_TYPE}},`,
      example: `use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateUserRequest {
    #[serde(rename = "email")]
    pub email: String,

    #[serde(rename = "password")]
    pub password: String,
}`
    },
    services: {
      template: `use sqlx::PgPool;

pub struct {{SERVICE_NAME}} {
    pool: PgPool,
}

impl {{SERVICE_NAME}} {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

{{CRUD_METHODS}}
}`,
      crudTemplate: `    pub async fn create(&self, {{ENTITY_NAME_LOWER}}: {{ENTITY_NAME}}) -> Result<{{ENTITY_NAME}}, sqlx::Error> {
        let result = sqlx::query_as!(
            "INSERT INTO {{TABLE_NAME}} ({{COLUMNS}}) VALUES ($1, $2) RETURNING *",
            {{ENTITY_NAME}}
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }

    pub async fn get_by_id(&self, id: &str) -> Result<Option<{{ENTITY_NAME}}>, sqlx::Error> {
        let result = sqlx::query_as!(
            "SELECT * FROM {{TABLE_NAME}} WHERE id = $1",
            {{ENTITY_NAME}}
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }

    pub async fn get_all(&self) -> Result<Vec<{{ENTITY_NAME}}>, sqlx::Error> {
        let results = sqlx::query_as!(
            "SELECT * FROM {{TABLE_NAME}}",
            {{ENTITY_NAME}}
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(results)
    }

    pub async fn update(&self, id: &str, {{ENTITY_NAME_LOWER}}: {{ENTITY_NAME}}) -> Result<{{ENTITY_NAME}}, sqlx::Error> {
        let result = sqlx::query_as!(
            "UPDATE {{TABLE_NAME}} SET {{UPDATES}} WHERE id = $1 RETURNING *",
            {{ENTITY_NAME}}
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }

    pub async fn delete(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query!("DELETE FROM {{TABLE_NAME}} WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }`,
      example: `use sqlx::PgPool;

pub struct UserService {
    pool: PgPool,
}

impl UserService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create(&self, user: User) -> Result<User, sqlx::Error> {
        let result = sqlx::query_as!(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *",
            User
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }

    pub async fn get_by_id(&self, id: &str) -> Result<Option<User>, sqlx::Error> {
        let result = sqlx::query_as!(
            "SELECT * FROM users WHERE id = $1",
            User
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }`
    },
    controllers: {
      template: `use actix_web::{web, HttpResponse, Responder};
use crate::services::{{SERVICE_NAME}};

pub async fn list_{{RESOURCE_NAME_LOWER}}(
    service: web::Data<{{SERVICE_NAME}}>
) -> impl Responder {
    match service.get_all().await {
        Ok(items) => HttpResponse::Ok().json(items),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

pub async fn get_{{RESOURCE_NAME_LOWER}}(
    path: web::Path<String>,
    service: web::Data<{{SERVICE_NAME}}>
) -> impl Responder {
    match service.get_by_id(&path).await {
        Ok(Some(item)) => HttpResponse::Ok().json(item),
        Ok(None) => HttpResponse::NotFound().json("{{RESOURCE_NAME}} not found"),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

pub async fn create_{{RESOURCE_NAME_LOWER}}(
    {{SCHEMA_NAME_LOWER}}: web::Json<{{SCHEMA_NAME}}>,
    service: web::Data<{{SERVICE_NAME}}>
) -> impl Responder {
    match service.create({{SCHEMA_NAME_LOWER}}.into_inner()).await {
        Ok(item) => HttpResponse::Created().json(item),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

pub fn configure_{{RESOURCE_NAME}}(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::resource("/{{ROUTE_PREFIX}}")
            .route(web::get().to(list_{{RESOURCE_NAME_LOWER}}))
            .route(web::get("/{id}").to(get_{{RESOURCE_NAME_LOWER}}))
            .route(web::post().to(create_{{RESOURCE_NAME_LOWER}}))
    );
}`,
      endpointTemplate: `pub async fn {{METHOD_NAME}}(
    {{PARAMS}}
) -> impl Responder {
    // Implementation
}`,
      example: `use actix_web::{web, HttpResponse, Responder};
use crate::services::UserService;

pub async fn list_users(
    service: web::Data<UserService>
) -> impl Responder {
    match service.get_all().await {
        Ok(users) => HttpResponse::Ok().json(users),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

pub async fn get_user(
    path: web::Path<String>,
    service: web::Data<UserService>
) -> impl Responder {
    match service.get_by_id(&path).await {
        Ok(Some(user)) => HttpResponse::Ok().json(user),
        Ok(None) => HttpResponse::NotFound().json("User not found"),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}`
    },
    config: {
      template: `use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
{{CONFIG_FIELDS}}
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        dotenv::dotenv().ok();
        Ok(Self {
{{FIELD_ASSIGNMENTS}}
        })
    }
}`,
      envTemplate: `    #[serde(default = "{{DEFAULT_VALUE}}")]
    pub {{FIELD_NAME}}: {{FIELD_TYPE}},`,
      example: `use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    #[serde(default = "postgres://localhost/myapp")]
    pub database_url: String,

    #[serde(default = "secret")]
    pub secret_key: String,
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        dotenv::dotenv().ok();
        Ok(Self {
            database_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/myapp".to_string()),
            secret_key: std::env::var("SECRET_KEY").unwrap_or_else(|_| "secret".to_string()),
        })
    }
}`
    },
    database: {
      template: `use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
}

pub type DbPool = PgPool;`,
      connectionTemplate: `use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn init_db(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
}`,
      sessionTemplate: `pub fn get_pool() -> &'static DbPool {
    &POOL
}`,
      migrationTemplate: `use sqlx::migrate::Migrator;

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    Migrator::new(std::path::Path::new("./migrations"))
        .run(pool)
        .await
}`,
      example: `use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
}`
    },
    security: {
      passwordHashTemplate: `use bcrypt::{hash, DEFAULT_COST};

pub fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
    hash(password, DEFAULT_COST)
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, bcrypt::BcryptError> {
    bcrypt::verify(password, hash)
}`,
      jwtTemplate: `use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

pub fn generate_token(user_id: &str, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        exp: expiration,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
        Algorithm::HS256,
    )
}

pub fn verify_token(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::new(Algorithm::HS256),
    )?;
    Ok(token_data.claims)
}`,
      middlewareTemplate: `use actix_web::{dev::Payload, Error, FromRequest, HttpRequest};
use jsonwebtoken::decode;
use std::future::{ready, Ready};

pub struct AuthenticatedUser {
    pub user_id: String,
}

impl FromRequest for AuthenticatedUser {
    type Error = Error;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        let auth_header = req.headers().get("Authorization");
        
        match auth_header {
            Some(header) => {
                let token = header.to_str().unwrap_or("").replace("Bearer ", "");
                match verify_token(token, "secret") {
                    Ok(claims) => {
                        let user = AuthenticatedUser {
                            user_id: claims.sub,
                        };
                        ready(Ok(user))
                    }
                    Err(_) => ready(Err(Error::Unauthorized("Invalid token".to_string()))),
                }
            }
            None => ready(Err(Error::Unauthorized("Authorization header required".to_string()))),
        }
    }
}`,
      example: `use bcrypt::{hash, DEFAULT_COST};

pub fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
    hash(password, DEFAULT_COST)
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, bcrypt::BcryptError> {
    bcrypt::verify(password, hash)
}`
    }
  },

  validation: {
    linter: 'clippy',
    linterCommand: 'cargo clippy',
    errorPatterns: [
      {
        regex: 'unused',
        category: 'Unused',
        fixStrategy: 'Remove unused variables or add underscore prefix'
      },
      {
        regex: 'borrow',
        category: 'Borrow checker',
        fixStrategy: 'Fix borrow checker errors by adjusting ownership'
      }
    ]
  },

  testing: {
    framework: 'cargo test',
    testDirectory: 'tests/',
    testFilePattern: '*_test.rs'
  },

  fileStaging: [
    {
      stage: 0,
      patterns: ['Cargo.toml', '.env.example', 'src/config/**'],
      description: 'Configuration files and dependencies'
    },
    {
      stage: 1,
      patterns: ['src/models/**', 'src/entities/**'],
      description: 'Database models'
    },
    {
      stage: 2,
      patterns: ['src/schemas/**', 'src/dto/**'],
      description: 'DTOs and schemas'
    },
    {
      stage: 3,
      patterns: ['src/services/**'],
      description: 'Business logic services'
    },
    {
      stage: 4,
      patterns: ['src/handlers/**', 'src/controllers/**'],
      description: 'API handlers/controllers'
    },
    {
      stage: 5,
      patterns: ['src/main.rs', 'src/lib.rs'],
      description: 'Application entry point'
    },
    {
      stage: 6,
      patterns: ['tests/**', 'docs/**', 'readme.md', 'README.md'],
      description: 'Tests and documentation'
    }
  ],

  tokenBudgets: {
    'src/models/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/entities/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/services/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/handlers/**': { maxTokens: 2600, contextWindow: 10240 },
    'src/controllers/**': { maxTokens: 2600, contextWindow: 10240 },
    'src/schemas/**': { maxTokens: 2600, contextWindow: 10240 },
    'src/dto/**': { maxTokens: 2600, contextWindow: 10240 },
    'Cargo.toml': { maxTokens: 1800, contextWindow: 8192 },
    'readme.md': { maxTokens: 1800, contextWindow: 8192 },
    'README.md': { maxTokens: 1800, contextWindow: 8192 },
    'docs/**': { maxTokens: 1800, contextWindow: 8192 },
    'tests/**': { maxTokens: 2200, contextWindow: 8192 },
    default: { maxTokens: 2400, contextWindow: 8192 }
  }
}
