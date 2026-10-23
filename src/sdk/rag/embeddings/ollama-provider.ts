/**
 * Ollama Embedding Provider
 *
 * Uses a local Ollama server for embedding generation.
 * Default model: nomic-embed-text (768 dimensions)
 */

import type { EmbeddingResult } from './types.js';
import { BaseEmbeddingProvider } from './base-provider.js';
import { EmbeddingError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for Ollama embedding provider.
 */
export interface OllamaEmbeddingConfig {
  /** Model identifier (e.g., "nomic-embed-text") */
  model?: string;
  /** Output embedding dimensions (auto-detected from model if not specified) */
  dimensions?: number;
  /** Maximum texts per batch request */
  batchSize?: number;
  /** Whether to normalize embeddings to unit length (default: true) */
  normalize?: boolean;
  /** Ollama server base URL */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Ollama API response for embeddings.
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default Ollama model for embeddings */
const DEFAULT_MODEL = 'nomic-embed-text';

/** Default dimensions for nomic-embed-text model */
const DEFAULT_DIMENSIONS = 768;

/** Default Ollama server URL */
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Default request timeout (30 seconds) */
const DEFAULT_TIMEOUT = 30000;

/** Maximum batch size for Ollama */
const DEFAULT_BATCH_SIZE = 32;

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * Ollama embedding provider for local inference.
 *
 * Connects to a local Ollama server to generate embeddings.
 * Supports any Ollama-compatible embedding model.
 *
 * @example
 * ```typescript
 * const provider = new OllamaEmbeddingProvider({
 *   model: 'nomic-embed-text',
 *   baseUrl: 'http://localhost:11434',
 * });
 *
 * if (await provider.isAvailable()) {
 *   const result = await provider.embed('Hello, world!');
 *   console.log(result.embedding.length); // 768
 * }
 * ```
 */
export class OllamaEmbeddingProvider extends BaseEmbeddingProvider {
  readonly name = 'OllamaEmbeddingProvider';

  /** Ollama server base URL */
  private readonly baseUrl: string;

  /** Request timeout in milliseconds */
  private readonly timeout: number;

  constructor(config: OllamaEmbeddingConfig = {}) {
    super({
      model: config.model ?? DEFAULT_MODEL,
      dimensions: config.dimensions ?? DEFAULT_DIMENSIONS,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      normalize: config.normalize ?? true,
    });
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Check if the Ollama server is available.
   *
   * Pings the server and verifies the model is available.
   */
  isAvailable = async (): Promise<boolean> => {
    try {
      // Check server health
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return false;
      }

      // Check if our model is available
      const data = (await response.json()) as {
        models?: { name: string }[];
      };

      const models = data.models ?? [];
      return models.some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`)
      );
    } catch {
      return false;
    }
  };

  /**
   * Generate embedding for a single text.
   */
  protected _embed = async (text: string): Promise<EmbeddingResult> => {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw EmbeddingError.providerUnavailable(
          this.name,
          this.model,
          `API error: ${response.status} - ${errorText}`
        );
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;

      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw EmbeddingError.invalidResponse(
          this.name,
          this.model,
          'Response missing embedding array'
        );
      }

      return {
        embedding: data.embedding,
        tokenCount: this.estimateTokenCount(text),
        model: this.model,
      };
    } catch (error) {
      // Handle timeout
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw EmbeddingError.providerUnavailable(
          this.name,
          this.model,
          'Request timed out',
          error
        );
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw EmbeddingError.providerUnavailable(
          this.name,
          this.model,
          'Cannot connect to Ollama server. Is it running?',
          error
        );
      }

      // Re-throw EmbeddingErrors
      if (error instanceof EmbeddingError) {
        throw error;
      }

      // Wrap other errors
      throw EmbeddingError.invalidResponse(
        this.name,
        this.model,
        'Failed to generate embedding',
        error instanceof Error ? error : undefined
      );
    }
  };

  /**
   * Estimate token count based on character length.
   *
   * Uses a rough heuristic of ~4 characters per token.
   */
  private estimateTokenCount = (text: string): number => {
    return Math.ceil(text.length / 4);
  };
}
