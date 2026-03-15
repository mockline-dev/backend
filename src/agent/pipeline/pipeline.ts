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

    let project: any
    try {
      project = await this.app.service('projects').get(projectId)
    } catch {
      project = null
    }

    if (project) {
      await this.memory.initialize(projectId, { language: project.language, framework: project.framework })
    }
    await this.memory.recordPrompt(projectId, prompt)
    const memoryData = await this.memory.load(projectId)
    const memoryBlock = this.memory.buildContextBlock(memoryData)

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

    await onProgress('Analyzing prompt', 5)
    const intentStartedAt = Date.now()
    const schema = await this.intentAnalyzer.analyze(prompt)
    logger.info(
      'Pipeline: intent analysis completed in %dms for project %s',
      Date.now() - intentStartedAt,
      projectId
    )

    await onProgress('Validating schema', 10)
    const schemaValidationStartedAt = Date.now()
    const validationResult = this.schemaValidator.validate(schema)
    logger.info(
      'Pipeline: schema validation completed in %dms for project %s',
      Date.now() - schemaValidationStartedAt,
      projectId
    )

    const allWarnings: string[] = []

    if (validationResult.warnings.length > 0) {
      const warningMessages = validationResult.warnings.map(w => `- ${w.field}: ${w.message}`).join('\n')
      logger.warn('Pipeline: Schema validation warnings:\n%s', warningMessages)
      allWarnings.push(...validationResult.warnings.map(w => `Schema: ${w.field} - ${w.message}`))
    }

    if (!validationResult.isValid && validationResult.errors.length > 0) {
      const criticalErrors = validationResult.errors.filter(e => {
        if (e.message.includes('missing') || e.message.includes('Missing')) {
          return false
        }
        if (e.message.includes('relationship') || e.message.includes('Relationship')) {
          return false
        }
        return true
      })

      if (criticalErrors.length > 0) {
        const errorMessages = criticalErrors.map(e => `- ${e.field}: ${e.message}`).join('\n')
        logger.error('Pipeline: Schema validation failed with critical errors:\n%s', errorMessages)
        throw new Error(`Schema validation failed:\n${errorMessages}`)
      } else {
        const warningMessages = validationResult.errors.map(e => `- ${e.field}: ${e.message}`).join('\n')
        logger.warn('Pipeline: Schema validation errors treated as warnings:\n%s', warningMessages)
        allWarnings.push(...validationResult.errors.map(e => `Schema: ${e.field} - ${e.message}`))
      }
    }

    logger.info('Pipeline: Schema validated with %d relationships', validationResult.relationships.length)

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

    const generationStartedAt = Date.now()
    const generatedFiles = await this.fileGenerator.generateAll(
      prompt,
      schema,
      plan,
      async (index, total, filePath) => {
        const percentage = 20 + Math.round((index / total) * 60)
        await onProgress('Generating files', percentage, filePath)

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

    if (crossFileValidation.warnings.length > 0) {
      const warningMessages = crossFileValidation.warnings.map(w => `- ${w.file}: ${w.message}`).join('\n')
      logger.warn('Pipeline: Cross-file validation warnings:\n%s', warningMessages)
      allWarnings.push(...crossFileValidation.warnings.map(w => `Cross-file: ${w.file} - ${w.message}`))
    }

    if (!crossFileValidation.isValid && crossFileValidation.errors.length > 0) {
      const criticalErrors = crossFileValidation.errors.filter(e => {
        if (e.message.includes('not found') || e.message.includes('undefined')) {
          return true
        }
        if (e.message.includes('import') || e.message.includes('Import')) {
          return true
        }
        return true
      })

      if (criticalErrors.length > 0) {
        const errorMessages = criticalErrors.map(e => `- ${e.file}: ${e.message}`).join('\n')
        logger.error('Pipeline: Cross-file validation failed with critical errors:\n%s', errorMessages)
        throw new Error(`Cross-file validation failed:\n${errorMessages}`)
      } else {
        const warningMessages = crossFileValidation.errors.map(e => `- ${e.file}: ${e.message}`).join('\n')
        logger.warn('Pipeline: Cross-file validation errors treated as warnings:\n%s', warningMessages)
        allWarnings.push(...crossFileValidation.errors.map(e => `Cross-file: ${e.file} - ${e.message}`))
      }
    }

    await onProgress('Saving files', 82)
    const persistenceStartedAt = Date.now()
    const persistedFiles = await this.persistFiles(projectId, generatedFiles, jobId)
    logger.info(
      'Pipeline: persistence completed in %dms for project %s',
      Date.now() - persistenceStartedAt,
      projectId
    )

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
      allWarnings.push(`${validationResults.failCount} files failed validation`)
    }

    try {
      await onProgress('Building architecture graph', 95)
      const architectureStartedAt = Date.now()
      const extractor = new ArchitectureExtractor()
      const architectureData = extractor.extract(schema, generatedFiles, validationResult.relationships)
      await this.app.service('architecture').create({
        projectId,
        ...architectureData,
        updatedAt: Date.now()
      })
      logger.info(
        'Pipeline: architecture extraction completed in %dms for project %s',
        Date.now() - architectureStartedAt,
        projectId
      )

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
      allWarnings.push(`Architecture: ${err.message}`)
    }

    await onProgress('Complete', 100)

    const totalSize = persistedFiles.reduce((sum, f) => sum + f.size, 0)

    const result: PipelineResult = {
      files: generatedFiles,
      fileCount: persistedFiles.length,
      totalSize
    }

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
    const failures: string[] = []

    for (const file of files) {
      const key = `projects/${projectId}/${file.path}`
      const size = Buffer.byteLength(file.content)

      try {
        await r2Client.putObject(key, file.content)

        if (jobId) {
          const { jobTracker } = await import('../../services/redis/queues/job-tracker')
          jobTracker.trackR2Key(jobId, key)
        }

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
      } catch (err: any) {
        const message = `persist ${file.path} failed: ${err?.message || 'unknown error'}`
        failures.push(message)
        logger.error('Pipeline: %s', message)
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Pipeline persistence failed for ${failures.length}/${files.length} files. ${failures.slice(0, 3).join('; ')}`
      )
    }

    return results
  }
}
