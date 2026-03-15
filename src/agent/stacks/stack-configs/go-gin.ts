/**
 * Universal Prompt System - Go/Gin Stack Configuration
 *
 * Stack configuration for Go with Gin framework.
 */

import type { StackConfig } from '../stack-config.types'

export const goGinStack: StackConfig = {
  id: 'go-gin',
  name: 'Gin',
  language: 'Go',
  framework: 'Gin',
  description: 'High-performance HTTP web framework written in Go',

  typeSystem: {
    primitiveTypes: {
      string: 'string',
      number: 'int',
      float: 'float64',
      boolean: 'bool',
      date: 'time.Time',
      object: 'interface{}'
    },
    collectionTypes: {
      array: '[]T',
      map: 'map[K]V',
      set: 'map[T]bool'
    },
    specialTypes: {
      id: 'string',
      email: 'string',
      phone: 'string',
      url: 'string',
      monetary: 'float64',
      datetime: 'time.Time',
      foreignKey: 'string'
    }
  },

  naming: {
    entityCase: 'PascalCase',
    fieldCase: 'PascalCase',
    fileCase: 'snake_case'
  },

  structure: {
    directories: [
      'cmd/',
      'internal/',
      'internal/api/',
      'internal/models/',
      'internal/services/',
      'internal/config/',
      'internal/database/',
      'pkg/',
      'tests/'
    ],
    fileExtensions: ['.go'],
    packageFile: 'go.mod',
    configFiles: ['.env.example', 'config.yaml']
  },

  dependencies: {
    packageManager: 'go get',
    dependencyFile: 'go.mod',
    corePackages: [
      {
        name: 'github.com/gin-gonic/gin',
        version: 'v1.9.1',
        description: 'Gin HTTP web framework',
        required: true,
        category: 'core'
      },
      {
        name: 'gorm.io/gorm',
        version: 'v1.25.5',
        description: 'GORM ORM library',
        required: true,
        category: 'database'
      },
      {
        name: 'gorm.io/driver/postgres',
        version: 'v1.5.4',
        description: 'PostgreSQL driver for GORM',
        required: true,
        category: 'database'
      },
      {
        name: 'github.com/joho/godotenv',
        version: 'v1.5.1',
        description: 'Load environment variables from .env',
        required: true,
        category: 'core'
      },
      {
        name: 'golang.org/x/crypto/bcrypt',
        version: 'latest',
        description: 'Password hashing',
        required: true,
        category: 'security'
      },
      {
        name: 'github.com/golang-jwt/jwt/v5',
        version: 'v5.0.0',
        description: 'JWT implementation',
        required: true,
        category: 'security'
      }
    ],
    optionalPackages: {
      database: [
        {
          name: 'gorm.io/driver/mysql',
          version: 'v1.5.2',
          description: 'MySQL driver for GORM',
          required: false,
          category: 'database'
        },
        {
          name: 'gorm.io/driver/sqlite',
          version: 'v1.5.4',
          description: 'SQLite driver for GORM',
          required: false,
          category: 'database'
        }
      ],
      validation: [
        {
          name: 'github.com/go-playground/validator/v10',
          version: 'v10.14.0',
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
        template: 'import (\n\t{{IMPORTS}}\n)',
        description: 'Go import statement',
        examples: {
          controller: 'import (\n\t"github.com/gin-gonic/gin"\n\t"myapp/services"\n)',
          model: 'import (\n\t"gorm.io/gorm"\n\t"time"\n)',
          service: 'import (\n\t"myapp/models"\n\t"myapp/database"\n)'
        }
      }
    ],
    models: {
      template: `package models

import (
	"time"
	"gorm.io/gorm"
)

type {{ENTITY_NAME}} struct {
	ID        string \`gorm:"primaryKey"\`
	CreatedAt time.Time
	UpdatedAt time.Time
{{FIELDS}}

{{RELATIONSHIPS}}
}`,
      fieldsTemplate: `	{{FIELD_NAME}} {{FIELD_TYPE}} {{FIELD_TAGS}}`,
      relationshipsTemplate: `	{{RELATIONSHIP_NAME}} []{{RELATED_ENTITY}} \`gorm:"foreignKey:{{FOREIGN_KEY}}"\``,
      example: `package models

import (
	"time"
	"gorm.io/gorm"
)

type User struct {
	ID        string \`gorm:"primaryKey"\`
	Email     string \`gorm:"uniqueIndex;not null"\`
	PasswordHash string \`gorm:"not null"\`
	CreatedAt time.Time
	UpdatedAt time.Time

	Posts []Post \`gorm:"foreignKey:AuthorID"\`
}`
    },
    schemas: {
      template: `type {{SCHEMA_NAME}} struct {
{{FIELDS}}
}`,
      fieldsTemplate: `	{{FIELD_NAME}} {{FIELD_TYPE}} \`json:"{{JSON_TAG}}" validate:"{{VALIDATION_TAG}}"\``,
      example: `type CreateUserRequest struct {
	Email    string \`json:"email" validate:"required,email"\`
	Password string \`json:"password" validate:"required,min=8"\`
}`
    },
    services: {
      template: `package services

import (
	"myapp/models"
	"myapp/database"
)

type {{SERVICE_NAME}} struct {
	db *gorm.DB
}

func New{{SERVICE_NAME}}(db *gorm.DB) *{{SERVICE_NAME}} {
	return &{{SERVICE_NAME}}{db: db}
}

{{CRUD_METHODS}}`,
      crudTemplate: `func (s *{{SERVICE_NAME}}) Create({{ENTITY_NAME_LOWER}} *{{ENTITY_NAME}}) (*{{ENTITY_NAME}}, error) {
	if err := s.db.Create({{ENTITY_NAME_LOWER}}).Error; err != nil {
		return nil, err
	}
	return {{ENTITY_NAME_LOWER}}, nil
}

func (s *{{SERVICE_NAME}}) GetByID(id string) (*{{ENTITY_NAME}}, error) {
	var {{ENTITY_NAME_LOWER}} {{ENTITY_NAME}}
	if err := s.db.First(&{{ENTITY_NAME_LOWER}}, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &{{ENTITY_NAME_LOWER}}, nil
}

func (s *{{SERVICE_NAME}}) GetAll() ([]{{ENTITY_NAME}}, error) {
	var {{ENTITY_NAME_LOWER}} []{{ENTITY_NAME}}
	if err := s.db.Find(&{{ENTITY_NAME_LOWER}}).Error; err != nil {
		return nil, err
	}
	return {{ENTITY_NAME_LOWER}}, nil
}

func (s *{{SERVICE_NAME}}) Update(id string, {{ENTITY_NAME_LOWER}} *{{ENTITY_NAME}}) (*{{ENTITY_NAME}}, error) {
	var existing {{ENTITY_NAME}}
	if err := s.db.First(&existing, "id = ?", id).Error; err != nil {
		return nil, err
	}
	if err := s.db.Model(&existing).Updates({{ENTITY_NAME_LOWER}}).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

func (s *{{SERVICE_NAME}}) Delete(id string) error {
	return s.db.Delete(&{{ENTITY_NAME}}{}, "id = ?", id).Error
}`,
      example: `package services

import (
	"myapp/models"
	"myapp/database"
)

type UserService struct {
	db *gorm.DB
}

func NewUserService(db *gorm.DB) *UserService {
	return &UserService{db: db}
}

func (s *UserService) Create(user *User) (*User, error) {
	if err := s.db.Create(user).Error; err != nil {
		return nil, err
	}
	return user, nil
}

func (s *UserService) GetByID(id string) (*User, error) {
	var user User
	if err := s.db.First(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}`
    },
    controllers: {
      template: `package controllers

import (
	"net/http"
	"github.com/gin-gonic/gin"
	"myapp/services"
)

func {{CONTROLLER_NAME}}Routes(router *gin.Engine, service *{{SERVICE_NAME}}) {
	router.GET("{{ROUTE_PREFIX}}", List{{RESOURCE_NAME}}(service))
	router.GET("{{ROUTE_PREFIX}}/:id", Get{{RESOURCE_NAME}}(service))
	router.POST("{{ROUTE_PREFIX}}", Create{{RESOURCE_NAME}}(service))
	router.PUT("{{ROUTE_PREFIX}}/:id", Update{{RESOURCE_NAME}}(service))
	router.DELETE("{{ROUTE_PREFIX}}/:id", Delete{{RESOURCE_NAME}}(service))
}

func List{{RESOURCE_NAME}}(service *{{SERVICE_NAME}}) gin.HandlerFunc {
	return func(c *gin.Context) {
		items := service.GetAll()
		c.JSON(http.StatusOK, items)
	}
}

func Get{{RESOURCE_NAME}}(service *{{SERVICE_NAME}}) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		item, err := service.GetByID(id)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "{{RESOURCE_NAME}} not found"})
			return
		}
		c.JSON(http.StatusOK, item)
	}
}

func Create{{RESOURCE_NAME}}(service *{{SERVICE_NAME}}) gin.HandlerFunc {
	return func(c *gin.Context) {
		var {{SCHEMA_NAME}} {{SCHEMA_NAME}}
		if err := c.ShouldBindJSON(&{{SCHEMA_NAME}}); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		item, err := service.Create(&{{SCHEMA_NAME}})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, item)
	}
}

func Update{{RESOURCE_NAME}}(service *{{SERVICE_NAME}}) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var {{SCHEMA_NAME}} {{SCHEMA_NAME}}
		if err := c.ShouldBindJSON(&{{SCHEMA_NAME}}); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		item, err := service.Update(id, &{{SCHEMA_NAME}})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, item)
	}
}

func Delete{{RESOURCE_NAME}}(service *{{SERVICE_NAME}}) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := service.Delete(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
	}
}`,
      endpointTemplate: `@router.{{HTTP_METHOD}}("{{ROUTE}}")
func {{METHOD_NAME}}(service *{{SERVICE_NAME}}) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Implementation
	}
}`,
      example: `package controllers

import (
	"net/http"
	"github.com/gin-gonic/gin"
	"myapp/services"
)

func UserRoutes(router *gin.Engine, service *UserService) {
	router.GET("/users", ListUsers(service))
	router.GET("/users/:id", GetUser(service))
	router.POST("/users", CreateUser(service))
}

func ListUsers(service *UserService) gin.HandlerFunc {
	return func(c *gin.Context) {
		users := service.GetAll()
		c.JSON(http.StatusOK, users)
	}
}

func GetUser(service *UserService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		user, err := service.GetByID(id)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
		c.JSON(http.StatusOK, user)
	}
}`
    },
    config: {
      template: `package config

import (
	"os"
	"github.com/joho/godotenv"
)

type Config struct {
{{CONFIG_FIELDS}}
}

func LoadConfig() (*Config, error) {
	godotenv.Load()
	return &Config{
{{FIELD_ASSIGNMENTS}}
	}, nil
}`,
      envTemplate: `	{{FIELD_NAME}}: os.Getenv("{{ENV_VAR_NAME}}")`,
      example: `package config

import (
	"os"
	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL string
	SecretKey  string
}

func LoadConfig() (*Config, error) {
	godotenv.Load()
	return &Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		SecretKey:  os.Getenv("SECRET_KEY"),
	}, nil
}`
    },
    database: {
      template: `package database

import (
	"gorm.io/gorm"
	"gorm.io/driver/postgres"
	"myapp/config"
)

var DB *gorm.DB

func InitDB(cfg *config.Config) error {
	var err error
	DB, err = gorm.Open(postgres.Open(cfg.DatabaseURL))
	if err != nil {
		return err
	}
	return nil
}

func GetDB() *gorm.DB {
	return DB
}`,
      connectionTemplate: `import (
	"gorm.io/gorm"
	"gorm.io/driver/postgres"
)

func InitDB(databaseURL string) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(databaseURL))
}`,
      sessionTemplate: `func GetDB() *gorm.DB {
	return DB
}`,
      migrationTemplate: `package migrations

import (
	"gorm.io/gorm"
)

type {{MIGRATION_NAME}} struct{}

func (m *{{MIGRATION_NAME}}) Up(db *gorm.DB) error {
	// Migration up logic
	return nil
}

func (m *{{MIGRATION_NAME}}) Down(db *gorm.DB) error {
	// Migration down logic
	return nil
}`,
      example: `package database

import (
	"gorm.io/gorm"
	"gorm.io/driver/postgres"
	"myapp/config"
)

var DB *gorm.DB

func InitDB(cfg *config.Config) error {
	var err error
	DB, err = gorm.Open(postgres.Open(cfg.DatabaseURL))
	if err != nil {
		return err
	}
	return nil
}

func GetDB() *gorm.DB {
	return DB
}`
    },
    security: {
      passwordHashTemplate: `package security

import (
	"golang.org/x/crypto/bcrypt"
)

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}`,
      jwtTemplate: `package security

import (
	"time"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID string \`json:"user_id"\`
	jwt.RegisteredClaims
}

func GenerateToken(userID string, secret string) (string, error) {
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: time.Now().Add(24 * time.Hour).Unix(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func VerifyToken(tokenString, secret string) (*jwt.Token, error) {
	return jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
}`,
      middlewareTemplate: `package middleware

import (
	"net/http"
	"strings"
	"github.com/gin-gonic/gin"
	"myapp/security"
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		token, err := security.VerifyToken(tokenString, "secret")
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		c.Set("user", token)
		c.Next()
	}
}`,
      example: `package security

import (
	"golang.org/x/crypto/bcrypt"
)

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}`
    }
  },

  validation: {
    linter: 'golangci-lint',
    linterCommand: 'golangci-lint run',
    errorPatterns: [
      {
        regex: 'undefined:',
        category: 'Undefined',
        fixStrategy: 'Add missing import or check for typos in variable names'
      },
      {
        regex: 'syntax error',
        category: 'Syntax',
        fixStrategy: 'Fix syntax errors (missing braces, semicolons, etc.)'
      }
    ]
  },

  testing: {
    framework: 'go test',
    testDirectory: 'tests/',
    testFilePattern: '*_test.go'
  },

  fileStaging: [
    {
      stage: 0,
      patterns: ['go.mod', 'go.sum', '.env.example', 'config/**', 'internal/config/**'],
      description: 'Configuration files and dependencies'
    },
    {
      stage: 1,
      patterns: ['internal/models/**', 'models/**'],
      description: 'Database models'
    },
    {
      stage: 2,
      patterns: ['internal/dto/**', 'dto/**'],
      description: 'DTOs and schemas'
    },
    {
      stage: 3,
      patterns: ['internal/services/**', 'services/**'],
      description: 'Business logic services'
    },
    {
      stage: 4,
      patterns: ['internal/handlers/**', 'handlers/**', 'internal/controllers/**', 'controllers/**'],
      description: 'API handlers/controllers'
    },
    {
      stage: 5,
      patterns: ['cmd/server/main.go', 'main.go'],
      description: 'Application entry point'
    },
    {
      stage: 6,
      patterns: ['tests/**', 'docs/**', 'readme.md', 'README.md'],
      description: 'Tests and documentation'
    }
  ],

  tokenBudgets: {
    'internal/models/**': { maxTokens: 3200, contextWindow: 12288 },
    'models/**': { maxTokens: 3200, contextWindow: 12288 },
    'internal/services/**': { maxTokens: 3200, contextWindow: 12288 },
    'services/**': { maxTokens: 3200, contextWindow: 12288 },
    'internal/handlers/**': { maxTokens: 2600, contextWindow: 10240 },
    'handlers/**': { maxTokens: 2600, contextWindow: 10240 },
    'internal/controllers/**': { maxTokens: 2600, contextWindow: 10240 },
    'controllers/**': { maxTokens: 2600, contextWindow: 10240 },
    'internal/dto/**': { maxTokens: 2600, contextWindow: 10240 },
    'dto/**': { maxTokens: 2600, contextWindow: 10240 },
    'go.mod': { maxTokens: 1800, contextWindow: 8192 },
    'readme.md': { maxTokens: 1800, contextWindow: 8192 },
    'README.md': { maxTokens: 1800, contextWindow: 8192 },
    'docs/**': { maxTokens: 1800, contextWindow: 8192 },
    'tests/**': { maxTokens: 2200, contextWindow: 8192 },
    default: { maxTokens: 2400, contextWindow: 8192 }
  }
}
