/**
 * Universal Prompt System - Node.js/NestJS Stack Configuration
 *
 * Stack configuration for TypeScript with NestJS framework.
 */

import type { StackConfig } from '../stack-config.types'

export const nodejsNestJsStack: StackConfig = {
  id: 'typescript-nestjs',
  name: 'NestJS',
  language: 'TypeScript',
  framework: 'NestJS',
  description:
    'A progressive Node.js framework for building efficient, scalable enterprise-grade server-side applications',

  typeSystem: {
    primitiveTypes: {
      string: 'string',
      number: 'number',
      float: 'number',
      boolean: 'boolean',
      date: 'Date',
      object: 'any'
    },
    collectionTypes: {
      array: 'T[]',
      map: 'Map<K, V>',
      set: 'Set<T>'
    },
    specialTypes: {
      id: 'string',
      email: 'string',
      phone: 'string',
      url: 'string',
      monetary: 'number',
      datetime: 'Date',
      foreignKey: 'string'
    }
  },

  naming: {
    entityCase: 'PascalCase',
    fieldCase: 'camelCase',
    fileCase: 'kebab-case'
  },

  structure: {
    directories: ['src/', 'src/modules/', 'src/common/', 'src/config/', 'src/database/', 'tests/', 'docs/'],
    fileExtensions: ['.ts', '.spec.ts'],
    packageFile: 'package.json',
    configFiles: ['.env.example', 'tsconfig.json', 'nest-cli.json']
  },

  dependencies: {
    packageManager: 'npm',
    dependencyFile: 'package.json',
    corePackages: [
      {
        name: '@nestjs/common',
        version: '^10.0.0',
        description: 'NestJS common utilities',
        required: true,
        category: 'core'
      },
      {
        name: '@nestjs/core',
        version: '^10.0.0',
        description: 'NestJS core',
        required: true,
        category: 'core'
      },
      {
        name: '@nestjs/platform-express',
        version: '^10.0.0',
        description: 'Express platform adapter',
        required: true,
        category: 'core'
      },
      {
        name: '@nestjs/typeorm',
        version: '^10.0.0',
        description: 'TypeORM integration',
        required: true,
        category: 'database'
      },
      {
        name: 'typeorm',
        version: '^0.3.0',
        description: 'TypeORM',
        required: true,
        category: 'database'
      },
      {
        name: '@nestjs/config',
        version: '^3.0.0',
        description: 'Configuration module',
        required: true,
        category: 'core'
      },
      {
        name: 'class-validator',
        version: '^0.14.0',
        description: 'Validation decorators',
        required: true,
        category: 'validation'
      },
      {
        name: 'class-transformer',
        version: '^0.5.0',
        description: 'Object transformation',
        required: true,
        category: 'validation'
      },
      {
        name: 'reflect-metadata',
        version: '^0.1.13',
        description: 'Reflection polyfill',
        required: true,
        category: 'core'
      },
      {
        name: 'rxjs',
        version: '^7.8.0',
        description: 'Reactive extensions',
        required: true,
        category: 'core'
      }
    ],
    optionalPackages: {
      authentication: [
        {
          name: '@nestjs/jwt',
          version: '^10.0.0',
          description: 'JWT authentication',
          required: false,
          category: 'security'
        },
        {
          name: '@nestjs/passport',
          version: '^10.0.0',
          description: 'Passport integration',
          required: false,
          category: 'security'
        },
        {
          name: 'passport-jwt',
          version: '^4.0.0',
          description: 'Passport JWT strategy',
          required: false,
          category: 'security'
        },
        {
          name: 'bcrypt',
          version: '^5.1.0',
          description: 'Password hashing',
          required: false,
          category: 'security'
        }
      ],
      database: [
        {
          name: 'pg',
          version: '^8.11.0',
          description: 'PostgreSQL client',
          required: false,
          category: 'database'
        },
        {
          name: 'mysql2',
          version: '^3.6.0',
          description: 'MySQL client',
          required: false,
          category: 'database'
        }
      ],
      utility: [
        {
          name: '@nestjs/platform-multer',
          version: '^10.0.0',
          description: 'Multer file upload',
          required: false,
          category: 'utility'
        }
      ]
    }
  },

  patterns: {
    imports: [
      {
        template: "import { {{IMPORTS}} } from '{{MODULE}}';",
        description: 'ES6 import syntax',
        examples: {
          controller: "import { Controller, Get, Post } from '@nestjs/common';",
          service: "import { Injectable } from '@nestjs/common';",
          model: "import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';"
        }
      }
    ],
    models: {
      template: `import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('{{TABLE_NAME}}')
export class {{ENTITY_NAME}} {
  @PrimaryGeneratedColumn('uuid')
  id: string;

{{FIELDS}}

{{RELATIONSHIPS}}
}`,
      fieldsTemplate: `  @Column({ type: '{{FIELD_TYPE}}'{{FIELD_OPTIONS}} })
  {{FIELD_NAME}}: {{FIELD_TYPE}};`,
      relationshipsTemplate: `  @OneToMany(() => {{RELATED_ENTITY}}, {{RELATED_PROPERTY}} => {{BACK_REFERENCE}})
  {{PROPERTY_NAME}}: {{RELATED_ENTITY}}[];`,
      example: `import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => Post, post => post.author)
  posts: Post[];
}`
    },
    schemas: {
      template: `export class {{SCHEMA_NAME}} {
{{FIELDS}}
}`,
      fieldsTemplate: `  @Is{{VALIDATION_TYPE}}()
  @ApiProperty()
  {{FIELD_NAME}}: {{FIELD_TYPE}};`,
      example: `export class CreateUserDto {
  @IsEmail()
  @ApiProperty()
  email: string;

  @IsString()
  @MinLength(8)
  @ApiProperty()
  password: string;
}`
    },
    services: {
      template: `@Injectable()
export class {{SERVICE_NAME}} {
  constructor(
    @InjectRepository({{ENTITY_NAME}})
    private readonly {{REPOSITORY_NAME}}: Repository<{{ENTITY_NAME}}>
  ) {}

{{CRUD_METHODS}}
}`,
      crudTemplate: `  async create(createDto: Create{{ENTITY_NAME}}Dto): Promise<{{ENTITY_NAME}}> {
    const entity = this.{{REPOSITORY_NAME}}.create(createDto);
    return this.{{REPOSITORY_NAME}}.save(entity);
  }

  async findAll(): Promise<{{ENTITY_NAME}}[]> {
    return this.{{REPOSITORY_NAME}}.find();
  }

  async findOne(id: string): Promise<{{ENTITY_NAME}}> {
    const entity = await this.{{REPOSITORY_NAME}}.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException('{{ENTITY_NAME}} not found');
    }
    return entity;
  }

  async update(id: string, updateDto: Update{{ENTITY_NAME}}Dto): Promise<{{ENTITY_NAME}}> {
    await this.{{REPOSITORY_NAME}}.update(id, updateDto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.{{REPOSITORY_NAME}}.delete(id);
  }`,
      example: `@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.usersRepository.create(createUserDto);
    return this.usersRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }`
    },
    controllers: {
      template: `@Controller('{{ROUTE_PREFIX}}')
export class {{CONTROLLER_NAME}} {
  constructor(private readonly {{SERVICE_NAME}}: {{SERVICE_NAME}}) {}

{{ENDPOINTS}}
}`,
      endpointTemplate: `  @{{HTTP_METHOD}}('{{ROUTE}}')
  @HttpCode(HttpStatus.{{STATUS_CODE}})
  async {{METHOD_NAME}}(@Param('id') id: string{{PARAMS}}): Promise<{{RETURN_TYPE}}> {
    return this.{{SERVICE_NAME}}.{{SERVICE_METHOD}}({{ARGUMENTS}});
  }`,
      example: `@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<User> {
    return this.usersService.findOne(id);
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto): Promise<User> {
    return this.usersService.create(createUserDto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto): Promise<User> {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}`
    },
    config: {
      template: `export default registerAs('{{CONFIG_NAME}}', () => ({
{{CONFIG_FIELDS}}
}));`,
      envTemplate: `  {{FIELD_NAME}}: process.env.{{ENV_VAR_NAME}} || {{DEFAULT_VALUE}},`,
      example: `export default registerAs('database', () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'myapp',
}));`
    },
    database: {
      template: `import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: ['dist/**/*.entity{.ts,.js}'],
  synchronize: false,
};`,
      connectionTemplate: `@Module({
  imports: [
    TypeOrmModule.forRoot(databaseConfig),
    TypeOrmModule.forFeature([{{ENTITIES}}]),
  ],
  providers: [{{PROVIDERS}}],
  controllers: [{{CONTROLLERS}}],
})
export class {{MODULE_NAME}} {}`,
      sessionTemplate: `@Injectable()
export class {{DATABASE_SERVICE_NAME}} {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}
}`,
      migrationTemplate: `import { MigrationInterface, QueryRunner } from 'typeorm';

export class {{MIGRATION_NAME}} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Migration up logic
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Migration down logic
  }
}`,
      example: `import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'myapp',
  entities: ['dist/**/*.entity{.ts,.js}'],
  synchronize: false,
};`
    },
    security: {
      passwordHashTemplate: `import * as bcrypt from 'bcrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt();
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}`,
      jwtTemplate: `import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async generateToken(payload: any): Promise<string> {
    return this.jwtService.sign(payload);
  }

  async verifyToken(token: string): Promise<any> {
    return this.jwtService.verify(token);
  }
}`,
      middlewareTemplate: `import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private authService: AuthService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const decoded = await this.authService.verifyToken(token);
      req['user'] = decoded;
      next();
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}`,
      example: `import * as bcrypt from 'bcrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt();
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}`
    }
  },

  validation: {
    linter: 'eslint',
    linterCommand: 'eslint --ext .ts src/',
    errorPatterns: [
      {
        regex: 'TS\\d+',
        category: 'TypeScript',
        fixStrategy: 'Fix type errors by adding proper type annotations or correcting type usage'
      },
      {
        regex: 'Missing import',
        category: 'Import',
        fixStrategy: 'Add missing import statement at the top of the file'
      }
    ]
  },

  testing: {
    framework: 'jest',
    testDirectory: 'tests/',
    testFilePattern: '*.spec.ts'
  },

  fileStaging: [
    {
      stage: 0,
      patterns: [
        'package.json',
        '.env.example',
        'tsconfig.json',
        'nest-cli.json',
        'src/common/**',
        'src/config/**'
      ],
      description: 'Configuration files and common utilities'
    },
    {
      stage: 1,
      patterns: ['src/modules/**/entities/**', 'src/modules/**/*.entity.ts'],
      description: 'Database entities'
    },
    {
      stage: 2,
      patterns: ['src/modules/**/dto/**', 'src/modules/**/*.dto.ts'],
      description: 'DTOs and schemas'
    },
    {
      stage: 3,
      patterns: ['src/modules/**/services/**', 'src/modules/**/*.service.ts'],
      description: 'Business logic services'
    },
    {
      stage: 4,
      patterns: ['src/modules/**/controllers/**', 'src/modules/**/*.controller.ts'],
      description: 'API controllers'
    },
    {
      stage: 5,
      patterns: ['src/main.ts', 'src/app.module.ts'],
      description: 'Application entry point'
    },
    {
      stage: 6,
      patterns: ['tests/**', 'docs/**', 'readme.md', 'README.md'],
      description: 'Tests and documentation'
    }
  ],

  tokenBudgets: {
    'src/modules/**/entities/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/modules/**/*.entity.ts': { maxTokens: 3200, contextWindow: 12288 },
    'src/modules/**/services/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/modules/**/*.service.ts': { maxTokens: 3200, contextWindow: 12288 },
    'src/modules/**/controllers/**': { maxTokens: 2600, contextWindow: 10240 },
    'src/modules/**/*.controller.ts': { maxTokens: 2600, contextWindow: 10240 },
    'src/modules/**/dto/**': { maxTokens: 2600, contextWindow: 10240 },
    'src/modules/**/*.dto.ts': { maxTokens: 2600, contextWindow: 10240 },
    'package.json': { maxTokens: 1800, contextWindow: 8192 },
    'readme.md': { maxTokens: 1800, contextWindow: 8192 },
    'README.md': { maxTokens: 1800, contextWindow: 8192 },
    'docs/**': { maxTokens: 1800, contextWindow: 8192 },
    'tests/**': { maxTokens: 2200, contextWindow: 8192 },
    default: { maxTokens: 2400, contextWindow: 8192 }
  }
}
