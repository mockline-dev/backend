import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { r2Client } from '../../storage/r2.client'
import { ProjectMemory } from '../memory/project-memory'
import { ContextRetriever } from '../rag/retriever'
import { getWeaviateRetriever, type RetrievedContext } from '../rag/weaviate'
import { validateGeneratedFiles } from '../validation/validator'
import { ArchitectureExtractor } from './architecture-extractor'
import { CriticalFilesValidator } from './critical-files-validator'
import { CrossFileValidator } from './cross-file-validator'
import { FileGenerator, type GeneratedFile } from './file-generator'
import { IntentAnalyzer, type IntentSchema } from './intent-analyzer'
import { PROGRESS_STAGES } from './pipeline.constants'
import type { PersistedFileInfo, PipelineOptions, PipelineResult, ProjectData } from './pipeline.types'
import {
  filterValidationErrors,
  handleValidationErrors,
  logValidationWarnings,
  validateFileContent
} from './pipeline.utils'
import { SchemaValidator } from './schema-validator'
import { TaskPlanner, type TaskPlan } from './task-planner'

export class GenerationPipeline {
  private app: Application
  private intentAnalyzer = new IntentAnalyzer()
  private schemaValidator = new SchemaValidator()
  private taskPlanner = new TaskPlanner()
  private fileGenerator = new FileGenerator()
  private crossFileValidator = new CrossFileValidator()
  private criticalFilesValidator = new CriticalFilesValidator()
  private memory: ProjectMemory
  private retriever: ContextRetriever
  private weaviateEnabled: boolean = false
  private allWarnings: string[] = []

  constructor(app: Application) {
    this.app = app
    this.memory = new ProjectMemory(app)
    this.retriever = new ContextRetriever(app)

    // Check if Weaviate is enabled
    try {
      const config = (app as any).get('weaviate')
      this.weaviateEnabled = config?.enabled ?? false
      if (this.weaviateEnabled) {
        logger.info('Weaviate retriever enabled in pipeline')
      }
    } catch (error) {
      logger.debug('Weaviate not configured, using fallback retriever')
    }
  }

