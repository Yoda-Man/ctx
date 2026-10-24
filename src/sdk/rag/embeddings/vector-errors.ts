/**
 * Vector Operation Errors
 *
 * Errors thrown during mathematical operations on embedding vectors,
 * such as dot product, cosine similarity, and distance calculations.
 */

import { ContextAIError } from '../../core/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Error codes for vector operations.
 */
export type VectorErrorCode =
  | 'DIMENSION_MISMATCH'
  | 'EMPTY_ARRAY'
  | 'INVALID_VECTOR';

// ============================================================================
// VectorError Class
// ============================================================================

/**
 * Error thrown when vector operations fail.
 *
 * Common scenarios:
 * - Comparing vectors with different dimensions
 * - Computing operations on empty arrays
 * - Invalid vector data (NaN, Infinity)
 *
 * @example
 * ```typescript
 * // Dimension mismatch
 * const a = [1, 2, 3];      // 3 dimensions
 * const b = [1, 2, 3, 4];   // 4 dimensions
 * cosineSimilarity(a, b);   // throws VectorError.dimensionMismatch(3, 4)
 *
 * // Empty array
 * meanEmbedding([]);        // throws VectorError.emptyArray('mean')
 * ```
 */
export class VectorError extends ContextAIError {
  override readonly code: VectorErrorCode;

  /** Expected vector dimension (for dimension mismatch errors) */
  readonly expected?: number;

  /** Actual vector dimension (for dimension mismatch errors) */
  readonly actual?: number;

  /** Operation that failed (for empty array errors) */
  readonly operation?: string;

  constructor(
    message: string,
    code: VectorErrorCode,
    options?: {
      expected?: number;
      actual?: number;
      operation?: string;
      cause?: Error;
    }
  ) {
    super(message, `VECTOR_${code}`, {
      severity: 'error',
      cause: options?.cause,
    });
    this.name = 'VectorError';
    this.code = code;
    this.expected = options?.expected;
    this.actual = options?.actual;
    this.operation = options?.operation;
  }

  /**
   * Provide actionable troubleshooting hints for vector errors.
   */
  override get troubleshootingHint(): string | null {
    switch (this.code) {
      case 'DIMENSION_MISMATCH':
        return (
          `Vectors must have matching dimensions. ` +
          `Got ${this.actual} but expected ${this.expected}. ` +
          `Ensure both vectors come from the same embedding model.`
        );

      case 'EMPTY_ARRAY':
        return (
          `Cannot compute ${this.operation ?? 'operation'} on empty array. ` +
          `Ensure input contains at least one element before calling this function.`
        );

      case 'INVALID_VECTOR':
        return (
          `Vector contains invalid values (NaN or Infinity). ` +
          `Check that all elements are valid finite numbers.`
        );

      default:
        return null;
    }
  }

  // ==========================================================================
  // Factory Methods
  // ==========================================================================

  /**
   * Create an error for dimension mismatch between vectors.
   *
   * @param expected - Expected dimension (from first vector)
   * @param actual - Actual dimension (from second vector)
   *
   * @example
   * ```typescript
   * if (a.length !== b.length) {
   *   throw VectorError.dimensionMismatch(a.length, b.length);
   * }
   * ```
   */
  static dimensionMismatch(expected: number, actual: number): VectorError {
    return new VectorError(
      `Vector dimensions must match: expected ${expected}, got ${actual}`,
      'DIMENSION_MISMATCH',
      { expected, actual }
    );
  }
}
