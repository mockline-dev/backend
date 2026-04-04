import type { GeneratedFile, ProjectPlan } from '../../types'
import { logger } from '../../logger'

import { TemplateEngine } from './template-engine'
import { applyFeatures } from './feature-applicator'
import type { FeatureSummaryEntry } from './feature-applicator'
import { buildSlotsForPlan, MAX_SLOTS_PER_PROJECT } from './slot-definitions'
import { executeSlot } from './slot-caller'
import { checkFileConsistency } from './file-consistency-checker'
import type { TreeSitterIndexer } from '../context/tree-sitter-indexer'
import type { ChromaClient } from '../context/chroma-client'
import type { OllamaClient } from '../../llm/client'

// ─── Progress callback ────────────────────────────────────────────────────────

export type ProgressCallback = (step: string, detail: string) => void

// ─── Pipeline options ─────────────────────────────────────────────────────────

export interface GenerationPipelineOptions {
  /** Project ID — required for indexing */
  projectId?: string
  /** If provided, all .py files are indexed after generation */
  indexer?: TreeSitterIndexer
  /** If provided, all files are indexed into ChromaDB after pipeline completes */
  chromaClient?: ChromaClient
  /**
   * If provided, used for LLM slot enhancement calls.
   * If null/undefined, slot enhancement is skipped entirely.
   */
  llmClient?: OllamaClient | null
}

// ─── Summary types ────────────────────────────────────────────────────────────

export interface EntityEnhancementSummary {
  name: string
  features: string[]
  enhancementsApplied: string[]
  enhancementsFailed: string[]
}

export interface GenerationSummary {
  totalFiles: number
  templateGenerated: number
  enhancedFiles: number
  slotEnhanced: number
  slotDefaulted: number
  entities: EntityEnhancementSummary[]
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Generation pipeline:
 *
 *   1. Render ALL files from Handlebars templates (zero LLM calls)
 *   2. Apply deterministic feature enhancements (soft-delete, slug, search)
 *   3. (Optional) Execute LLM slot calls for custom entity features
 *      — each slot: one attempt, success-or-default, no retry loop
 *      — capped at MAX_SLOTS_PER_PROJECT (10)
 *   4. Index generated files into TreeSitter + ChromaDB if configured
 *   5. Return files + GenerationSummary
 */
export async function executeGenerationPipeline(
  _clientArg: unknown,
  plan: ProjectPlan,
  onProgress: ProgressCallback,
  options: GenerationPipelineOptions = {}
): Promise<{ files: GeneratedFile[]; summary: GenerationSummary }> {
  const { projectId, indexer, chromaClient, llmClient } = options

  // ── Step 1: Template rendering ─────────────────────────────────────────────
  onProgress('scaffolding', 'Rendering all project files from templates...')

  const templateEngine = new TemplateEngine()
  let files = templateEngine.renderProject(plan)
  const templateCount = files.length

  for (const file of files) {
    onProgress('scaffolded', `Rendered: ${file.path}`)
  }

  // ── Step 2: Deterministic feature enhancements ─────────────────────────────
  const { files: enhancedFiles, summary: featureSummary } = applyFeatures(plan, files)
  files = enhancedFiles

  const deterministicModified = new Set<string>()
  if (featureSummary.length > 0) {
    const totalApplied = featureSummary.reduce((n, s) => n + s.featuresApplied.length, 0)
    logger.info(
      'GenerationPipeline: applied %d deterministic feature(s) across %d entity/entities',
      totalApplied,
      featureSummary.length
    )
    for (const entry of featureSummary) {
      for (const path of entry.filesModified) deterministicModified.add(path)
      onProgress('enhanced', `${entry.entity}: applied [${entry.featuresApplied.join(', ')}]`)
    }
  }

  // ── Step 2b: Cross-file consistency check ──────────────────────────────────
  const { files: consistentFiles, corrections } = checkFileConsistency(files)
  files = consistentFiles
  if (corrections.length > 0) {
    onProgress('consistency', `Applied ${corrections.length} consistency correction(s)`)
  }

  // ── Step 3: LLM slot enhancement (optional, custom features only) ──────────
  let slotEnhanced = 0
  let slotDefaulted = 0

  if (llmClient) {
    const fileMap = new Map<string, string>(files.map(f => [f.path, f.content]))
    const slots = buildSlotsForPlan(plan, fileMap)

    if (slots.length > 0) {
      const entityCount = new Set(slots.map(s => s.entityName)).size
      logger.info(
        'GenerationPipeline: enhancing %d slot(s) across %d entity/entities (max %d)',
        slots.length,
        entityCount,
        MAX_SLOTS_PER_PROJECT
      )
      onProgress(
        'enhancing',
        `Starting ${slots.length} LLM enhancement(s) across ${entityCount} entity/entities`
      )

      for (const slot of slots) {
        onProgress('enhancing', `Enhancing ${slot.entityName}: ${slot.feature}`)
        const result = await executeSlot(slot, llmClient)

        if (result.strategy === 'enhanced' && result.code) {
          const currentContent = fileMap.get(slot.filePath) ?? ''
          const snakeName = slot.entityName.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase()
          const instanceLine = `\ncrud_${snakeName} = CRUD${slot.entityName}(`
          let updatedContent: string
          if (currentContent.includes(instanceLine)) {
            const idx = currentContent.lastIndexOf(instanceLine)
            updatedContent = currentContent.slice(0, idx) + '\n' + result.code + currentContent.slice(idx)
          } else {
            updatedContent = currentContent + '\n' + result.code + '\n'
          }
          fileMap.set(slot.filePath, updatedContent)
          slotEnhanced++
          onProgress('enhanced', `${slot.entityName}/${slot.feature}: LLM-enhanced`)
        } else {
          slotDefaulted++
          onProgress(
            'enhanced',
            `${slot.entityName}/${slot.feature}: standard template (${result.reason})`
          )
        }
      }

      // Rebuild files with slot modifications
      files = files.map(f => {
        const updated = fileMap.get(f.path)
        return updated !== undefined && updated !== f.content ? { ...f, content: updated } : f
      })

      logger.info(
        'GenerationPipeline: slot enhancement complete — %d enhanced, %d defaulted',
        slotEnhanced,
        slotDefaulted
      )
    }
  }

  logger.info('GenerationPipeline: %d files ready for "%s"', files.length, plan.projectName)

  // ── Step 4: Index generated files ─────────────────────────────────────────
  if (projectId && indexer) {
    for (const file of files) {
      if (file.path.endsWith('.py')) {
        indexer.indexFile(projectId, file.path, file.content)
      }
    }
  }
  if (projectId && chromaClient) {
    chromaClient.indexProject(projectId, files).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('GenerationPipeline: ChromaDB indexing failed: %s', msg)
    })
  }

  // ── Build summary ──────────────────────────────────────────────────────────
  const featureSummaryByEntity = new Map<string, FeatureSummaryEntry>(
    featureSummary.map(e => [e.entity, e])
  )
  const entitySummaries: EntityEnhancementSummary[] = plan.entities.map(entity => {
    const det = featureSummaryByEntity.get(entity.name)
    return {
      name: entity.name,
      features: entity.features ?? [],
      enhancementsApplied: det?.featuresApplied ?? [],
      enhancementsFailed: det?.featuresSkipped ?? [],
    }
  })

  const summary: GenerationSummary = {
    totalFiles: files.length,
    templateGenerated: templateCount,
    enhancedFiles: deterministicModified.size,
    slotEnhanced,
    slotDefaulted,
    entities: entitySummaries,
  }

  return { files, summary }
}
