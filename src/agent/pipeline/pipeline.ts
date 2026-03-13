import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { r2Client } from '../../storage/r2.client'
import { ProjectMemory } from '../memory/project-memory'
import { ContextRetriever } from '../rag/retriever'
import { validateGeneratedFiles } from '../validation/validator'
import { ArchitectureExtractor } from './architecture-extractor'
import { CrossFileValidator } from './cross-file-validator'
import { FileGenerator, type GeneratedFile } from './file-generator'
import { IntentAnalyzer } from './intent-analyzer'
import { SchemaValidator } from './schema-validator'
import { TaskPlanner } from './task-planner'

export interface PipelineOptions {
  projectId: string
  prompt: string
  userId: string
  onProgress: (stage: string, percentage: number, currentFile?: string) => Promise<void>
  jobId?: string | number
}

export interface PipelineResult {
  files: GeneratedFile[]
  fileCount: number
  totalSize: number
}

export class GenerationPipeline {
  private app: Application
  private intentAnalyzer = new IntentAnalyzer()
  private schemaValidator = new SchemaValidator()
  private taskPlanner = new TaskPlanner()
  private fileGenerator = new FileGenerator()
  private crossFileValidator = new CrossFileValidator()
  private memory: ProjectMemory
  private retriever: ContextRetriever

  constructor(app: Application) {
    this.app = app
    this.memory = new ProjectMemory(app)
    this.retriever = new ContextRetriever(app)
  }