  async run(options: PipelineOptions): Promise<PipelineResult> {
    const { projectId, prompt, userId, onProgress, jobId, stackId } = options
    const pipelineStartedAt = Date.now()

    // Stage 0 — Load project info, initialize memory, index existing files
    const project = await this.loadProject(projectId)

    // Initialize memory if it doesn't exist yet, then record this prompt
    if (project) {
      await this.memory.initialize(projectId, {
        language: project.language,
        framework: project.framework
      })
    }
    await this.memory.recordPrompt(projectId, prompt)
    const memoryData = await this.memory.load(projectId)
    const memoryBlock = this.memory.buildContextBlock(memoryData)

    // Index any pre-existing project files into RAG store so generators have context
    this.indexProjectFiles(projectId)

    // Stage 1 — Intent analysis (schema extraction)
    await onProgress('Analyzing prompt', PROGRESS_STAGES.INTENT_ANALYSIS)
    const schema = await this.analyzeIntent(prompt, projectId, stackId)

    // Stage 1.5 — Schema validation (relationship extraction and validation)
    await onProgress('Validating schema', PROGRESS_STAGES.SCHEMA_VALIDATION)
    const validationResult = this.validateSchema(schema, projectId)

    // Stage 2 — Task planning (file structure)
    await onProgress('Planning files', PROGRESS_STAGES.TASK_PLANNING)
    const plan = await this.planFiles(prompt, schema, projectId)
    await this.updateProjectProgress(projectId, userId, plan)

    // Stage 3 — File generation
    const generatedFiles = await this.generateFiles(
      prompt,
      schema,
      plan,
      projectId,
      jobId,
      onProgress,
      memoryBlock,
      validationResult.relationships,
      stackId
    )

    // Stage 3.5 — Validate critical files are present
    await onProgress('Validating file structure', PROGRESS_STAGES.FILE_STRUCTURE_VALIDATION)
    this.validateCriticalFilesStructure(generatedFiles)

    // Stage 3.5 — Cross-file validation
    await onProgress('Validating cross-file dependencies', PROGRESS_STAGES.CROSS_FILE_VALIDATION)
    this.validateCrossFiles(generatedFiles, schema, validationResult)

    // Stage 4 — Validate files before persistence
    await onProgress('Validating files before save', PROGRESS_STAGES.VALIDATION_BEFORE_PERSISTENCE)
    const validFiles = this.validateFilesBeforePersistence(generatedFiles, projectId)

    // Stage 4.5 — Persist files to R2 + MongoDB
    await onProgress('Saving files', PROGRESS_STAGES.SAVING_FILES)
    const persistedFiles = await this.persistFiles(projectId, validFiles, userId, jobId)

    // Stage 5 — Validate generated files
    await onProgress('Validating', PROGRESS_STAGES.FINAL_VALIDATION)
    await this.validateGeneratedFiles(generatedFiles, projectId, onProgress, stackId)

    // Stage 6 — Extract architecture metadata (CRITICAL - must succeed)
    await onProgress('Building architecture graph', PROGRESS_STAGES.ARCHITECTURE_EXTRACTION)
    const architectureId = await this.extractAndSaveArchitecture(
      schema,
      generatedFiles,
      validationResult.relationships,
      projectId,
      userId
    )

    await onProgress('Complete', PROGRESS_STAGES.COMPLETE)

    const totalSize = persistedFiles.reduce((sum, f) => sum + f.size, 0)

    const result: PipelineResult = {
      files: generatedFiles,
      fileCount: persistedFiles.length,
      totalSize,
      architectureId
    }

    // Attach warnings to result if any
    if (this.allWarnings.length > 0) {
      result.warnings = this.allWarnings
    }

    logger.info(
      'Pipeline: completed in %dms for project %s (files=%d, warnings=%d)',
      Date.now() - pipelineStartedAt,
      projectId,
      result.fileCount,
      this.allWarnings.length
    )

    return result
  }

  /**
   * Loads project data from database
   */
  private async loadProject(projectId: string): Promise<ProjectData> {
    try {
      const project = await this.app.service('projects').get(projectId)
      return project as ProjectData
    } catch (error) {
      logger.warn('Pipeline: Failed to load project %s: %s', projectId, error)
      return null
    }
  }

  /**
   * Indexes project files into RAG store (non-blocking)
   */
  private indexProjectFiles(projectId: string): void {
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
      .catch((error: Error) => {
        logger.warn('Pipeline: RAG indexing failed (non-fatal): %s', error.message)
      })
  }

  /**
   * Analyzes user intent and extracts schema
   */
  private async analyzeIntent(prompt: string, projectId: string, stackId?: string): Promise<IntentSchema> {
    const intentStartedAt = Date.now()
    const schema = await this.intentAnalyzer.analyze(prompt, stackId)
    logger.info(
      'Pipeline: intent analysis completed in %dms for project %s',
      Date.now() - intentStartedAt,
      projectId
    )
    return schema
  }

  /**
   * Validates extracted schema
   */
  private validateSchema(schema: IntentSchema, projectId: string): ReturnType<SchemaValidator['validate']> {
    const schemaValidationStartedAt = Date.now()
    const validationResult = this.schemaValidator.validate(schema)

    logger.info(
      'Pipeline: schema validation completed in %dms for project %s',
      Date.now() - schemaValidationStartedAt,
      projectId
    )

    // Collect all warnings for later reporting
    this.allWarnings = []

    // Log warnings if any
    if (validationResult.warnings.length > 0) {
      const warningMessages = logValidationWarnings(validationResult.warnings, 'Schema')
      this.allWarnings.push(...warningMessages)
    }

    // Handle validation errors
    if (!validationResult.isValid && validationResult.errors.length > 0) {
      handleValidationErrors(validationResult, 'Schema')
      // Add non-critical errors as warnings
      const { warnings } = filterValidationErrors(validationResult.errors)
      this.allWarnings.push(...warnings.map(e => `Schema: ${e.field} - ${e.message}`))
    }

    logger.info('Pipeline: Schema validated with %d relationships', validationResult.relationships.length)

    return validationResult
  }

