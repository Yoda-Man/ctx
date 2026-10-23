/**
 * Assembly Errors
 *
 * Structured error handling for context assembly operations.
 * Uses factory methods for consistent error creation.
 */

import { ContextAIError } from '../../core/index.js';
import type { AssemblyErrorCode, AssemblyErrorDetails } from './types.js';

/**
 * Error thrown when context assembly operations fail.
 *
 * @example
 * ```typescript
 * // Using factory methods (preferred)
 * throw AssemblyError.invalidInput('XMLAssembler', 'Results array is empty');
 *
 * // Direct construction
 * throw new AssemblyError(
 *   'Custom error message',
 *   'FORMATTING_FAILED',
 *   'MarkdownAssembler',
 *   originalError
 * );
 * ```
 */
export class AssemblyError extends ContextAIError {
  /** Machine-readable error code */
  readonly code: AssemblyErrorCode;
  /** Name of the assembler that failed */
  readonly assemblerName: string;
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: AssemblyErrorCode,
    assemblerName: string,
    cause?: Error
  ) {
    super(message, `ASSEMBLY_${code}`);
    this.name = 'AssemblyError';
    this.code = code;
    this.assemblerName = assemblerName;
    this.cause = cause;
  }

  /**
   * Get error details as a structured object.
   */
  toDetails(): AssemblyErrorDetails {
    return {
      code: this.code,
      assemblerName: this.assemblerName,
      cause: this.cause,
    };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create an error for invalid input.
   * Used when results array is malformed or empty.
   */
  static invalidInput(assemblerName: string, reason: string): AssemblyError {
    return new AssemblyError(
      `Invalid input: ${reason}`,
      'INVALID_INPUT',
      assemblerName
    );
  }

  /**
   * Create an error when token budget cannot be satisfied.
   * Used when even a single chunk exceeds the budget.
   */
  static tokenBudgetExceeded(
    assemblerName: string,
    reason: string
  ): AssemblyError {
    return new AssemblyError(
      `Token budget exceeded: ${reason}`,
      'TOKEN_BUDGET_EXCEEDED',
      assemblerName
    );
  }

  /**
   * Create an error for formatting failures.
   * Used when XML/Markdown generation fails.
   */
  static formattingFailed(
    assemblerName: string,
    reason: string,
    cause?: Error
  ): AssemblyError {
    return new AssemblyError(
      `Formatting failed: ${reason}`,
      'FORMATTING_FAILED',
      assemblerName,
      cause
    );
  }

  /**
   * Create an error for configuration issues.
   */
  static configError(assemblerName: string, reason: string): AssemblyError {
    return new AssemblyError(
      `Configuration error: ${reason}`,
      'CONFIG_ERROR',
      assemblerName
    );
  }

  /**
   * Create an error for deduplication failures.
   */
  static deduplicationFailed(
    assemblerName: string,
    reason: string,
    cause?: Error
  ): AssemblyError {
    return new AssemblyError(
      `Deduplication failed: ${reason}`,
      'DEDUPLICATION_FAILED',
      assemblerName,
      cause
    );
  }
}
