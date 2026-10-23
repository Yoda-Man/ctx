/**
 * Embedding Provider Types
 *
 * Core interfaces for the RAG embedding system.
 * All embedding providers must implement the EmbeddingProvider interface.
 */

// ============================================================================
// Embedding Result Types
// ============================================================================

/**
 * Result from generating an embedding.
 */
export interface EmbeddingResult {
  /** The embedding vector (normalized) */
  embedding: number[];
  /** Number of tokens in the input text */
  tokenCount: number;
  /** Model used to generate the embedding */
  model: string;
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Configuration for embedding providers.
 */
export interface EmbeddingProviderConfig {
  /** Model identifier (e.g., "text-embedding-3-small") */
  model: string;
  /** Output embedding dimensions (some models support variable) */
  dimensions?: number;
  /** Maximum texts per batch request */
  batchSize?: number;
  /** Whether to normalize embeddings to unit length (default: true) */
  normalize?: boolean;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface for embedding providers.
 *
 * Providers are responsible for:
 * 1. Generating embeddings from text (embed)
 * 2. Batch embedding for efficiency (embedBatch)
 * 3. Reporting availability status (isAvailable)
 *
 * @example
 * ```typescript
 * const provider: EmbeddingProvider = new OpenAIEmbeddingProvider({
 *   model: 'text-embedding-3-small',
 *   dimensions: 1536
 * });
 *
 * if (await provider.isAvailable()) {
 *   const result = await provider.embed('Hello, world!');
 *   console.log(result.embedding.length); // 1536
 * }
 * ```
 */
export interface EmbeddingProvider {
  /** Human-readable name of this provider */
  readonly name: string;

  /** Output embedding dimensions */
  readonly dimensions: number;

  /** Maximum texts per batch request */
  readonly maxBatchSize: number;

  /**
   * Generate an embedding for a single text.
   *
   * @param text - Text to embed
   * @returns Embedding result with vector, token count, and model
   * @throws {EmbeddingError} If embedding fails
   */
  embed(text: string): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for multiple texts.
   *
   * Automatically handles batching if texts exceed maxBatchSize.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding results in same order as input
   * @throws {EmbeddingError} If embedding fails
   */
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;

  /**
   * Check if the provider is available and ready.
   *
   * May check API keys, model availability, network connectivity, etc.
   *
   * @returns true if the provider can generate embeddings
   */
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for embedding failures.
 */
export type EmbeddingErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'BATCH_TOO_LARGE'
  | 'TEXT_TOO_LONG'
  | 'EMPTY_INPUT'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_UNAVAILABLE'
  | 'EMBEDDING_FAILED';

/**
 * Details about an embedding error.
 */
export interface EmbeddingErrorDetails {
  /** Machine-readable error code */
  code: EmbeddingErrorCode;
  /** Name of the provider that failed */
  providerName: string;
  /** Model being used */
  model: string;
  /** Underlying cause, if any */
  cause?: Error;
}
