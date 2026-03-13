import type { Application } from '../../declarations'
import { logger } from '../../logger'
import { r2Client } from '../../storage/r2.client'
import { ProjectMemory } from '../memory/project-memory'
import { ContextRetriever } from '../rag/retriever'
import { validateGeneratedFiles } from '../validation/validator'
import { ArchitectureExtractor } from './architecture-extractor'
import { FileGenerator, type GeneratedFile } from './file-generator'
import { IntentAnalyzer } from './intent-analyzer'
import { TaskPlanner } from './task-planner'

export interface PipelineOptions {
  projectId: string
  prompt: string
  userId: string
  onProgress: (stage: string, percentage: number, currentFile?: string) => Promise<void>
}

export interface PipelineResult {
  files: GeneratedFile[]
  fileCount: number
  totalSize: number
}

export class GenerationPipeline {
  private app: Application
  private intentAnalyzer = new IntentAnalyzer()
  private taskPlanner = new TaskPlanner()
  private fileGenerator = new FileGenerator()
  private memory: ProjectMemory
  private retriever: ContextRetriever

  constructor(app: Application) {
    this.app = app
    this.memory = new ProjectMemory(app)
    this.retriever = new ContextRetriever(app)
  }

  async run(options: PipelineOptions): Promise<PipelineResult> {
    const { projectId, prompt, onProgress } = options

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
    try {
      await this.retriever.indexProject(projectId)
    } catch (err: any) {
      logger.warn('Pipeline: RAG indexing failed (non-fatal): %s', err.message)
    }

    // Stage 1 — Intent analysis (schema extraction)
    await onProgress('Analyzing prompt', 5)
    const schema = await this.intentAnalyzer.analyze(prompt)

    // Stage 2 — Task planning (file structure)
    await onProgress('Planning files', 15)
    const plan = await this.taskPlanner.plan(prompt, schema)

    await this.app.service('projects').patch(projectId, {
      generationProgress: {
        totalFiles: plan.length,
        currentStage: 'planning_files',
        percentage: 15,
        filesGenerated: 0
      }
    } as any)

    // Stage 3 — File generation
    const generatedFiles = await this.fileGenerator.generateAll(
      prompt,
      schema,
      plan,
      async (index, total, filePath) => {
        const percentage = 20 + Math.round((index / total) * 60)
        await onProgress('Generating files', percentage, filePath)
      },
      { projectId, retriever: this.retriever, memoryBlock }
    )

    // Stage 4 — Persist files to R2 + MongoDB
    await onProgress('Saving files', 82)
    const persistedFiles = await this.persistFiles(projectId, generatedFiles)

    // Stage 5 — Validate generated files
    await onProgress('Validating', 90)
    const validationResults = await validateGeneratedFiles(generatedFiles, projectId, this.app, onProgress)
    if (validationResults.failCount > 0) {
      logger.warn(
        'Pipeline: %d/%d files failed validation for project %s',
        validationResults.failCount,
        generatedFiles.length,
        projectId
      )
    }

    // Stage 6 — Extract architecture metadata
    try {
      await onProgress('Building architecture graph', 95)
      const extractor = new ArchitectureExtractor()
      const architectureData = extractor.extract(schema, generatedFiles)
      await this.app.service('architecture').create({
        projectId,
        ...architectureData,
        updatedAt: Date.now()
      } as any)

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
    return { files: generatedFiles, fileCount: persistedFiles.length, totalSize }
  }

  private async persistFiles(
    projectId: string,
    files: GeneratedFile[]
  ): Promise<Array<{ path: string; size: number }>> {
    const results: Array<{ path: string; size: number }> = []

    for (const file of files) {
      const key = `projects/${projectId}/${file.path}`
      const size = Buffer.byteLength(file.content)

      await r2Client.putObject(key, file.content)

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
