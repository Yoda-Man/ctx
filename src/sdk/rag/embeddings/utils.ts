/**
 * Embedding Utilities
 *
 * Mathematical operations for working with embedding vectors.
 */

import { VectorError } from './vector-errors.js';

/**
 * Compute the dot product of two vectors.
 *
 * For normalized vectors, this equals cosine similarity.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Dot product (sum of element-wise products)
 * @throws {VectorError} If vectors have different lengths
 *
 * @example
 * ```typescript
 * const a = [1, 2, 3];
 * const b = [4, 5, 6];
 * dotProduct(a, b); // 1*4 + 2*5 + 3*6 = 32
 * ```
 */
export const dotProduct = (a: number[], b: number[]): number => {
  if (a.length !== b.length) {
    throw VectorError.dimensionMismatch(a.length, b.length);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] as number) * (b[i] as number);
  }
  return sum;
};

/**
 * Compute the L2 (Euclidean) norm of a vector.
 *
 * @param embedding - Vector to compute norm for
 * @returns The magnitude (length) of the vector
 *
 * @example
 * ```typescript
 * l2Norm([3, 4]); // 5 (Pythagorean: sqrt(9 + 16))
 * ```
 */
export const l2Norm = (embedding: number[]): number => {
  let sumOfSquares = 0;
  for (const value of embedding) {
    sumOfSquares += value * value;
  }
  return Math.sqrt(sumOfSquares);
};

/**
 * Normalize a vector to unit length (L2 normalization).
 *
 * After normalization, the vector has magnitude 1, which makes
 * dot product equivalent to cosine similarity.
 *
 * @param embedding - Vector to normalize
 * @returns New vector with unit length
 *
 * @example
 * ```typescript
 * const normalized = normalizeL2([3, 4]);
 * // [0.6, 0.8] - unit vector pointing same direction
 * l2Norm(normalized); // 1.0
 * ```
 */
export const normalizeL2 = (embedding: number[]): number[] => {
  const norm = l2Norm(embedding);

  // Handle zero vector (return as-is to avoid division by zero)
  if (norm === 0) {
    return [...embedding];
  }

  return embedding.map((value) => value / norm);
};

/**
 * Compute cosine similarity between two vectors.
 *
 * Measures the angle between vectors, ignoring magnitude.
 * Values range from -1 (opposite) to 1 (identical).
 *
 * For pre-normalized vectors, use `dotProduct` instead (faster).
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity score between -1 and 1
 * @throws {VectorError} If vectors have different lengths
 *
 * @example
 * ```typescript
 * const query = [1, 0, 0];
 * const doc1 = [1, 0, 0];  // identical
 * const doc2 = [0, 1, 0];  // orthogonal
 * const doc3 = [-1, 0, 0]; // opposite
 *
 * cosineSimilarity(query, doc1); // 1.0
 * cosineSimilarity(query, doc2); // 0.0
 * cosineSimilarity(query, doc3); // -1.0
 * ```
 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) {
    throw VectorError.dimensionMismatch(a.length, b.length);
  }

  const normA = l2Norm(a);
  const normB = l2Norm(b);

  // Handle zero vectors
  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct(a, b) / (normA * normB);
};

/**
 * Compute Euclidean distance between two vectors.
 *
 * Lower values indicate more similar vectors.
 * For normalized vectors, this is related to cosine similarity:
 * distance² = 2 - 2·similarity
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Euclidean distance (always >= 0)
 * @throws {VectorError} If vectors have different lengths
 *
 * @example
 * ```typescript
 * euclideanDistance([0, 0], [3, 4]); // 5
 * ```
 */
export const euclideanDistance = (a: number[], b: number[]): number => {
  if (a.length !== b.length) {
    throw VectorError.dimensionMismatch(a.length, b.length);
  }

  let sumOfSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    sumOfSquares += diff * diff;
  }
  return Math.sqrt(sumOfSquares);
};

/**
 * Check if a vector is normalized (unit length).
 *
 * @param embedding - Vector to check
 * @param tolerance - Acceptable deviation from 1.0 (default: 1e-6)
 * @returns true if the vector has unit length
 */
export const isNormalized = (
  embedding: number[],
  tolerance: number = 1e-6
): boolean => {
  const norm = l2Norm(embedding);
  return Math.abs(norm - 1) < tolerance;
};

/**
 * Compute the mean of multiple embedding vectors.
 *
 * Useful for combining embeddings (e.g., averaging sentence embeddings).
 *
 * @param embeddings - Array of embedding vectors
 * @param normalize - Whether to normalize the result (default: true)
 * @returns Mean vector
 * @throws {VectorError} If embeddings array is empty
 * @throws {VectorError} If embeddings have different dimensions
 */
export const meanEmbedding = (
  embeddings: number[][],
  normalize: boolean = true
): number[] => {
  if (embeddings.length === 0) {
    throw VectorError.emptyArray('mean');
  }

  const firstEmbedding = embeddings[0] as number[];
  const dimensions = firstEmbedding.length;
  const mean = new Array(dimensions).fill(0);

  for (const embedding of embeddings) {
    if (embedding.length !== dimensions) {
      throw VectorError.dimensionMismatch(dimensions, embedding.length);
    }
    for (let i = 0; i < dimensions; i++) {
      mean[i] += embedding[i];
    }
  }

  // Divide by count
  const count = embeddings.length;
  for (let i = 0; i < dimensions; i++) {
    mean[i] /= count;
  }

  return normalize ? normalizeL2(mean) : mean;
};
