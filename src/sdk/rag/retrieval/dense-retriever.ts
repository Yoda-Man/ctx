/**
 * Dense Retriever
 *
 * Wraps a VectorStore and EmbeddingProvider to provide semantic search.
 * Embeds queries and performs vector similarity search.
 */

import type { VectorStore, SearchResult } from '../vector-store/types.js';
import type { EmbeddingProvider } from '../embeddings/types.js';
import type {
  Retriever,
  RetrievalResult,
  RetrievalOptions,
  DenseRetrieverConfig,
} from './types.js';
import { RetrieverError } from './errors.js';

// ============================================================================
// Dense Retriever Implementation
// ============================================================================

/**
 * Dense retriever using vector similarity search.
 *
 * Dense retrieval excels at:
 * - Semantic similarity ("car" matches "automobile")
 * - Paraphrased queries ("How do I X?" matches "Steps to X")
 * - Concept matching across different vocabulary
 *
 * @example
 * ```typescript
 * const retriever = new DenseRetriever({
 *   vectorStore,
 *   embeddingProvider,
 * });
 *
 * const results = await retriever.retrieve('How do I reset my password?', {
 *   topK: 5,
 *   minScore: 0.7,
 * });
 * ```
 */
export class DenseRetriever implements Retriever {
  readonly name: string;

  private readonly vectorStore: VectorStore;
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(
    vectorStore: VectorStore,
    embeddingProvider: EmbeddingProvider,
    config: DenseRetrieverConfig = {}
  ) {
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.name = config.name ?? 'DenseRetriever';
  }

  /**
   * Retrieve documents using vector similarity search.
   *
   * 1. Embeds the query using the embedding provider
   * 2. Searches the vector store for similar chunks
   * 3. Converts results to RetrievalResult format
   *
   * @param query - Search query (natural language)
   * @param options - Retrieval options
   * @returns Sorted results with similarity scores
   */
  retrieve = async (
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievalResult[]> => {
    // Validate query
    if (!query || query.trim().length === 0) {
      throw RetrieverError.invalidQuery(this.name, 'Query cannot be empty');
    }

    const topK = options.topK ?? 10;
    const minScore = options.minScore;
    const filter = options.filter;
    const includeMetadata = options.includeMetadata ?? true;

    // Embed the query
    let queryEmbedding: number[];
    try {
      const result = await this.embeddingProvider.embed(query);
      queryEmbedding = result.embedding;
    } catch (error) {
      throw RetrieverError.embeddingFailed(
        this.name,
        'Failed to embed query',
        error instanceof Error ? error : undefined
      );
    }

    // Search the vector store
    let searchResults: SearchResult[];
    try {
      searchResults = await this.vectorStore.search(queryEmbedding, {
        topK,
        minScore,
        filter,
        includeMetadata,
        includeVectors: false, // We don't need vectors in retrieval results
      });
    } catch (error) {
      throw RetrieverError.storeError(
        this.name,
        'Vector store search failed',
        error instanceof Error ? error : undefined
      );
    }

    // Convert to RetrievalResult format
    return searchResults.map((result) => ({
      id: result.id,
      chunk: result.chunk,
      score: result.score,
      // For dense-only retrieval, we don't populate the full HybridScore
      // That's done by the HybridRetriever
    }));
  };

  /**
   * Get the underlying vector store.
   * Useful for accessing store-specific functionality.
   */
  get store(): VectorStore {
    return this.vectorStore;
  }

  /**
   * Get the underlying embedding provider.
   * Useful for accessing provider-specific functionality.
   */
  get provider(): EmbeddingProvider {
    return this.embeddingProvider;
  }
}
