import { createModuleLogger } from '../../logging'
import { countTokens } from '../prompt/token-counter'
import type { RetrievedContext } from '../types'
import type { ChromaVectorStore } from './chroma.client'

const log = createModuleLogger('rag-retriever')

const DEFAULT_QUERY_LIMIT = 20

/**
 * Queries ChromaDB for relevant code chunks and packs them into the token budget.
 *
 * Results are sorted by score (highest first). Chunks are greedily added
 * until the token budget is exhausted.
 */
export async function retrieveContext(
  projectId: string,
  query: string,
  tokenBudget: number,
  vectorStore: ChromaVectorStore
): Promise<RetrievedContext> {
  if (tokenBudget <= 0) {
    return { chunks: [], totalTokens: 0 }
  }

  const results = await vectorStore.query(projectId, query, DEFAULT_QUERY_LIMIT)

  if (results.length === 0) {
    log.debug('No RAG results', { projectId })
    return { chunks: [], totalTokens: 0 }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  let totalTokens = 0
  const selectedChunks = []

  for (const { chunk } of results) {
    const tokens = countTokens(chunk.content)
    if (totalTokens + tokens > tokenBudget) continue
    selectedChunks.push(chunk)
    totalTokens += tokens
  }

  log.debug('RAG context assembled', {
    projectId,
    candidates: results.length,
    selected: selectedChunks.length,
    totalTokens,
  })

  return { chunks: selectedChunks, totalTokens }
}