  async run(options: PipelineOptions): Promise<PipelineResult> {
    const { projectId, prompt, onProgress, jobId } = options
    const pipelineStartedAt = Date.now()

    // Stage 0 — Load project info, initialize memory, index existing files
    let project: any
    try {
      project = await this.app.service('projects').get(projectId)
    } catch {
      project = null
    }

    // Initialize memory if it doesn't exist yet, then record this prompt
    if (project) {
      await this.memory.initialize(projectId, { language: project.language, framework: project.framework })
    }
    await this.memory.recordPrompt(projectId, prompt)
    const memoryData = await this.memory.load(projectId)
    const memoryBlock = this.memory.buildContextBlock(memoryData)

    // Index any pre-existing project files into the RAG store so generators have context
    const ragIndexStartedAt = Date.now()
    void this.retriever
      .indexProject(projectId)
      .then(() => {
        logger.info(
          'Pipeline: RAG indexing completed in %dms for project %s',
          Date.now() - ragIndexStartedAt,
          projectId
        )
      })
      .catch((err: any) => {
        logger.warn('Pipeline: RAG indexing failed (non-fatal): %s', err.message)
      })

    // Stage 1 — Intent analysis (schema extraction)
    await onProgress('Analyzing prompt', 5)
    const intentStartedAt = Date.now()
    const schema = await this.intentAnalyzer.analyze(prompt)
    logger.info(
      'Pipeline: intent analysis completed in %dms for project %s',
      Date.now() - intentStartedAt,
      projectId
    )

    // Stage 1.5 — Schema validation (relationship extraction and validation)
    await onProgress('Validating schema', 10)
    const schemaValidationStartedAt = Date.now()
    const validationResult = this.schemaValidator.validate(schema)
    logger.info(
      'Pipeline: schema validation completed in %dms for project %s',
      Date.now() - schemaValidationStartedAt,
      projectId
    )

    // Collect all warnings for later reporting
    const allWarnings: string[] = []

    // Log warnings if any
    if (validationResult.warnings.length > 0) {
      const warningMessages = validationResult.warnings.map(w => `- ${w.field}: ${w.message}`).join('\n')
      logger.warn('Pipeline: Schema validation warnings:\n%s', warningMessages)
      allWarnings.push(...validationResult.warnings.map(w => `Schema: ${w.field} - ${w.message}`))
    }

    // Only throw on critical errors, not warnings
    if (!validationResult.isValid && validationResult.errors.length > 0) {
      // Check if errors are critical or can be treated as warnings
      const criticalErrors = validationResult.errors.filter(e => {
        // Treat missing optional fields as warnings
        if (e.message.includes('missing') || e.message.includes('Missing')) {
          return false
        }
        // Treat relationship issues as warnings
        if (e.message.includes('relationship') || e.message.includes('Relationship')) {
          return false
        }
        // All other errors are critical
        return true
      })

      if (criticalErrors.length > 0) {
        const errorMessages = criticalErrors.map(e => `- ${e.field}: ${e.message}`).join('\n')
        logger.error('Pipeline: Schema validation failed with critical errors:\n%s', errorMessages)
        throw new Error(`Schema validation failed:\n${errorMessages}`)
      } else {
        // Treat non-critical errors as warnings
        const warningMessages = validationResult.errors.map(e => `- ${e.field}: ${e.message}`).join('\n')
        logger.warn('Pipeline: Schema validation errors treated as warnings:\n%s', warningMessages)
        allWarnings.push(...validationResult.errors.map(e => `Schema: ${e.field} - ${e.message}`))
      }
    }

    logger.info('Pipeline: Schema validated with %d relationships', validationResult.relationships.length)

    // Stage 2 — Task planning (file structure)
    await onProgress('Planning files', 15)
    const planningStartedAt = Date.now()
    const plan = await this.taskPlanner.plan(prompt, schema)
    logger.info(
      'Pipeline: task planning completed in %dms for project %s',
      Date.now() - planningStartedAt,
      projectId
    )

    await this.app.service('projects').patch(projectId, {
      generationProgress: {
        totalFiles: plan.length,
        currentStage: 'planning_files',
        percentage: 15,
        filesGenerated: 0
      }
    } as any)

    // Stage 3 — File generation
    const generationStartedAt = Date.now()
    const generatedFiles = await this.fileGenerator.generateAll(
      prompt,
      schema,
      plan,
      async (index, total, filePath) => {
        const percentage = 20 + Math.round((index / total) * 60)
        await onProgress('Generating files', percentage, filePath)

        // Track generated files for cleanup
        if (jobId) {
          const { jobTracker } = await import('../../services/redis/queues/job-tracker')
          jobTracker.trackGeneratedFile(jobId, { path: filePath })
        }
      },
      { projectId, retriever: this.retriever, memoryBlock, relationships: validationResult.relationships }
    )
    logger.info(
      'Pipeline: file generation completed in %dms for project %s (%d files)',
      Date.now() - generationStartedAt,
      projectId,
      generatedFiles.length
    )

    // Stage 3.5 — Cross-file validation
    await onProgress('Validating cross-file dependencies', 80)
    const crossFileValidationStartedAt = Date.now()
    const crossFileValidation = this.crossFileValidator.validate(
      generatedFiles,
      schema,
      validationResult.relationships
    )
    logger.info(
      'Pipeline: cross-file validation completed in %dms for project %s',
      Date.now() - crossFileValidationStartedAt,
      projectId
    )

    // Log warnings if any
    if (crossFileValidation.warnings.length > 0) {
      const warningMessages = crossFileValidation.warnings.map(w => `- ${w.file}: ${w.message}`).join('\n')
      logger.warn('Pipeline: Cross-file validation warnings:\n%s', warningMessages)
      allWarnings.push(...crossFileValidation.warnings.map(w => `Cross-file: ${w.file} - ${w.message}`))
    }

    // Only throw on critical cross-file errors
    if (!crossFileValidation.isValid && crossFileValidation.errors.length > 0) {
      // Check if errors are critical or can be treated as warnings
      const criticalErrors = crossFileValidation.errors.filter(e => {
        // Treat missing references as warnings
        if (e.message.includes('not found') || e.message.includes('undefined')) {
          return false
        }
        // Treat import issues as warnings
        if (e.message.includes('import') || e.message.includes('Import')) {
          return false
        }
        // All other errors are critical
        return true
      })

      if (criticalErrors.length > 0) {
        const errorMessages = criticalErrors.map(e => `- ${e.file}: ${e.message}`).join('\n')
        logger.error('Pipeline: Cross-file validation failed with critical errors:\n%s', errorMessages)
        throw new Error(`Cross-file validation failed:\n${errorMessages}`)
      } else {
        // Treat non-critical errors as warnings
        const warningMessages = crossFileValidation.errors.map(e => `- ${e.file}: ${e.message}`).join('\n')
        logger.warn('Pipeline: Cross-file validation errors treated as warnings:\n%s', warningMessages)
        allWarnings.push(...crossFileValidation.errors.map(e => `Cross-file: ${e.file} - ${e.message}`))
      }
    }

    // Stage 4 — Persist files to R2 + MongoDB
    await onProgress('Saving files', 82)
    const persistenceStartedAt = Date.now()
    const persistedFiles = await this.persistFiles(projectId, generatedFiles, jobId)
    logger.info(
      'Pipeline: persistence completed in %dms for project %s',
      Date.now() - persistenceStartedAt,
      projectId
    )

    // Stage 5 — Validate generated files
    await onProgress('Validating', 90)
    const fileValidationStartedAt = Date.now()
    const validationResults = await validateGeneratedFiles(generatedFiles, projectId, this.app, onProgress)
    logger.info(
      'Pipeline: file validation completed in %dms for project %s',
      Date.now() - fileValidationStartedAt,
      projectId
    )
    if (validationResults.failCount > 0) {
      logger.warn(
        'Pipeline: %d/%d files failed validation for project %s',
        validationResults.failCount,
        generatedFiles.length,
        projectId
      )
      // Don't throw - allow generation to complete even with validation failures
      allWarnings.push(`${validationResults.failCount} files failed validation`)
    }

    // Stage 6 — Extract architecture metadata
    try {
      await onProgress('Building architecture graph', 95)
      const architectureStartedAt = Date.now()
      const extractor = new ArchitectureExtractor()
      const architectureData = extractor.extract(schema, generatedFiles, validationResult.relationships)
      await this.app.service('architecture').create({
        projectId,
        ...architectureData,
        updatedAt: Date.now()
      } as any)
      logger.info(
        'Pipeline: architecture extraction completed in %dms for project %s',
        Date.now() - architectureStartedAt,
        projectId
      )

      // Persist architecture decisions into project memory
      const decisions: string[] = [
        ...((architectureData as any).services ?? []).map((s: string) => `Service: ${s}`),
        ...((architectureData as any).relations ?? []).map(
          (r: any) => `Relation: ${r.from} → ${r.to} (${r.type})`
        )
      ]
      if (decisions.length) {
        await this.memory.recordDecisions(projectId, decisions)
      }
    } catch (err: any) {
      logger.warn('Pipeline: architecture extraction failed (non-fatal): %s', err.message)
    }

    await onProgress('Complete', 100)

    const totalSize = persistedFiles.reduce((sum, f) => sum + f.size, 0)

    // Include warnings in the result
    const result: PipelineResult = {
      files: generatedFiles,
      fileCount: persistedFiles.length,
      totalSize
    }

    // Attach warnings to the result if any
    if (allWarnings.length > 0) {
      ;(result as any).warnings = allWarnings
    }

    logger.info(
      'Pipeline: completed in %dms for project %s (files=%d, warnings=%d)',
      Date.now() - pipelineStartedAt,
      projectId,
      result.fileCount,
      allWarnings.length
    )

    return result
  }

  private async persistFiles(
    projectId: string,
    files: GeneratedFile[],
    jobId?: string | number
  ): Promise<Array<{ path: string; size: number }>> {
    const results: Array<{ path: string; size: number }> = []

    for (const file of files) {
      const key = `projects/${projectId}/${file.path}`
      const size = Buffer.byteLength(file.content)

      await r2Client.putObject(key, file.content)

      // Track R2 key for cleanup if jobId is provided
      if (jobId) {
        const { jobTracker } = await import('../../services/redis/queues/job-tracker')
        jobTracker.trackR2Key(jobId, key)
      }

      // Upsert file record in MongoDB
      const existing = (await this.app.service('files').find({
        query: { projectId, key, $limit: 1 }
      })) as any

      if (existing.total > 0) {
        await this.app.service('files').patch(existing.data[0]._id, {
          size,
          updatedAt: Date.now()
        })
      } else {
        await this.app.service('files').create({
          projectId,
          name: file.path,
          key,
          fileType: file.path.split('.').pop() || 'text',
          size
        })
      }

      results.push({ path: file.path, size })
    }

    return results
  }
}
