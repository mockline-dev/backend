/**
 * Universal Prompt System - Java/Spring Boot Stack Configuration
 *
 * Stack configuration for Java with Spring Boot framework.
 */

import type { StackConfig } from '../stack-config.types'

export const javaSpringBootStack: StackConfig = {
  id: 'java-springboot',
  name: 'Spring Boot',
  language: 'Java',
  framework: 'Spring Boot',
  description: 'Create stand-alone, production-grade Spring based Applications',

  typeSystem: {
    primitiveTypes: {
      string: 'String',
      number: 'Integer',
      float: 'Double',
      boolean: 'Boolean',
      date: 'LocalDateTime',
      object: 'Object'
    },
    collectionTypes: {
      array: 'List<T>',
      map: 'Map<K, V>',
      set: 'Set<T>'
    },
    specialTypes: {
      id: 'String',
      email: 'String',
      phone: 'String',
      url: 'String',
      monetary: 'Double',
      datetime: 'LocalDateTime',
      foreignKey: 'String'
    }
  },

  naming: {
    entityCase: 'PascalCase',
    fieldCase: 'camelCase',
    fileCase: 'PascalCase'
  },

  structure: {
    directories: [
      'src/main/java/com/example/app/',
      'src/main/java/com/example/app/controller/',
      'src/main/java/com/example/app/service/',
      'src/main/java/com/example/app/model/',
      'src/main/java/com/example/app/repository/',
      'src/main/java/com/example/app/config/',
      'src/main/resources/',
      'src/test/java/com/example/app/'
    ],
    fileExtensions: ['.java'],
    packageFile: 'pom.xml',
    configFiles: ['.env.example', 'application.properties']
  },

  dependencies: {
    packageManager: 'maven',
    dependencyFile: 'pom.xml',
    corePackages: [
      {
        name: 'org.springframework.boot',
        version: '3.1.5',
        description: 'Spring Boot core',
        required: true,
        category: 'core'
      },
      {
        name: 'org.springframework.boot',
        version: '3.1.5',
        description: 'Spring Boot starter web',
        required: true,
        category: 'core'
      },
      {
        name: 'org.springframework.boot',
        version: '3.1.5',
        description: 'Spring Boot starter data JPA',
        required: true,
        category: 'database'
      },
      {
        name: 'org.springframework.boot',
        version: '3.1.5',
        description: 'Spring Boot starter validation',
        required: true,
        category: 'validation'
      },
      {
        name: 'org.postgresql',
        version: '42.6.0',
        description: 'PostgreSQL JDBC driver',
        required: true,
        category: 'database'
      },
      {
        name: 'org.projectlombok',
        version: '1.18.28',
        description: 'Reduce boilerplate code',
        required: true,
        category: 'core'
      },
      {
        name: 'org.hibernate.validator',
        version: '8.0.1.Final',
        description: 'Hibernate validator',
        required: true,
        category: 'validation'
      }
    ],
    optionalPackages: {
      database: [
        {
          name: 'mysql',
          version: 'mysql-connector-java',
          description: 'MySQL JDBC driver',
          required: false,
          category: 'database'
        },
        {
          name: 'com.h2database',
          version: 'h2',
          description: 'H2 in-memory database',
          required: false,
          category: 'database'
        }
      ],
      security: [
        {
          name: 'org.springframework.boot',
          version: '3.1.5',
          description: 'Spring Boot starter security',
          required: false,
          category: 'security'
        },
        {
          name: 'io.jsonwebtoken',
          version: 'jjwt-api',
          description: 'JWT implementation',
          required: false,
          category: 'security'
        }
      ],
      utility: [
        {
          name: 'org.apache.commons',
          version: 'commons-lang3',
          description: 'Apache Commons Lang',
          required: false,
          category: 'utility'
        }
      ]
    }
  },

  patterns: {
    imports: [
      {
        template: 'import {{IMPORTS}};',
        description: 'Java import statement',
        examples: {
          controller: 'import org.springframework.web.bind.annotation.*;',
          model: 'import javax.persistence.*;',
          service: 'import org.springframework.stereotype.Service;'
        }
      }
    ],
    models: {
      template: `package {{PACKAGE_NAME}}.model;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Entity
@Table(name = "{{TABLE_NAME}}")
@Data
public class {{ENTITY_NAME}} {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private {{TYPE_SYSTEM.idType}} id;

{{FIELDS}}

{{RELATIONSHIPS}}
}`,
      fieldsTemplate: `    @Column(name = "{{FIELD_NAME}}", nullable = {{FIELD_NULLABLE}})
    private {{FIELD_TYPE}} {{FIELD_NAME}};`,
      relationshipsTemplate: `    @OneToMany(mappedBy = "{{BACK_REFERENCE}}", cascade = CascadeType.ALL)
    private List<{{RELATED_ENTITY}}> {{RELATIONSHIP_NAME}};`,
      example: `package com.example.app.model;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Data
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private String id;

    @Column(name = "email", nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @OneToMany(mappedBy = "author", cascade = CascadeType.ALL)
    private List<Post> posts;
}`
    },
    schemas: {
      template: `package {{PACKAGE_NAME}}.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class {{SCHEMA_NAME}} {
{{FIELDS}}
}`,
      fieldsTemplate: `    @NotNull(message = "{{MESSAGE}}")
    {{VALIDATION_ANNOTATION}}(message = "{{MESSAGE}}")
    private {{FIELD_TYPE}} {{FIELD_NAME}};`,
      example: `package com.example.app.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class CreateUserDto {
    @NotNull(message = "Email is required")
    @Email(message = "Email should be valid")
    private String email;

    @NotNull(message = "Password is required")
    @Size(min = 8, message = "Password must be at least 8 characters")
    private String password;
}`
    },
    services: {
      template: `package {{PACKAGE_NAME}}.service;

import {{PACKAGE_NAME}}.model.{{MODEL_NAME}};
import {{PACKAGE_NAME}}.repository.{{REPOSITORY_NAME}};
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class {{SERVICE_NAME}} {
    private final {{REPOSITORY_NAME}} {{REPOSITORY_INSTANCE}};

    public {{SERVICE_NAME}}({{REPOSITORY_NAME}} {{REPOSITORY_INSTANCE}}) {
        this.{{REPOSITORY_INSTANCE}} = {{REPOSITORY_INSTANCE}};
    }

{{CRUD_METHODS}}
}`,
      crudTemplate: `    public {{MODEL_NAME}} create({{SCHEMA_NAME}} {{SCHEMA_NAME_LOWER}}) {
        {{MODEL_NAME}} {{MODEL_NAME_LOWER}} = new {{MODEL_NAME}}();
        BeanUtils.copyProperties({{SCHEMA_NAME_LOWER}}, {{MODEL_NAME_LOWER}}, "id");
        return {{REPOSITORY_INSTANCE}}.save({{MODEL_NAME_LOWER}});
    }

    public Optional<{{MODEL_NAME}}> findById(String id) {
        return {{REPOSITORY_INSTANCE}}.findById(id);
    }

    public List<{{MODEL_NAME}}> findAll() {
        return {{REPOSITORY_INSTANCE}}.findAll();
    }

    public Optional<{{MODEL_NAME}}> update(String id, {{SCHEMA_NAME}} {{SCHEMA_NAME_LOWER}}) {
        Optional<{{MODEL_NAME}}> existing = findById(id);
        if (existing.isPresent()) {
            {{MODEL_NAME}} {{MODEL_NAME_LOWER}} = existing.get();
            BeanUtils.copyProperties({{SCHEMA_NAME_LOWER}}, {{MODEL_NAME_LOWER}}, "id");
            return Optional.of({{REPOSITORY_INSTANCE}}.save({{MODEL_NAME_LOWER}}));
        }
        return Optional.empty();
    }

    public boolean deleteById(String id) {
        if (findById(id).isPresent()) {
            {{REPOSITORY_INSTANCE}}.deleteById(id);
            return true;
        }
        return false;
    }`,
      example: `package com.example.app.service;

import com.example.app.model.User;
import com.example.app.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class UserService {
    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User create(CreateUserDto createUserDto) {
        User user = new User();
        BeanUtils.copyProperties(createUserDto, user, "id");
        return userRepository.save(user);
    }

    public Optional<User> findById(String id) {
        return userRepository.findById(id);
    }

    public List<User> findAll() {
        return userRepository.findAll();
    }`
    },
    controllers: {
      template: `package {{PACKAGE_NAME}}.controller;

import {{PACKAGE_NAME}}.service.{{SERVICE_NAME}};
import {{PACKAGE_NAME}}.dto.{{SCHEMA_NAME}};
import {{PACKAGE_NAME}}.model.{{MODEL_NAME}};
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/{{ROUTE_PREFIX}}")
public class {{CONTROLLER_NAME}} {
    private final {{SERVICE_NAME}} {{SERVICE_INSTANCE}};

    public {{CONTROLLER_NAME}}({{SERVICE_NAME}} {{SERVICE_INSTANCE}}) {
        this.{{SERVICE_INSTANCE}} = {{SERVICE_INSTANCE}};
    }

{{ENDPOINTS}}
}`,
      endpointTemplate: `    @GetMapping
    public ResponseEntity<List<{{MODEL_NAME}}>> getAll() {
        return ResponseEntity.ok({{SERVICE_INSTANCE}}.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<{{MODEL_NAME}}> getById(@PathVariable String id) {
        Optional<{{MODEL_NAME}}> result = {{SERVICE_INSTANCE}}.findById(id);
        return result.map(ResponseEntity::ok)
                   .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<{{MODEL_NAME}}> create(@RequestBody @Valid {{SCHEMA_NAME}} {{SCHEMA_NAME_LOWER}}) {
        {{MODEL_NAME}} created = {{SERVICE_INSTANCE}}.create({{SCHEMA_NAME_LOWER}});
        return ResponseEntity.ok(created);
    }

    @PutMapping("/{id}")
    public ResponseEntity<{{MODEL_NAME}}> update(
        @PathVariable String id,
        @RequestBody @Valid {{SCHEMA_NAME}} {{SCHEMA_NAME_LOWER}}
    ) {
        Optional<{{MODEL_NAME}}> result = {{SERVICE_INSTANCE}}.update(id, {{SCHEMA_NAME_LOWER}});
        return result.map(ResponseEntity::ok)
                   .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        boolean deleted = {{SERVICE_INSTANCE}}.deleteById(id);
        return deleted ? ResponseEntity.ok().<Void>build()
                       : ResponseEntity.notFound().build();
    }`,
      example: `package com.example.app.controller;

import com.example.app.service.UserService;
import com.example.app.dto.CreateUserDto;
import com.example.app.model.User;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/users")
public class UsersController {
    private final UserService userService;

    public UsersController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ResponseEntity<List<User>> getAll() {
        return ResponseEntity.ok(userService.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<User> getById(@PathVariable String id) {
        Optional<User> result = userService.findById(id);
        return result.map(ResponseEntity::ok)
                   .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<User> create(@RequestBody @Valid CreateUserDto createUserDto) {
        User created = userService.create(createUserDto);
        return ResponseEntity.ok(created);
    }`
    },
    config: {
      template: `package {{PACKAGE_NAME}}.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import lombok.Data;

@Data
@Component
@ConfigurationProperties(prefix = "{{CONFIG_PREFIX}}")
public class {{CONFIG_NAME}} {
{{CONFIG_FIELDS}}
}`,
      envTemplate: `    private {{FIELD_TYPE}} {{FIELD_NAME}};`,
      example: `package com.example.app.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import lombok.Data;

@Data
@Component
@ConfigurationProperties(prefix = "app")
public class AppConfig {
    private String databaseUrl;
    private String secretKey;
}`
    },
    database: {
      template: `package {{PACKAGE_NAME}}.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;

import jakarta.persistence.EntityManagerFactory;
import javax.sql.DataSource;

@Configuration
public class DatabaseConfig {
    @Bean
    public LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource dataSource) {
        LocalContainerEntityManagerFactoryBean em = new LocalContainerEntityManagerFactoryBean();
        em.setDataSource(dataSource);
        em.setPackagesToScan("{{PACKAGE_NAME}}.model");
        em.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        return em;
    }

    @Bean
    public JpaTransactionManager transactionManager(EntityManagerFactory entityManagerFactory) {
        JpaTransactionManager transactionManager = new JpaTransactionManager();
        transactionManager.setEntityManagerFactory(entityManagerFactory);
        return transactionManager;
    }

    @Bean
    public PlatformTransactionManager annotationDrivenTransactionManager(EntityManagerFactory entityManagerFactory) {
        return transactionManager;
    }
}`,
      connectionTemplate: `@Bean
public DataSource dataSource() {
    HikariDataSource dataSource = new HikariDataSource();
    dataSource.setJdbcUrl(jdbcUrl);
    dataSource.setUsername(username);
    dataSource.setPassword(password);
    return dataSource;
}`,
      sessionTemplate: `@Bean
public EntityManager entityManager(EntityManagerFactory entityManagerFactory) {
    return entityManagerFactory.createEntityManager();
}`,
      migrationTemplate: `package {{PACKAGE_NAME}}.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;

public class {{MIGRATION_NAME}} implements BaseJavaMigration {
    @Override
    public Integer getVersion() {
        return {{REVISION_ID}};
    }

    @Override
    public String getDescription() {
        return "{{DESCRIPTION}}";
    }

    @Override
    public void migrate(Context context) throws Exception {
        // Migration up logic
    }

    @Override
    public void undo(Context context) throws Exception {
        // Migration down logic
    }
}`,
      example: `package com.example.app.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;

import jakarta.persistence.EntityManagerFactory;
import javax.sql.DataSource;

@Configuration
public class DatabaseConfig {
    @Bean
    public LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource dataSource) {
        LocalContainerEntityManagerFactoryBean em = new LocalContainerEntityManagerFactoryBean();
        em.setDataSource(dataSource);
        em.setPackagesToScan("com.example.app.model");
        return em;
    }

    @Bean
    public JpaTransactionManager transactionManager(EntityManagerFactory entityManagerFactory) {
        JpaTransactionManager transactionManager = new JpaTransactionManager();
        transactionManager.setEntityManagerFactory(entityManagerFactory);
        return transactionManager;
    }
}`
    },
    security: {
      passwordHashTemplate: `package {{PACKAGE_NAME}}.security;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

public class PasswordEncoderUtil {
    private static final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public static String encode(String rawPassword) {
        return encoder.encode(rawPassword);
    }

    public static boolean matches(String rawPassword, String encodedPassword) {
        return encoder.matches(rawPassword, encodedPassword);
    }
}`,
      jwtTemplate: `package {{PACKAGE_NAME}}.security;

import io.jsonwebtoken.*;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

public class JwtUtil {
    private static final String SECRET_KEY = "secret";
    private static final long EXPIRATION_TIME = 86400000; // 24 hours

    public static String generateToken(String username) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", username);
        return Jwts.builder()
                .setClaims(claims)
                .setExpiration(new Date(System.currentTimeMillis() + EXPIRATION_TIME))
                .signWith(SignatureAlgorithm.HS256, SECRET_KEY)
                .compact();
    }

    public static String extractUsername(String token) {
        Claims claims = Jwts.parser()
                .setSigningKey(SECRET_KEY)
                .parseClaimsJws(token)
                .getBody();
        return claims.getSubject();
    }

    public static boolean validateToken(String token) {
        try {
            Jwts.parser()
                .setSigningKey(SECRET_KEY)
                .parseClaimsJws(token)
                .getBody();
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
}`,
      middlewareTemplate: `package {{PACKAGE_NAME}}.security;

import jakarta.servlet.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;

public class JwtAuthenticationFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain) throws ServletException, IOException {
        String authorizationHeader = request.getHeader("Authorization");
        
        if (authorizationHeader != null && authorizationHeader.startsWith("Bearer ")) {
            String token = authorizationHeader.substring(7);
            if (JwtUtil.validateToken(token)) {
                String username = JwtUtil.extractUsername(token);
                UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(username, null, null);
                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        }
        
        filterChain.doFilter(request, response);
    }
}`,
      example: `package com.example.app.security;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

public class PasswordEncoderUtil {
    private static final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public static String encode(String rawPassword) {
        return encoder.encode(rawPassword);
    }

    public static boolean matches(String rawPassword, String encodedPassword) {
        return encoder.matches(rawPassword, encodedPassword);
    }
}`
    }
  },

  validation: {
    linter: 'checkstyle',
    linterCommand: 'mvn checkstyle:check',
    errorPatterns: [
      {
        regex: 'UNCHECKED',
        category: 'Unchecked',
        fixStrategy: 'Add proper type checking or suppress with @SuppressWarnings'
      },
      {
        regex: 'DEPRECATION',
        category: 'Deprecation',
        fixStrategy: 'Replace deprecated API with newer alternatives'
      }
    ]
  },

  testing: {
    framework: 'JUnit 5',
    testDirectory: 'src/test/java/',
    testFilePattern: '*Test.java'
  },

  fileStaging: [
    {
      stage: 0,
      patterns: ['pom.xml', 'build.gradle', '.env.example', 'src/main/resources/**'],
      description: 'Configuration files and resources'
    },
    {
      stage: 1,
      patterns: ['src/main/java/**/model/**', 'src/main/java/**/entity/**'],
      description: 'Database entities'
    },
    {
      stage: 2,
      patterns: ['src/main/java/**/dto/**'],
      description: 'DTOs and schemas'
    },
    {
      stage: 3,
      patterns: ['src/main/java/**/service/**'],
      description: 'Business logic services'
    },
    {
      stage: 4,
      patterns: ['src/main/java/**/controller/**'],
      description: 'API controllers'
    },
    {
      stage: 5,
      patterns: ['src/main/java/**/Application.java', 'src/main/java/**/App.java'],
      description: 'Application entry point'
    },
    {
      stage: 6,
      patterns: ['src/test/**', 'docs/**', 'readme.md', 'README.md'],
      description: 'Tests and documentation'
    }
  ],

  tokenBudgets: {
    'src/main/java/**/model/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/main/java/**/entity/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/main/java/**/service/**': { maxTokens: 3200, contextWindow: 12288 },
    'src/main/java/**/controller/**': { maxTokens: 2600, contextWindow: 10240 },
    'src/main/java/**/dto/**': { maxTokens: 2600, contextWindow: 10240 },
    'pom.xml': { maxTokens: 1800, contextWindow: 8192 },
    'build.gradle': { maxTokens: 1800, contextWindow: 8192 },
    'readme.md': { maxTokens: 1800, contextWindow: 8192 },
    'README.md': { maxTokens: 1800, contextWindow: 8192 },
    'docs/**': { maxTokens: 1800, contextWindow: 8192 },
    'src/test/**': { maxTokens: 2200, contextWindow: 8192 },
    default: { maxTokens: 2400, contextWindow: 8192 }
  }
}
