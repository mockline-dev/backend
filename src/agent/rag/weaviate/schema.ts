/**
 * Weaviate Schema Definition for Agentic Development
 *
 * Defines the Weaviate schema classes for storing projects, files, code snippets,
 * documentation, and conversations with vector embeddings for semantic search.
 */

import type { WeaviateClient } from 'weaviate-ts-client'
import { logger } from '../../../logger'

/**
 * Weaviate class names
 */
export const WEAVIATE_CLASSES = {
  PROJECT: 'Project',
  FILE: 'File',
  CODE_SNIPPET: 'CodeSnippet',
  DOCUMENTATION: 'Documentation',
  CONVERSATION: 'Conversation'
} as const

/**
 * Property definitions for Weaviate classes
 */
const SCHEMA_DEFINITIONS = {
  [WEAVIATE_CLASSES.PROJECT]: {
    class: WEAVIATE_CLASSES.PROJECT,
    description: 'Project metadata and embeddings for semantic search',
    vectorizer: 'none', // We'll provide vectors manually
    properties: [
      {
        name: 'projectId',
        dataType: ['string'],
        description: 'Unique project identifier'
      },
      {
        name: 'name',
        dataType: ['string'],
        description: 'Project name'
      },
      {
        name: 'description',
        dataType: ['text'],
        description: 'Project description'
      },
      {
        name: 'language',
        dataType: ['string'],
        description: 'Programming language (e.g., TypeScript, Python)'
      },
      {
        name: 'framework',
        dataType: ['string'],
        description: 'Framework (e.g., NestJS, FastAPI, React)'
      },
      {
        name: 'stackId',
        dataType: ['string'],
        description: 'Stack configuration identifier'
      },
      {
        name: 'features',
        dataType: ['string[]'],
        description: 'List of features (e.g., authentication, pagination)'
      },
      {
        name: 'createdAt',
        dataType: ['date'],
        description: 'Creation timestamp'
      },
      {
        name: 'updatedAt',
        dataType: ['date'],
        description: 'Last update timestamp'
      },
      {
        name: 'fileCount',
        dataType: ['int'],
        description: 'Number of files in the project'
      },
      {
        name: 'totalSize',
        dataType: ['int'],
        description: 'Total size of all files in bytes'
      }
    ],
    vectorIndexConfig: {
      skip: false,
      ef: 64,
      efConstruction: 128,
      maxConnections: 32
    }
  },

  [WEAVIATE_CLASSES.FILE]: {
    class: WEAVIATE_CLASSES.FILE,
    description: 'Individual files with embeddings for semantic search',
    vectorizer: 'none',
    properties: [
      {
        name: 'projectId',
        dataType: ['string'],
        description: 'Parent project identifier'
      },
      {
        name: 'path',
        dataType: ['string'],
        description: 'File path relative to project root'
      },
      {
        name: 'name',
        dataType: ['string'],
        description: 'File name'
      },
      {
        name: 'extension',
        dataType: ['string'],
        description: 'File extension (e.g., .ts, .py, .json)'
      },
      {
        name: 'content',
        dataType: ['text'],
        description: 'Full file content'
      },
      {
        name: 'contentPreview',
        dataType: ['text'],
        description: 'Preview of file content (first 500 characters)'
      },
      {
        name: 'language',
        dataType: ['string'],
        description: 'Programming language of the file'
      },
      {
        name: 'framework',
        dataType: ['string'],
        description: 'Framework used in the file'
      },
      {
        name: 'fileType',
        dataType: ['string'],
        description: 'File type (model, service, controller, config, etc.)'
      },
      {
        name: 'size',
        dataType: ['int'],
        description: 'File size in bytes'
      },
      {
        name: 'lineCount',
        dataType: ['int'],
        description: 'Number of lines in the file'
      },
      {
        name: 'createdAt',
        dataType: ['date'],
        description: 'Creation timestamp'
      },
      {
        name: 'updatedAt',
        dataType: ['date'],
        description: 'Last update timestamp'
      },
      {
        name: 'dependencies',
        dataType: ['string[]'],
        description: 'List of file dependencies'
      },
      {
        name: 'imports',
        dataType: ['string[]'],
        description: 'List of imports in the file'
      },
      {
        name: 'exports',
        dataType: ['string[]'],
        description: 'List of exports from the file'
      }
    ],
    vectorIndexConfig: {
      skip: false,
      ef: 64,
      efConstruction: 128,
      maxConnections: 32
    }
  },

  [WEAVIATE_CLASSES.CODE_SNIPPET]: {
    class: WEAVIATE_CLASSES.CODE_SNIPPET,
    description: 'Code snippets with embeddings for semantic search',
    vectorizer: 'none',
    properties: [
      {
        name: 'projectId',
        dataType: ['string'],
        description: 'Parent project identifier'
      },
      {
        name: 'filePath',
        dataType: ['string'],
        description: 'Source file path'
      },
      {
        name: 'snippet',
        dataType: ['text'],
        description: 'Code snippet content'
      },
      {
        name: 'description',
        dataType: ['text'],
        description: 'Description of what the snippet does'
      },
      {
        name: 'language',
        dataType: ['string'],
        description: 'Programming language'
      },
      {
        name: 'framework',
        dataType: ['string'],
        description: 'Framework'
      },
      {
        name: 'category',
        dataType: ['string'],
        description: 'Category (e.g., authentication, validation, data-access)'
      },
      {
        name: 'pattern',
        dataType: ['string'],
        description: 'Design pattern (e.g., singleton, factory, repository)'
      },
      {
        name: 'isBestPractice',
        dataType: ['boolean'],
        description: 'Whether this is a best practice example'
      },
      {
        name: 'usageCount',
        dataType: ['int'],
        description: 'Number of times this snippet has been used'
      },
      {
        name: 'createdAt',
        dataType: ['date'],
        description: 'Creation timestamp'
      }
    ],
    vectorIndexConfig: {
      skip: false,
      ef: 64,
      efConstruction: 128,
      maxConnections: 32
    }
  },

  [WEAVIATE_CLASSES.DOCUMENTATION]: {
    class: WEAVIATE_CLASSES.DOCUMENTATION,
    description: 'Documentation with embeddings for semantic search',
    vectorizer: 'none',
    properties: [
      {
        name: 'projectId',
        dataType: ['string'],
        description: 'Parent project identifier'
      },
      {
        name: 'title',
        dataType: ['string'],
        description: 'Documentation title'
      },
      {
        name: 'content',
        dataType: ['text'],
        description: 'Documentation content'
      },
      {
        name: 'type',
        dataType: ['string'],
        description: 'Documentation type (api, guide, reference, tutorial)'
      },
      {
        name: 'language',
        dataType: ['string'],
        description: 'Programming language'
      },
      {
        name: 'framework',
        dataType: ['string'],
        description: 'Framework'
      },
      {
        name: 'tags',
        dataType: ['string[]'],
        description: 'Tags for categorization'
      },
      {
        name: 'difficulty',
        dataType: ['string'],
        description: 'Difficulty level (beginner, intermediate, advanced)'
      },
      {
        name: 'source',
        dataType: ['string'],
        description: 'Source of documentation (official, community, generated)'
      },
      {
        name: 'createdAt',
        dataType: ['date'],
        description: 'Creation timestamp'
      },
      {
        name: 'updatedAt',
        dataType: ['date'],
        description: 'Last update timestamp'
      }
    ],
    vectorIndexConfig: {
      skip: false,
      ef: 64,
      efConstruction: 128,
      maxConnections: 32
    }
  },

  [WEAVIATE_CLASSES.CONVERSATION]: {
    class: WEAVIATE_CLASSES.CONVERSATION,
    description: 'Conversation history with embeddings for semantic search',
    vectorizer: 'none',
    properties: [
      {
        name: 'projectId',
        dataType: ['string'],
        description: 'Parent project identifier'
      },
      {
        name: 'userId',
        dataType: ['string'],
        description: 'User identifier'
      },
      {
        name: 'prompt',
        dataType: ['text'],
        description: 'User prompt'
      },
      {
        name: 'response',
        dataType: ['text'],
        description: 'System response'
      },
      {
        name: 'context',
        dataType: ['text'],
        description: 'Additional context'
      },
      {
        name: 'language',
        dataType: ['string'],
        description: 'Programming language'
      },
      {
        name: 'framework',
        dataType: ['string'],
        description: 'Framework'
      },
      {
        name: 'intent',
        dataType: ['string'],
        description: 'Intent category (create, modify, debug, explain)'
      },
      {
        name: 'success',
        dataType: ['boolean'],
        description: 'Whether the operation was successful'
      },
      {
        name: 'filesGenerated',
        dataType: ['int'],
        description: 'Number of files generated'
      },
      {
        name: 'createdAt',
        dataType: ['date'],
        description: 'Creation timestamp'
      }
    ],
    vectorIndexConfig: {
      skip: false,
      ef: 64,
      efConstruction: 128,
      maxConnections: 32
    }
  }
}

