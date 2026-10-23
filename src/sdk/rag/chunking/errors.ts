/**
 * Text Chunker Errors
 *
 * Errors thrown during document chunking operations.
 * Includes configuration errors, provider requirements, and LLM parsing failures.
 */

import { ContextAIError } from '../../core/index.js';
import type { ChunkerErrorCode, ChunkerErrorDetails } from './types.js';

/**
 * Error thrown when text chunking fails.
 *
 * Provides actionable troubleshooting hints based on the error code.
 *
 * @example
 * ```typescript
 * throw ChunkerError.providerRequired('SemanticChunker', 'embeddingProvider');
 * // Error: SemanticChunker requires embeddingProvider
 * // Hint: This chunker requires an external provider. Pass it in the constructor.
 * ```
 */
export class ChunkerError extends ContextAIError {
  /** Machine-readable error code */
  override readonly code: ChunkerErrorCode;
  /** Name of the chunker that failed */
  readonly chunkerName: string;
  /** Document ID that was being chunked */
  readonly documentId?: string;
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: ChunkerErrorCode,
    chunkerName: string,
    documentId?: string,
    cause?: Error
  ) {
    super(message, `CHUNKER_${code}`, { severity: 'error', cause });
    this.name = 'ChunkerError';
    this.code = code;
    this.chunkerName = chunkerName;
    this.documentId = documentId;
    this.cause = cause;
  }

  /**
   * Provide actionable troubleshooting hints based on error code.
   */
  override get troubleshootingHint(): string | null {
    switch (this.code) {
      case 'EMPTY_DOCUMENT':
        return (
          `Document content is empty. ` +
          `Ensure the document loader returned valid content before chunking.`
        );

      case 'INVALID_OPTIONS':
        return (
          `Check chunking options: chunkSize must be > 0, ` +
          `chunkOverlap must be < chunkSize.`
        );

      case 'CHUNK_TOO_SMALL':
        return (
          `Chunk is below minimum size. ` +
          `Consider increasing chunkSize or reducing chunkOverlap.`
        );

      case 'CONFIG_ERROR':
        return (
          `Check ${this.chunkerName} configuration values are within valid ranges. ` +
          `Refer to the chunker documentation for valid options.`
        );

      case 'PROVIDER_REQUIRED':
        return (
          `${this.chunkerName} requires an external provider (embedding or LLM). ` +
          `Pass the provider in the constructor configuration.`
        );

      case 'LLM_PARSE_ERROR':
        return (
          `LLM returned an unparseable response. ` +
          `Try lowering temperature to 0 for more deterministic output, ` +
          `or check that the model supports structured output.`
        );

      case 'CHUNKER_ERROR':
        return null; // Generic error, no specific hint

      default:
        return null;
    }
  }

  /**
   * Get error details as a structured object.
   */
  toDetails(): ChunkerErrorDetails {
    return {
      code: this.code,
      chunkerName: this.chunkerName,
      documentId: this.documentId,
      cause: this.cause,
    };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create an error for empty document content.
   */
  static emptyDocument(chunkerName: string, documentId?: string): ChunkerError {
    return new ChunkerError(
      'Document content is empty',
      'EMPTY_DOCUMENT',
      chunkerName,
      documentId
    );
  }

  /**
   * Create an error for invalid chunking options.
   */
  static invalidOptions(
    chunkerName: string,
    reason: string,
    documentId?: string
  ): ChunkerError {
    return new ChunkerError(
      `Invalid chunking options: ${reason}`,
      'INVALID_OPTIONS',
      chunkerName,
      documentId
    );
  }

  /**
   * Create an error when chunk size is too small.
   */
  static chunkTooSmall(
    chunkerName: string,
    minSize: number,
    actualSize: number,
    documentId?: string
  ): ChunkerError {
    return new ChunkerError(
      `Chunk size ${actualSize} is below minimum ${minSize}`,
      'CHUNK_TOO_SMALL',
      chunkerName,
      documentId
    );
  }

  /**
   * Create a generic chunker error.
   */
  static chunkerError(
    chunkerName: string,
    message: string,
    documentId?: string,
    cause?: Error
  ): ChunkerError {
    return new ChunkerError(
      message,
      'CHUNKER_ERROR',
      chunkerName,
      documentId,
      cause
    );
  }

  /**
   * Create an error for invalid configuration values.
   *
   * @param chunkerName - Name of the chunker with invalid config
   * @param reason - Description of what's invalid
   *
   * @example
   * ```typescript
   * throw ChunkerError.configError('SemanticChunker', 'similarityThreshold must be between 0 and 1');
   * ```
   */
  static configError(chunkerName: string, reason: string): ChunkerError {
    return new ChunkerError(
      `Invalid configuration: ${reason}`,
      'CONFIG_ERROR',
      chunkerName
    );
  }

  /**
   * Create an error when a required provider is missing.
   *
   * @param chunkerName - Name of the chunker that needs the provider
   * @param providerType - Type of provider needed (e.g., 'embeddingProvider', 'llmProvider')
   *
   * @example
   * ```typescript
   * if (!config.embeddingProvider) {
   *   throw ChunkerError.providerRequired('SemanticChunker', 'embeddingProvider');
   * }
   * ```
   */
  static providerRequired(
    chunkerName: string,
    providerType: string
  ): ChunkerError {
    return new ChunkerError(
      `${chunkerName} requires ${providerType}`,
      'PROVIDER_REQUIRED',
      chunkerName
    );
  }

  /**
   * Create an error when LLM response cannot be parsed.
   *
   * @param chunkerName - Name of the chunker that failed to parse
   * @param details - Description of what couldn't be parsed
   * @param cause - Optional underlying parsing error
   *
   * @example
   * ```typescript
   * try {
   *   const chunks = JSON.parse(llmResponse);
   * } catch (e) {
   *   throw ChunkerError.llmParseError('AgenticChunker', 'Invalid JSON in response', e);
   * }
   * ```
   */
  static llmParseError(
    chunkerName: string,
    details: string,
    cause?: Error
  ): ChunkerError {
    return new ChunkerError(
      `Failed to parse LLM response: ${details}`,
      'LLM_PARSE_ERROR',
      chunkerName,
      undefined,
      cause
    );
  }
}
