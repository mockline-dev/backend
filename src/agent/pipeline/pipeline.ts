import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { createPipelineLogger } from '../../pipeline-logger'
import { r2Client } from '../../storage/r2.client'
import { ProjectMemory } from '../memory/project-memory'
import { ContextRetriever } from '../rag/retriever'
import { ApiTestGenerator } from './api-test-generator'
import { ArchitectureExtractor } from './architecture-extractor'
import { ContextBuilder } from './context-builder'
import { CrossFileValidator } from './cross-file-validator'
import { FileGenerator, type GeneratedFile } from './file-generator'
import { IntentAnalyzer } from './intent-analyzer'
import { SchemaValidator } from './schema-validator'
import { TaskPlanner } from './task-planner'
import { renderScaffold } from './template-engine'

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
  warnings?: string[]
}

export class GenerationPipeline {
  private app: Application
  private intentAnalyzer = new IntentAnalyzer()
  private schemaValidator = new SchemaValidator()
  private taskPlanner = new TaskPlanner()
  private fileGenerator = new FileGenerator()
  private crossFileValidator = new CrossFileValidator()
  private contextBuilder = new ContextBuilder()
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
    const runId = String(pipelineStartedAt)

    const loggers = createPipelineLogger(projectId, runId)
    const plog = loggers.pipeline

