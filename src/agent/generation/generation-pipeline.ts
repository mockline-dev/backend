import type { GeneratedFile, ProjectPlan } from '../../types'
import type { OllamaClient } from '../../llm/client'
import { logger } from '../../logger'

import { planFiles } from './file-planner'
import { topologicalSort } from './dependency-graph'
import { resolveAvailableImports } from './import-resolver'
import { generateFile, selectExample } from './file-generator'
import { TemplateEngine } from './template-engine'
import {
  SERVICE_EXAMPLE,
  ROUTE_EXAMPLE,
  AUTH_ROUTE_EXAMPLE,
  TEST_EXAMPLE,
} from './few-shot-examples'
import type { TreeSitterIndexer } from '../context/tree-sitter-indexer'
import type { ChromaClient } from '../context/chroma-client'

// ─── Progress callback ────────────────────────────────────────────────────────

export type ProgressCallback = (step: string, detail: string) => void

// ─── Pipeline options ─────────────────────────────────────────────────────────

export interface GenerationPipelineOptions {
  /** Project ID — required for indexing */
  projectId?: string
  /** If provided, each generated .py file is indexed after generation */
  indexer?: TreeSitterIndexer
  /** If provided, all files are indexed into ChromaDB after pipeline completes */
  chromaClient?: ChromaClient
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Orchestrates template scaffolding + ordered LLM generation for a full project.
 *
 * Flow:
 *   1. Compute file plan (template + LLM files, dependency graph)
 *   2. Render all template files
 *   3. Topologically sort LLM files
 *   4. Generate each LLM file in order, building the generatedFiles map as we go
 *   5. (Optional) Index generated files into TreeSitterIndexer + ChromaDB
 *   6. Return all GeneratedFile records
 */
export async function executeGenerationPipeline(
  client: OllamaClient,
  plan: ProjectPlan,
  onProgress: ProgressCallback,
  options: GenerationPipelineOptions = {}
): Promise<GeneratedFile[]> {
  const { projectId, indexer, chromaClient } = options
  const examples = {
    service: SERVICE_EXAMPLE,
    route: ROUTE_EXAMPLE,
    authRoute: AUTH_ROUTE_EXAMPLE,
    test: TEST_EXAMPLE,
  }

  // ── Step 1: File plan ──────────────────────────────────────────────────────
  onProgress('planning', 'Computing file plan...')
  const filePlan = planFiles(plan)
  logger.info(
    'GenerationPipeline: %d template files, %d LLM files',
    filePlan.templateFiles.length,
    filePlan.llmFiles.length
  )

  // ── Step 2: Template scaffolding ───────────────────────────────────────────
  onProgress('scaffolding', 'Generating template files...')
  const templateEngine = new TemplateEngine()
  const templateFiles = templateEngine.renderProject(plan)

  for (const file of templateFiles) {
    onProgress('scaffolded', `Scaffolded: ${file.path}`)
  }
  logger.info('GenerationPipeline: scaffolded %d template files', templateFiles.length)

  // ── Step 3: Build generatedFiles map from template output ──────────────────
  const generatedFiles = new Map<string, string>(
    templateFiles.map(f => [f.path, f.content])
  )

  // ── Step 4: Topological sort ───────────────────────────────────────────────
  onProgress('sorting', 'Computing generation order...')
  const orderedLLMFiles = topologicalSort(filePlan.llmFiles)
  logger.info(
    'GenerationPipeline: generation order: %s',
    orderedLLMFiles.map(f => f.outputPath).join(', ')
  )

  // Project paths for import validation
  const projectPaths = filePlan.allPaths

  // ── Step 5: LLM file generation ────────────────────────────────────────────
  const llmGeneratedFiles: GeneratedFile[] = []

  for (const fileSpec of orderedLLMFiles) {
    onProgress('generating', `Generating: ${fileSpec.outputPath}`)

    const availableImports = resolveAvailableImports(
      fileSpec.outputPath,
      plan,
      generatedFiles
    )
    const example = selectExample(fileSpec.outputPath, examples)

    const content = await generateFile(
      client,
      fileSpec,
      plan,
      availableImports,
      example,
      projectPaths
    )

    generatedFiles.set(fileSpec.outputPath, content)
    llmGeneratedFiles.push({
      path: fileSpec.outputPath,
      content,
      source: 'llm',
      validated: false,
    })

    // Index file into TreeSitterIndexer immediately after generation
    if (indexer && projectId && fileSpec.outputPath.endsWith('.py')) {
      indexer.indexFile(projectId, fileSpec.outputPath, content)
    }

    onProgress('generated', `✓ ${fileSpec.outputPath}`)
    logger.info('GenerationPipeline: generated %s', fileSpec.outputPath)
  }

  // ── Step 6: Combine and return ─────────────────────────────────────────────
  const allFiles: GeneratedFile[] = [...templateFiles, ...llmGeneratedFiles]
  logger.info(
    'GenerationPipeline: complete — %d total files (%d template, %d LLM)',
    allFiles.length,
    templateFiles.length,
    llmGeneratedFiles.length
  )

  // ── Step 7: Index all files into context systems ───────────────────────────
  if (projectId && indexer) {
    indexer.indexProject(projectId, allFiles)
  }
  if (projectId && chromaClient) {
    chromaClient.indexProject(projectId, allFiles, indexer ?? null).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('GenerationPipeline: ChromaDB indexing failed: %s', msg)
    })
  }

  return allFiles
}
