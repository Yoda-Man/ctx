/**
 * Semantic Text Chunker
 *
 * Splits documents based on embedding similarity between consecutive sentences.
 * Creates chunks that maintain semantic coherence - sentences about the same
 * topic stay together.
 *
 * Algorithm:
 * 1. Split document into sentences
 * 2. Generate embeddings for each sentence
 * 3. Calculate cosine similarity between consecutive sentences
 * 4. Split where similarity drops below threshold (topic change)
 * 5. Apply min/max size constraints
 */

import type { Chunk, ChunkingOptions, Document } from './types.js';
import type { EmbeddingProvider, EmbeddingResult } from '../embeddings/types.js';
import { BaseChunker } from './base-chunker.js';
import { ChunkerError } from './errors.js';
import { VectorError } from '../embeddings/vector-errors.js';
import { CHARS_PER_TOKEN } from './token-counter.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the semantic chunker.
 */
export interface SemanticChunkerConfig {
  /**
   * Embedding provider for generating sentence embeddings.
   * Required - the chunker cannot function without it.
   */
  embeddingProvider: EmbeddingProvider;

  /**
   * Similarity threshold for detecting topic boundaries.
   *
   * When cosine similarity between consecutive sentences drops below this
   * value, a new chunk is started.
   *
   * - 0.3: Very aggressive splitting (many small chunks)
   * - 0.5: Balanced (default)
   * - 0.7: Conservative (fewer, larger chunks)
   *
   * @default 0.5
   */
  similarityThreshold?: number;

  /**
   * Minimum chunk size in tokens.
   *
   * Chunks smaller than this will be merged with adjacent chunks,
   * even if there's a topic boundary.
   *
   * @default 100
   */
  minChunkSize?: number;

  /**
   * Maximum chunk size in tokens.
   *
   * Chunks larger than this will be split at the next best
   * semantic boundary, even if similarity is high.
   *
   * @default 1000
   */
  maxChunkSize?: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  similarityThreshold: 0.5,
  minChunkSize: 100,
  maxChunkSize: 1000,
} as const;

// ============================================================================
// Cosine Similarity Helper
// ============================================================================

/**
 * Calculate cosine similarity between two vectors.
 *
 * Cosine similarity measures the angle between two vectors:
 * - 1.0 = identical direction (same meaning)
 * - 0.0 = orthogonal (unrelated)
 * - -1.0 = opposite direction (opposite meaning)
 *
 * Formula: cos(θ) = (A · B) / (||A|| × ||B||)
 *
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Similarity score between -1 and 1
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw VectorError.dimensionMismatch(a.length, b.length);
  }

  if (a.length === 0) {
    return 0;
  }

  // Calculate dot product and magnitudes in single pass
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    magnitudeA += ai * ai;
    magnitudeB += bi * bi;
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  // Handle zero vectors (shouldn't happen with normalized embeddings)
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

// ============================================================================
// Sentence Splitting
// ============================================================================

/**
 * Regex pattern for sentence boundaries.
 *
 * Matches period, exclamation, or question mark followed by whitespace.
 * Uses lookbehind to keep the punctuation with the sentence.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * Split text into sentences.
 */
