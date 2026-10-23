/**
 * Memory Management Types
 *
 * Type definitions for memory monitoring, budget enforcement,
 * and efficient storage utilities.
 */

// ============================================================================
// Memory Statistics
// ============================================================================

/**
 * Snapshot of current memory usage from process.memoryUsage().
 *
 * All values are in bytes.
 *
 * @example
 * ```typescript
 * const stats = getMemoryStats();
 * console.log(`Heap used: ${stats.heapUsed / 1024 / 1024}MB`);
 * ```
 */
export interface MemoryStats {
  /**
   * Resident Set Size - total memory allocated for the process.
   * Includes code, stack, and heap.
   */
  rss: number;

  /**
   * Total heap allocated by V8.
   * This can grow as needed up to the V8 heap limit.
   */
  heapTotal: number;

  /**
   * Heap actually being used by JS objects.
   * This is what we care about most for memory budgets.
   */
  heapUsed: number;

  /**
   * Memory used by C++ objects bound to JavaScript.
   * Includes things like file handles, sockets.
   */
  external: number;

  /**
   * Memory for ArrayBuffers and SharedArrayBuffers.
   * This is where our Float32Array embeddings live!
   */
  arrayBuffers: number;
}

// ============================================================================
// Memory Budget
// ============================================================================

/**
 * Callback fired when memory usage crosses a threshold.
 *
 * @param used - Current tracked memory usage in bytes
 * @param max - Maximum budget in bytes
 */
export type MemoryCallback = (used: number, max: number) => void;

/**
 * Configuration for memory budget enforcement.
 *
 * @example
 * ```typescript
 * const budget = new MemoryBudget({
 *   maxBytes: 100 * 1024 * 1024,  // 100MB
 *   warningThreshold: 0.8,        // Warn at 80%
 *   onWarning: (used, max) => {
 *     console.warn(`Memory warning: ${used}/${max} bytes`);
 *   },
 * });
 * ```
 */
export interface MemoryBudgetConfig {
  /**
   * Maximum allowed memory usage in bytes.
   * When exceeded, onExceeded callback is fired.
   */
  maxBytes: number;

  /**
   * Threshold (0-1) at which to fire warning callback.
   * @default 0.8 (80%)
   */
  warningThreshold?: number;

  /**
   * Callback fired when usage exceeds warningThreshold.
   * Useful for logging or preemptive cleanup.
   */
  onWarning?: MemoryCallback;

  /**
   * Callback fired when usage exceeds maxBytes.
   * Should trigger eviction or other cleanup.
   */
  onExceeded?: MemoryCallback;
}

/**
 * Result from checking memory budget status.
 */
export interface MemoryBudgetStatus {
  /** Whether usage is within budget */
  ok: boolean;

  /** Currently tracked usage in bytes */
  used: number;

  /** Remaining available bytes (can be negative if exceeded) */
  available: number;

  /** Usage as a percentage (0-100+) */
  percentage: number;
}

// ============================================================================
// Size Estimation
// ============================================================================

/**
 * Options for estimating memory size of values.
 */
export interface SizeEstimationOptions {
  /**
   * Include prototype chain in estimation.
   * @default false
   */
  includePrototype?: boolean;

  /**
   * Maximum depth to traverse for nested objects.
   * @default 10
   */
  maxDepth?: number;
}

// ============================================================================
// Embedding Storage
// ============================================================================

/**
 * Supported storage formats for embeddings.
 *
 * - `float64`: Standard `number[]` (8 bytes per float)
 * - `float32`: `Float32Array` (4 bytes per float, 50% savings)
 */
export type EmbeddingStorageFormat = 'float64' | 'float32';

/**
 * Memory constants for embedding storage.
 */
export const BYTES_PER_FLOAT64 = 8;
export const BYTES_PER_FLOAT32 = 4;

/**
 * Common embedding dimensions for reference.
 * Useful for memory planning.
 */
export const COMMON_DIMENSIONS = {
  /** OpenAI text-embedding-ada-002 */
  OPENAI_ADA: 1536,
  /** OpenAI text-embedding-3-small */
  OPENAI_SMALL: 1536,
  /** OpenAI text-embedding-3-large */
  OPENAI_LARGE: 3072,
  /** Cohere embed-english-v3.0 */
  COHERE_V3: 1024,
  /** BGE-small-en-v1.5 */
  BGE_SMALL: 384,
  /** BGE-base-en-v1.5 */
  BGE_BASE: 768,
  /** BGE-large-en-v1.5 */
  BGE_LARGE: 1024,
} as const;