/**
 * Create all Weaviate schema classes
 */
export async function createWeaviateSchema(client: WeaviateClient): Promise<void> {
  logger.info('Creating Weaviate schema for agentic development')

  try {
    // Check if schema already exists
    const existingClasses = await client.schema.getter().do()
    const existingClassNames = new Set(existingClasses.classes?.map((c: any) => c.class) ?? [])

    // Create each class if it doesn't exist
    for (const [className, schema] of Object.entries(SCHEMA_DEFINITIONS)) {
      if (existingClassNames.has(className)) {
        logger.info('Weaviate class %s already exists, skipping', className)
        continue
      }

      logger.info('Creating Weaviate class: %s', className)
      await client.schema.classCreator().withClass(schema).do()
      logger.info('Successfully created Weaviate class: %s', className)
    }

    logger.info('Weaviate schema creation completed')
  } catch (error: any) {
    logger.error('Failed to create Weaviate schema: %s', error.message)
    throw error
  }
}

/**
 * Delete all Weaviate schema classes
 */
export async function deleteWeaviateSchema(client: WeaviateClient): Promise<void> {
  logger.info('Deleting Weaviate schema for agentic development')

  try {
    // Delete each class in reverse order (to handle dependencies)
    const classNames = Object.keys(SCHEMA_DEFINITIONS).reverse()

    for (const className of classNames) {
      try {
        logger.info('Deleting Weaviate class: %s', className)
        await client.schema.classDeleter().withClassName(className).do()
        logger.info('Successfully deleted Weaviate class: %s', className)
      } catch (error: any) {
        // Class might not exist, which is fine
        if (error.message?.includes('class not found')) {
          logger.info('Weaviate class %s does not exist, skipping', className)
        } else {
          logger.warn('Failed to delete Weaviate class %s: %s', className, error.message)
        }
      }
    }

    logger.info('Weaviate schema deletion completed')
  } catch (error: any) {
    logger.error('Failed to delete Weaviate schema: %s', error.message)
    throw error
  }
}

/**
 * Get schema configuration for a specific class
 */
export function getClassSchema(className: string): any {
  const schema = SCHEMA_DEFINITIONS[className as keyof typeof SCHEMA_DEFINITIONS]
  if (!schema) {
    throw new Error(`Schema not found for class: ${className}`)
  }
  return schema
}

/**
 * Validate vector dimension matches configuration
 */
export function validateVectorDimension(vector: number[], config: { vectorDimension: number }): boolean {
  return vector.length === config.vectorDimension
}

/**
 * Get property names for a class
 */
export function getClassProperties(className: string): string[] {
  const schema = getClassSchema(className)
  return schema.properties.map((p: any) => p.name)
}