function splitIntoSentences(text: string): string[] {
  const parts = text.split(SENTENCE_BOUNDARY);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

// ============================================================================
// Semantic Chunker Implementation
// ============================================================================

/**
 * Semantic chunking strategy using embedding similarity.
 *
 * Instead of splitting at fixed sizes or sentence boundaries, this chunker
 * detects topic changes by measuring semantic similarity between consecutive
 * sentences. When similarity drops below a threshold, a new chunk begins.
 *
 * Benefits:
 * - Keeps related sentences together
 * - Improves RAG retrieval quality
 * - Creates more meaningful context windows
 *
 * Trade-offs:
 * - Requires embedding provider (slower than rule-based chunkers)
 * - More complex configuration
 * - Chunk sizes are less predictable
 *
 * @example
 * ```typescript
 * const chunker = new SemanticChunker({
 *   embeddingProvider: new HuggingFaceEmbeddingProvider(),
 *   similarityThreshold: 0.5,
 *   minChunkSize: 100,
 *   maxChunkSize: 500
 * });
 *
 * const chunks = await chunker.chunk(document);
 * ```
 */
export class SemanticChunker extends BaseChunker {
  readonly name = 'SemanticChunker';

  private readonly embeddingProvider: EmbeddingProvider;
  private readonly similarityThreshold: number;
  private readonly minChunkSize: number;
  private readonly maxChunkSize: number;

  constructor(config: SemanticChunkerConfig) {
    super();

    if (!config.embeddingProvider) {
      throw ChunkerError.providerRequired('SemanticChunker', 'embeddingProvider');
    }

    this.embeddingProvider = config.embeddingProvider;
    this.similarityThreshold =
      config.similarityThreshold ?? DEFAULT_CONFIG.similarityThreshold;
    this.minChunkSize = config.minChunkSize ?? DEFAULT_CONFIG.minChunkSize;
    this.maxChunkSize = config.maxChunkSize ?? DEFAULT_CONFIG.maxChunkSize;

    // Validate configuration
    if (this.similarityThreshold < 0 || this.similarityThreshold > 1) {
      throw ChunkerError.configError(
        'SemanticChunker',
        'similarityThreshold must be between 0 and 1'
      );
    }
    if (this.minChunkSize >= this.maxChunkSize) {
      throw ChunkerError.configError(
        'SemanticChunker',
        'minChunkSize must be less than maxChunkSize'
      );
    }
  }

  /**
   * Chunk document using semantic similarity detection.
   */
  protected async _chunk(
    document: Document,
    options: Required<ChunkingOptions>
  ): Promise<Chunk[]> {
    const text = document.content;

    // Step 1: Split into sentences
    const sentences = splitIntoSentences(text);

    if (sentences.length === 0) {
      return [];
    }

    // Single sentence - return as one chunk
    if (sentences.length === 1) {
      const firstSentence = sentences[0];
      if (firstSentence) {
        return [this.createChunk(firstSentence, document, 0, 0, text.length, options)];
      }
      return [];
    }

    // Step 2: Generate embeddings for all sentences
    const embeddings = await this.embedSentences(sentences);

    // Step 3: Calculate similarity between consecutive sentences
    const similarities = this.calculateSimilarities(embeddings);

    // Step 4: Find split points (where similarity < threshold)
    const splitPoints = this.findSplitPoints(sentences, similarities);

    // Step 5: Group sentences into chunks with size constraints
    const chunkGroups = this.groupSentences(sentences, splitPoints);

    // Step 6: Convert groups to Chunk objects
    return this.groupsToChunks(chunkGroups, document, text, options);
  }

  /**
   * Generate embeddings for all sentences.
   */
  private async embedSentences(sentences: string[]): Promise<number[][]> {
    try {
      const results: EmbeddingResult[] =
        await this.embeddingProvider.embedBatch(sentences);
      return results.map((r) => r.embedding);
    } catch (error) {
      throw ChunkerError.chunkerError(
        this.name,
        'Failed to generate sentence embeddings',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Calculate cosine similarity between consecutive sentences.
   *
   * Returns array of length (n-1) for n sentences.
   */
  private calculateSimilarities(embeddings: number[][]): number[] {
    const similarities: number[] = [];

    for (let i = 0; i < embeddings.length - 1; i++) {
      const current = embeddings[i];
      const next = embeddings[i + 1];
      if (current && next) {
        const similarity = cosineSimilarity(current, next);
        similarities.push(similarity);
      }
    }

    return similarities;
  }

  /**
   * Find indices where we should split into new chunks.
   *
   * A split point is where:
   * 1. Similarity drops below threshold, OR
   * 2. Accumulated size exceeds maxChunkSize
   */
  private findSplitPoints(
    sentences: string[],
    similarities: number[]
  ): number[] {
    const splitPoints: number[] = [];
    let accumulatedSize = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (!sentence) continue;

      const sentenceSize = this.estimateTokens(sentence);
      accumulatedSize += sentenceSize;

      // Check if we should split AFTER this sentence
      if (i < sentences.length - 1) {
        const similarity = similarities[i] ?? 0;
        const nextSentence = sentences[i + 1];
        const nextSize = nextSentence ? this.estimateTokens(nextSentence) : 0;
        const wouldExceedMax = accumulatedSize + nextSize > this.maxChunkSize;

        // Split if topic changes OR we'd exceed max size
        if (similarity < this.similarityThreshold || wouldExceedMax) {
          // But only if we have enough content (min size)
          if (accumulatedSize >= this.minChunkSize) {
            splitPoints.push(i + 1); // Split AFTER sentence i
            accumulatedSize = 0;
          }
        }
      }
    }

    return splitPoints;
  }

  /**
   * Group sentences based on split points.
   */
  private groupSentences(
    sentences: string[],
    splitPoints: number[]
  ): string[][] {
    const groups: string[][] = [];
    let currentGroup: string[] = [];
    const splitSet = new Set(splitPoints);

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (sentence) {
        currentGroup.push(sentence);
      }

      // Start new group if this is a split point
      if (splitSet.has(i + 1)) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }

    // Don't forget the last group
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    // Merge small trailing groups
    return this.mergeSmallGroups(groups);
  }

  /**
   * Merge groups that are too small with their neighbors.
   */
  private mergeSmallGroups(groups: string[][]): string[][] {
    if (groups.length <= 1) {
      return groups;
    }

    const result: string[][] = [];

    for (const group of groups) {
      const groupSize = this.estimateGroupTokens(group);

      if (result.length === 0 || groupSize >= this.minChunkSize) {
        // Start new group
        result.push(group);
      } else {
        // Merge with previous group
        const lastGroup = result[result.length - 1];
        if (lastGroup) {
          lastGroup.push(...group);
        }
      }
    }

    return result;
  }

  /**
   * Convert sentence groups to Chunk objects.
   */
  private groupsToChunks(
    groups: string[][],
    document: Document,
    originalText: string,
    options: Required<ChunkingOptions>
  ): Chunk[] {
    const chunks: Chunk[] = [];
    let searchStart = 0;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (!group || group.length === 0) {
        continue;
      }

      const content = group.join(' ');

      if (!content || content.trim().length === 0) {
        continue;
      }

      // Find position in original text
      const firstSentence = group[0];
      const lastSentence = group[group.length - 1];

      if (!firstSentence || !lastSentence) {
        continue;
      }

      const startIndex = originalText.indexOf(firstSentence, searchStart);
      const endIndex =
        originalText.indexOf(lastSentence, startIndex) + lastSentence.length;

      chunks.push(
        this.createChunk(content, document, i, startIndex, endIndex, options)
      );

      searchStart = Math.max(searchStart, startIndex + 1);
    }

    return chunks;
  }

  /**
   * Estimate token count for a sentence.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Estimate total tokens in a group of sentences.
   */
  private estimateGroupTokens(group: string[]): number {
    return group.reduce((total, s) => total + this.estimateTokens(s), 0);
  }
}