  /**
   * Plans file structure for project
   */
  private async planFiles(prompt: string, schema: IntentSchema, projectId: string): Promise<TaskPlan[]> {
    const planningStartedAt = Date.now()
    const plan = await this.taskPlanner.plan(prompt, schema)
    logger.info(
      'Pipeline: task planning completed in %dms for project %s',
      Date.now() - planningStartedAt,
      projectId
    )
    return plan
  }

  /**
   * Updates project progress in database
   */
  private async updateProjectProgress(projectId: string, userId: string, plan: TaskPlan[]): Promise<void> {
    await this.app.service('projects').patch(projectId, {
      generationProgress: {
        totalFiles: plan.length,
        currentStage: 'planning_files',
        percentage: PROGRESS_STAGES.TASK_PLANNING,
        filesGenerated: 0
      }
    })
  }

  /**
   * Generates all files for project
   */
  private async generateFiles(
    prompt: string,
    schema: IntentSchema,
    plan: TaskPlan[],
    projectId: string,
    jobId: string | number | undefined,
    onProgress: PipelineOptions['onProgress'],
    memoryBlock: string,
    relationships: ReturnType<SchemaValidator['validate']>['relationships'],
    stackId?: string
  ): Promise<GeneratedFile[]> {
    const generationStartedAt = Date.now()

    // Retrieve context from Weaviate if enabled
    let ragContext: RetrievedContext | null = null
    if (this.weaviateEnabled) {
      try {
        const weaviateRetriever = getWeaviateRetriever()
        ragContext = await weaviateRetriever.retrieveContext(prompt, {
          topK: 5,
          includeFiles: true,
          includeCodeSnippets: true,
          includeDocumentation: true,
          includeConversations: true,
          includeSimilarProjects: true,
          filters: { projectId },
          minScore: 0.5,
          enableReRanking: true
        })

        const stats = weaviateRetriever.getRetrievalStats(ragContext)
        logger.info(
          'Pipeline: retrieved %d items from Weaviate (avg score=%.3f)',
          stats.totalItems,
          stats.averageScore
        )
      } catch (error: any) {
        logger.warn('Pipeline: Weaviate retrieval failed, continuing without RAG: %s', error.message)
      }
    }

    const generatedFiles = await this.fileGenerator.generateAll(
      prompt,
      schema,
      plan,
      async (index, total, filePath) => {
        const percentage =
          PROGRESS_STAGES.FILE_GENERATION_START +
          Math.round(
            (index / total) * (PROGRESS_STAGES.FILE_GENERATION_END - PROGRESS_STAGES.FILE_GENERATION_START)
          )
        await onProgress('Generating files', percentage, filePath)

        // Track generated files for cleanup
        if (jobId) {
          const { jobTracker } = await import('../../services/redis/queues/job-tracker')
          jobTracker.trackGeneratedFile(jobId, { path: filePath })
        }
      },
      { projectId, retriever: this.retriever, memoryBlock, relationships, stackId, ragContext }
    )

    logger.info(
      'Pipeline: file generation completed in %dms for project %s (%d files)',
      Date.now() - generationStartedAt,
      projectId,
      generatedFiles.length
    )

    return generatedFiles
  }

  /**
   * Validates that critical files are present and properly structured
   */
  private validateCriticalFilesStructure(generatedFiles: GeneratedFile[]): void {
    const validationStartedAt = Date.now()
    const { warnings } = this.criticalFilesValidator.validate(generatedFiles)
    this.allWarnings.push(...warnings)

    logger.info('Pipeline: file structure validation completed in %dms', Date.now() - validationStartedAt)
  }