    try {

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
    try {
      await Promise.race([
        this.retriever.indexProject(projectId),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('RAG indexing timeout')), 15000))
      ])
      plog.info(
        'Pipeline: RAG indexing completed in %dms for project %s',
        Date.now() - ragIndexStartedAt,
        projectId
      )
    } catch (err: any) {
      plog.warn('Pipeline: RAG indexing failed (non-fatal): %s', err.message)
    }

    // Stage 1 — Intent analysis (schema extraction)
    await onProgress('Analyzing prompt', 5)
    const intentStartedAt = Date.now()
    const schema = await this.intentAnalyzer.analyze(prompt, loggers.intent)
    plog.info(
      'Pipeline: intent analysis completed in %dms for project %s',
      Date.now() - intentStartedAt,
      projectId
    )

    // Stage 1.5 — Schema validation (relationship extraction and validation)
    await onProgress('Validating schema', 10)
    const schemaValidationStartedAt = Date.now()
    const validationResult = this.schemaValidator.validate(schema)
    plog.info(
      'Pipeline: schema validation completed in %dms for project %s',
      Date.now() - schemaValidationStartedAt,
      projectId
    )

    // Collect all warnings for later reporting
    const allWarnings: string[] = []

    // Log warnings if any
    if (validationResult.warnings.length > 0) {
      const warningMessages = validationResult.warnings.map(w => `- ${w.field}: ${w.message}`).join('\n')
      plog.warn('Pipeline: Schema validation warnings:\n%s', warningMessages)
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
        plog.error('Pipeline: Schema validation failed with critical errors:\n%s', errorMessages)
        throw new Error(`Schema validation failed:\n${errorMessages}`)
      } else {
        // Treat non-critical errors as warnings
        const warningMessages = validationResult.errors.map(e => `- ${e.field}: ${e.message}`).join('\n')
        plog.warn('Pipeline: Schema validation errors treated as warnings:\n%s', warningMessages)
        allWarnings.push(...validationResult.errors.map(e => `Schema: ${e.field} - ${e.message}`))
      }
    }

    plog.info('Pipeline: Schema validated with %d relationships', validationResult.relationships.length)

    // Stage 2 — Task planning (file structure)
    await onProgress('Planning files', 15)
    const planningStartedAt = Date.now()
    const plan = await this.taskPlanner.plan(prompt, schema, loggers.planning)
    plog.info(
      'Pipeline: task planning completed in %dms for project %s',
      Date.now() - planningStartedAt,
      projectId
    )

    // Build dependency graph and global context
    const dependencyGraph = this.taskPlanner.getDependencyGraph(plan, schema)
    const globalContext = this.contextBuilder.buildGlobalContext(
      plan,
      schema,
      validationResult.relationships,
      dependencyGraph
    )

    plog.debug('Pipeline: built global context for %d files', globalContext.size)

    await this.app.service('projects').patch(projectId, {
      generationProgress: {
        totalFiles: plan.length,
        currentStage: 'planning_files',
        percentage: 15,
        filesGenerated: 0
      }
    } as any)

    // Stage 2 — Scaffold: generate boilerplate files from templates (no LLM)
    await onProgress('Scaffolding templates', 17)
    const scaffoldStartedAt = Date.now()
    let preScaffolded = new Map<string, string>()
    try {
      const scaffoldFiles = renderScaffold(schema)
      preScaffolded = new Map(scaffoldFiles.map(f => [f.path, f.content]))
      plog.info(
        'Pipeline: scaffold completed in %dms — %d template files for project %s',
        Date.now() - scaffoldStartedAt,
        preScaffolded.size,
        projectId
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      plog.warn('Pipeline: scaffold failed (non-fatal, falling back to LLM for all files): %s', msg)
    }

    // Stage 3 — File generation (LLM for non-scaffold files only)
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
      {
        projectId,
        retriever: this.retriever,
        memoryBlock,
        relationships: validationResult.relationships,
        globalContext,
        dependencyGraph,
        contextBuilder: this.contextBuilder,
        plan,
        preScaffolded,
        log: loggers.generation
      }
    )
    plog.info(
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
    plog.info(
      'Pipeline: cross-file validation completed in %dms for project %s',
      Date.now() - crossFileValidationStartedAt,
      projectId
    )

    // Log warnings if any
    if (crossFileValidation.warnings.length > 0) {
      const warningMessages = crossFileValidation.warnings.map(w => `- ${w.file}: ${w.message}`).join('\n')
      plog.warn('Pipeline: Cross-file validation warnings:\n%s', warningMessages)
      allWarnings.push(...crossFileValidation.warnings.map(w => `Cross-file: ${w.file} - ${w.message}`))
    }

    // Only throw on critical cross-file errors
    if (!crossFileValidation.isValid && crossFileValidation.errors.length > 0) {
      const criticalErrors = crossFileValidation.errors.filter(e => {
        // Missing references → non-critical
        if (e.message.includes('not found') || e.message.includes('undefined')) return false
        // Import errors in __init__.py are expected (empty stubs) — silently skip
        const isImportError = e.message.includes('import') || e.message.includes('Import')
        if (isImportError && e.file.endsWith('__init__.py')) return false
        // Import errors in non-__init__.py files are visible but non-blocking
        if (isImportError) return false
        return true
      })

      if (criticalErrors.length > 0) {
        const errorMessages = criticalErrors.map(e => `- ${e.file}: ${e.message}`).join('\n')
        plog.error('Pipeline: Cross-file validation failed with critical errors:\n%s', errorMessages)
        throw new Error(`Cross-file validation failed:\n${errorMessages}`)
      } else {
        // Add non-__init__.py import errors and other non-critical errors to warnings
        const visibleErrors = crossFileValidation.errors.filter(e => {
          const isImportError = e.message.includes('import') || e.message.includes('Import')
          return !(isImportError && e.file.endsWith('__init__.py'))
        })
        if (visibleErrors.length > 0) {
          const warningMessages = visibleErrors.map(e => `- ${e.file}: ${e.message}`).join('\n')
          plog.warn('Pipeline: Cross-file validation errors (non-blocking):\n%s', warningMessages)
          allWarnings.push(...visibleErrors.map(e => `Cross-file: ${e.file} - ${e.message}`))
        }
      }
    }

    // Stage 4 — Persist files to R2 + MongoDB
    await onProgress('Saving files', 82)
    const persistenceStartedAt = Date.now()
    const persistedFiles = await this.persistFiles(projectId, generatedFiles, jobId)
    plog.info(
      'Pipeline: persistence completed in %dms for project %s',
      Date.now() - persistenceStartedAt,
      projectId
    )

    // Stage 6 — Extract architecture metadata (Stage 5 validation runs as separate async BullMQ job)
    try {
      await onProgress('Building architecture graph', 95)
      const architectureStartedAt = Date.now()
      const extractor = new ArchitectureExtractor()
      const architectureData = extractor.extract(schema, generatedFiles, validationResult.relationships)

      // Upsert architecture: patch if exists, create if not
      const existingArch = (await this.app.service('architecture').find({
        query: { projectId, $limit: 1 }
      })) as any
      if (existingArch.total > 0) {
        await this.app.service('architecture').patch(existingArch.data[0]._id, {
          ...architectureData,
          updatedAt: Date.now()
        } as any)
      } else {
        await this.app.service('architecture').create({
          projectId,
          ...architectureData,
          updatedAt: Date.now()
        } as any)
      }
      plog.info(
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

      // Stage 7 — Generate API test collection (~97% progress)
      try {
        await onProgress('Generating API tests', 97)
        const testGenerator = new ApiTestGenerator()
        const testCollection = testGenerator.generate(schema, architectureData, validationResult.relationships)
        const testJson = JSON.stringify(testCollection, null, 2)
        const testKey = `projects/${projectId}/api-tests.json`
        await r2Client.putObject(testKey, testJson)

        // Upsert api-tests.json file record in MongoDB
        const existingTestFile = (await this.app.service('files').find({
          query: { projectId, key: testKey, $limit: 1 }
        })) as any
        if (existingTestFile.total > 0) {
          await this.app.service('files').patch(existingTestFile.data[0]._id, {
            size: Buffer.byteLength(testJson),
            updatedAt: Date.now()
          })
        } else {
          await this.app.service('files').create({
            projectId,
            name: 'api-tests.json',
            key: testKey,
            fileType: 'json',
            size: Buffer.byteLength(testJson)
          })
        }

        plog.info('Pipeline: API test collection generated for project %s (%d groups)', projectId, testCollection.groups.length)
      } catch (testErr: any) {
        plog.warn('Pipeline: API test generation failed (non-fatal): %s', testErr.message)
      }
    } catch (err: any) {
      plog.warn('Pipeline: architecture extraction failed (non-fatal): %s', err.message)
    }

    await onProgress('Complete', 100)

    const totalSize = persistedFiles.reduce((sum, f) => sum + f.size, 0)

    // Include warnings in the result
    const result: PipelineResult = {
      files: generatedFiles,
      fileCount: persistedFiles.length,
      totalSize,
      warnings: allWarnings.length > 0 ? allWarnings : undefined
    }

    plog.info(
      'Pipeline: completed in %dms for project %s (files=%d, warnings=%d)',
      Date.now() - pipelineStartedAt,
      projectId,
      result.fileCount,
      allWarnings.length
    )

    return result
    } finally {
      loggers.close()
    }
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
