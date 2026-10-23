/**
 * Retry and Error Recovery Types
 *
 * These types define the configuration and context for:
 * - RetryStrategy: Exponential backoff with jitter
 * - CircuitBreaker: Fail-fast on repeated failures
 * - ErrorRecovery: Orchestrates retry + fallback
 */

/**
 * Configuration for retry behavior with exponential backoff.
 *
 * The delay formula is: min(baseDelayMs * (backoffMultiplier ^ attempt), maxDelayMs)
 * With optional jitter to prevent thundering herd.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /** Error codes that should trigger retry (default: all errors) */
  retryableErrors?: string[];
  /** Add randomness to delay to prevent thundering herd (default: true) */
  jitter?: boolean;
}

/**
 * Default retry options - sensible defaults for most use cases.
 */
export const DEFAULT_RETRY_OPTIONS: Required<
  Omit<RetryOptions, 'retryableErrors'>
> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Context provided to error callbacks for logging and custom handling.
 */
export interface ErrorContext {
  /** The error that occurred */
  error: Error;
  /** Current attempt number (1-indexed) */
  attempt: number;
  /** Maximum retries configured */
  maxRetries: number;
  /** Name of the tool that failed (if applicable) */
  toolName?: string;
  /** Input that was passed to the operation */
  input?: unknown;
  /** Time elapsed since first attempt in milliseconds */
  elapsedMs: number;
}

/**
 * Configuration for error recovery behavior including fallbacks and callbacks.
 */
export interface ErrorRecoveryOptions {
  /** Response to return when all retries exhausted (prevents throwing) */
  fallbackResponse?: string;
  /** Called on every error (for logging/metrics) */
  onError?: (context: ErrorContext) => void;
  /** Called before each retry attempt */
  onRetry?: (context: ErrorContext) => void;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * Circuit breaker states following the standard pattern.
 */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Configuration for circuit breaker behavior.
 *
 * State transitions:
 * - CLOSED: Normal operation, tracking failures
 * - OPEN: Rejecting all requests immediately
 * - HALF_OPEN: Testing with limited requests
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting half-open (default: 60000) */
  resetTimeoutMs: number;
  /** Number of requests to allow in half-open state (default: 1) */
  halfOpenRequests: number;
}

/**
 * Default circuit breaker options.
 */
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  halfOpenRequests: 1,
};

/**
 * Combined options for the ErrorRecovery class.
 */
export interface ErrorRecoveryConfig {
  retry?: Partial<RetryOptions>;
  recovery?: ErrorRecoveryOptions;
  circuitBreaker?: Partial<CircuitBreakerOptions>;
}