  /**
   * Validates cross-file dependencies and references
   */
  private validateCrossFiles(
    generatedFiles: GeneratedFile[],
    schema: IntentSchema,
    validationResult: ReturnType<SchemaValidator['validate']>
  ): void {
    const crossFileValidationStartedAt = Date.now()
    const crossFileValidation = this.crossFileValidator.validate(
      generatedFiles,
      schema,
      validationResult.relationships
    )

    logger.info(
      'Pipeline: cross-file validation completed in %dms',
      Date.now() - crossFileValidationStartedAt
    )

    // Log warnings if any
    if (crossFileValidation.warnings.length > 0) {
      const warningMessages = crossFileValidation.warnings.map(w => `- ${w.file}: ${w.message}`).join('\n')
      logger.warn('Pipeline: Cross-file validation warnings:\n%s', warningMessages)
      this.allWarnings.push(...crossFileValidation.warnings.map(w => `Cross-file: ${w.file} - ${w.message}`))
    }

    // Handle validation errors
    if (!crossFileValidation.isValid && crossFileValidation.errors.length > 0) {
      // Filter critical errors for cross-file validation
      const criticalErrors = crossFileValidation.errors.filter(e => e.severity === 'error')
      if (criticalErrors.length > 0) {
        const errorMessages = criticalErrors.map(e => `- ${e.file}: ${e.message}`).join('\n')
        logger.error('Pipeline: Cross-file validation failed with critical errors:\n%s', errorMessages)
        throw new Error(`Cross-file validation failed:\n${errorMessages}`)
      } else {
        // Treat non-critical errors as warnings
        this.allWarnings.push(...crossFileValidation.errors.map(e => `Cross-file: ${e.file} - ${e.message}`))
      }
    }
  }

  /**
   * Validates file contents before persistence
   */
  private validateFilesBeforePersistence(
    generatedFiles: GeneratedFile[],
    projectId: string
  ): GeneratedFile[] {
    const validationBeforePersistenceStartedAt = Date.now()

    const validFiles = generatedFiles.filter(file => {
      const validation = validateFileContent(file)
      if (!validation.isValid) {
        logger.warn('Pipeline: skipping invalid file %s: %s', file.path, validation.reason)
        return false
      }
      return true
    })

    logger.info(
      'Pipeline: validation before persistence completed in %dms for project %s (valid=%d, invalid=%d)',
      Date.now() - validationBeforePersistenceStartedAt,
      projectId,
      validFiles.length,
      generatedFiles.length - validFiles.length
    )

    return validFiles
  }

