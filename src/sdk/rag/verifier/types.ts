/**
 * Verifier Types
 *
 * Core interfaces for post-retrieval document verification.
 * Verifiers use LLMs to judge whether retrieved documents
 * are truly relevant to the query before context assembly.
 *
 * Key difference from reranking:
 * - Reranking: Scores and reorders documents (keeps all)
 * - Verification: Judges relevance and can filter/drop documents
 */

import type { RetrievalResult } from '../retrieval/types.js';

// ============================================================================
// Verification Result Types
// ============================================================================

/**
 * Result of verifying a single document against a query.
 *
 * Contains the LLM's judgment on whether the document is relevant,
 * along with confidence and optional reasoning for transparency.
 */
export interface VerificationResult {
  /** Whether the document is verified as relevant to the query */
  verified: boolean;

  /** Confidence in the verification decision (0-1, higher = more confident) */
  confidence: number;

  /** LLM's relevance score (0-10, higher = more relevant) */
  verificationScore: number;

  /** Optional reasoning from the LLM explaining the judgment */
  reasoning?: string;
}

/**
 * A retrieval result with verification information attached.
 *
 * Extends RetrievalResult to include the verification judgment
 * while preserving all original retrieval data (scores, confidence, etc.)
 */
export interface VerifiedRetrievalResult extends RetrievalResult {
  /** Verification result, present when verification was performed */
  verification?: VerificationResult;
}

// ============================================================================
// Verifier Options
// ============================================================================

/**
 * Options for verification operations.
 *
 * Controls confidence-based skip logic and LLM call behavior.
 * The thresholds allow optimizing LLM costs by not verifying
 * documents where the retrieval confidence is already conclusive.
 */
export interface VerifierOptions {
  /**
   * Minimum retrieval confidence to skip verification (0-1).
   * Documents with confidence >= this are marked verified without LLM call.
   * Default: 0.8
   *
   * @example
   * // Skip verification for high-confidence results
   * { skipThreshold: 0.8 }  // 80%+ confidence = auto-verified
   */
  skipThreshold?: number;

  /**
   * Maximum retrieval confidence to filter out (0-1).
   * Documents with confidence < this are marked unverified without LLM call.
   * Default: 0.3
   *
   * @example
   * // Filter out low-confidence results without wasting LLM calls
   * { filterThreshold: 0.3 }  // <30% confidence = auto-rejected
   */
  filterThreshold?: number;

  /**
   * Whether to include reasoning in verification results.
   * When true, asks the LLM to explain its judgment.
   * Increases token usage but provides transparency.
   * Default: false
   */
  includeReasoning?: boolean;

  /**
   * Maximum concurrent LLM calls for individual verification.
   * Higher values increase speed but may hit rate limits.
   * Default: 5
   */
  concurrency?: number;

  /**
   * Whether to use batch mode (single prompt with all documents).
   * More efficient for many documents but may reduce accuracy.
   * Default: false (verify each document individually)
   */
  batchMode?: boolean;
}

// ============================================================================
// Verifier Interface
// ============================================================================

/**
 * Interface for document relevance verifiers.
 *
 * Verifiers judge whether retrieved documents are truly relevant
 * to the query using LLM evaluation. This acts as a quality gate
 * before context assembly, filtering out irrelevant retrievals.
 *
 * @example
 * ```typescript
 * const verifier: Verifier = new LLMVerifier({
 *   llmProvider: anthropicProvider,
 *   verificationThreshold: 6,  // Score >= 6 = verified
 * });
 *
 * const verified = await verifier.verify(
 *   'How do I reset my password?',
 *   retrievalResults,
 *   { skipThreshold: 0.8 }
 * );
 *
 * // Only use verified results
 * const relevant = verified.filter(r => r.verification?.verified);
 * ```
 */
export interface Verifier {
  /** Human-readable name of this verifier */
  readonly name: string;

  /**
   * Verify retrieved documents against a query.
   *
   * Uses confidence-based logic to optimize LLM calls:
   * - High confidence (>= skipThreshold): Skip verification, mark verified
   * - Mid confidence: Verify with LLM
   * - Low confidence (< filterThreshold): Skip verification, mark unverified
   *
   * @param query - The search query (natural language)
   * @param results - Retrieval results to verify
   * @param options - Verification options (thresholds, concurrency, etc.)
   * @returns Results with verification info attached, in original order
   */
  verify(
    query: string,
    results: RetrievalResult[],
    options?: VerifierOptions
  ): Promise<VerifiedRetrievalResult[]>;
}

// ============================================================================
// LLM Verifier Configuration
// ============================================================================

/**
 * Configuration for LLM-based verifier.
 *
 * Uses an LLM to judge document relevance by asking it to score
 * how well each document answers the query.
 */
export interface LLMVerifierConfig {
  /** Name for this verifier instance (default: 'LLMVerifier') */
  name?: string;

  /**
   * Prompt template for verification.
   * Available placeholders: {query}, {document}
   *
   * Default prompt asks for JSON with verified, score, and reasoning.
   */
  promptTemplate?: string;

  /**
   * System prompt for the LLM.
   * Default: instructs to act as a strict relevance judge.
   */
  systemPrompt?: string;

  /**
   * Temperature for LLM responses.
   * Lower = more deterministic judgments.
   * Default: 0 (deterministic)
   */
  temperature?: number;

  /**
   * Default concurrency limit for individual verification.
   * Default: 5
   */
  defaultConcurrency?: number;

  /**
   * Minimum score to consider a document verified (0-10).
   * Documents with score >= this threshold are marked verified.
   * Default: 6
   */
  verificationThreshold?: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for verification failures.
 */
export type VerifierErrorCode =
  | 'VERIFICATION_FAILED'
  | 'INVALID_INPUT'
  | 'CONFIG_ERROR'
  | 'LLM_ERROR';

/**
 * Details about a verifier error.
 */
export interface VerifierErrorDetails {
  /** Machine-readable error code */
  code: VerifierErrorCode;
  /** Name of the verifier that failed */
  verifierName: string;
  /** Underlying cause, if any */
  cause?: Error;
}