  /**
   * Validates generated files using external validators
   */
  private async validateGeneratedFiles(
    generatedFiles: GeneratedFile[],
    projectId: string,
    onProgress: PipelineOptions['onProgress'],
    stackId?: string
  ): Promise<void> {
    const fileValidationStartedAt = Date.now()
    const validationResults = await validateGeneratedFiles(
      generatedFiles,
      projectId,
      this.app,
      onProgress,
      stackId
    )

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
      this.allWarnings.push(`${validationResults.failCount} files failed validation`)
    }
  }

  /**
   * Extracts and saves architecture metadata
   */
  private async extractAndSaveArchitecture(
    schema: IntentSchema,
    generatedFiles: GeneratedFile[],
    relationships: ReturnType<SchemaValidator['validate']>['relationships'],
    projectId: string,
    userId: string
  ): Promise<string> {
    const architectureStartedAt = Date.now()

    logger.info('Pipeline: starting architecture extraction for project %s', projectId)

    const extractor = new ArchitectureExtractor()
    const architectureData = extractor.extract(schema, generatedFiles, relationships)

    // Validate architecture data structure before saving
    this.validateArchitectureData(architectureData)

    logger.info(
      'Pipeline: architecture extracted with %d services, %d models, %d relations, %d routes for project %s',
      architectureData.services.length,
      architectureData.models.length,
      architectureData.relations.length,
      architectureData.routes.length,
      projectId
    )

    const architectureRecord = await this.app.service('architecture').create({
      projectId,
      ...architectureData,
      updatedAt: Date.now()
    })

    logger.info(
      'Pipeline: architecture extraction completed in %dms for project %s (architectureId: %s)',
      Date.now() - architectureStartedAt,
      projectId,
      architectureRecord._id?.toString()
    )

    // Persist architecture decisions into project memory
    const decisions: string[] = [
      ...(architectureData.services ?? []).map(s => `Service: ${s.name}`),
      ...(architectureData.relations ?? []).map(r => `Relation: ${r.from} → ${r.to} (${r.type})`)
    ]
    if (decisions.length) {
      await this.memory.recordDecisions(projectId, decisions)
    }

    return architectureRecord._id?.toString() ?? ''
  }

  /**
   * Validates architecture data structure
   */
  private validateArchitectureData(architectureData: ReturnType<ArchitectureExtractor['extract']>): void {
    if (!architectureData.services || !Array.isArray(architectureData.services)) {
      throw new Error('Architecture extraction failed: services array is missing or invalid')
    }
    if (!architectureData.models || !Array.isArray(architectureData.models)) {
      throw new Error('Architecture extraction failed: models array is missing or invalid')
    }
    if (!architectureData.relations || !Array.isArray(architectureData.relations)) {
      throw new Error('Architecture extraction failed: relations array is missing or invalid')
    }
    if (!architectureData.routes || !Array.isArray(architectureData.routes)) {
      throw new Error('Architecture extraction failed: routes array is missing or invalid')
    }
  }

  /**
   * Persists files to R2 and MongoDB
   */
  private async persistFiles(
    projectId: string,
    files: GeneratedFile[],
    userId: string,
    jobId?: string | number
  ): Promise<PersistedFileInfo[]> {
    const persistenceStartedAt = Date.now()

    // Upload all files to R2 in parallel
    const uploadResults = await this.uploadFilesToR2(projectId, files, jobId)

    // Upsert file records in MongoDB in parallel
    const dbResults = await this.upsertFileRecords(projectId, uploadResults, userId)

    logger.info(
      'Pipeline: persistence completed in %dms for project %s',
      Date.now() - persistenceStartedAt,
      projectId
    )

    return dbResults
  }

  /**
   * Uploads files to R2 storage
   */
  private async uploadFilesToR2(
    projectId: string,
    files: GeneratedFile[],
    jobId?: string | number
  ): Promise<Array<{ path: string; size: number; key: string }>> {
    const uploadPromises = files.map(async file => {
      const key = `projects/${projectId}/${file.path}`
      const size = Buffer.byteLength(file.content)

      await r2Client.putObject(key, file.content)

      // Track R2 key for cleanup if jobId is provided
      if (jobId) {
        const { jobTracker } = await import('../../services/redis/queues/job-tracker')
        jobTracker.trackR2Key(jobId, key)
      }

      return { path: file.path, size, key }
    })

    return Promise.all(uploadPromises)
  }

  /**
   * Upserts file records in MongoDB
   */
  private async upsertFileRecords(
    projectId: string,
    uploadResults: Array<{ path: string; size: number; key: string }>,
    userId: string
  ): Promise<PersistedFileInfo[]> {
    const dbPromises = uploadResults.map(async ({ path, size, key }) => {
      // Check if file already exists
      const existing = await this.app.service('files').find({
        query: { projectId, key, $limit: 1 }
      })

      if (existing.total > 0) {
        await this.app.service('files').patch(String(existing.data[0]._id), {
          size,
          updatedAt: Date.now()
        })
      } else {
        await this.app.service('files').create({
          projectId,
          name: path,
          key,
          fileType: path.split('.').pop() || 'text',
          size
        })
      }

      return { path, size }
    })

    return Promise.all(dbPromises)
  }
}
