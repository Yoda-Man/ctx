import type { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

/**
 * Error severity level for categorizing errors.
 *
 * - `fatal`: Unrecoverable error, application should terminate
 * - `error`: Operation failed, but application can continue
 * - `warning`: Operation completed with issues, user should be notified
 * - `info`: Informational, not a real error (rare in error classes)
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

/**
 * Options for constructing a ContextAIError.
 */
export interface ContextAIErrorOptions {
  /** Error severity level */
  severity?: ErrorSeverity;
  /** URL to documentation for this error */
  docsUrl?: string;
  /** Underlying error that caused this one */
  cause?: Error;
}

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base error class for ContextAI SDK.
 *
 * All ContextAI errors extend this class and provide:
 * - **code**: Machine-readable error code for programmatic handling
 * - **severity**: Error categorization (fatal, error, warning, info)
 * - **troubleshootingHint**: Actionable guidance for developers
 * - **isRetryable**: Whether the operation might succeed on retry
 * - **retryAfterMs**: Suggested delay before retrying
 *
 * @example
 * ```typescript
 * try {
 *   await agent.run(input);
 * } catch (error) {
 *   if (error instanceof ContextAIError) {
 *     console.error(`[${error.code}] ${error.message}`);
 *     if (error.troubleshootingHint) {
 *       console.error(`Hint: ${error.troubleshootingHint}`);
 *     }
 *     if (error.isRetryable) {
 *       await delay(error.retryAfterMs ?? 1000);
 *       // retry...
 *     }
 *   }
 * }
 * ```
 */
export class ContextAIError extends Error {
  /** Machine-readable error code for programmatic handling */
  readonly code: string;

  /** Error severity level */
  readonly severity: ErrorSeverity;

  /** URL to documentation for this error */
  readonly docsUrl?: string;

  /** Underlying error that caused this one (for error chaining) */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: string = 'CONTEXTAI_ERROR',
    options?: ContextAIErrorOptions
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ContextAIError';
    this.code = code;
    this.severity = options?.severity ?? 'error';
    this.docsUrl = options?.docsUrl;
    this.cause = options?.cause;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Whether this error is transient and the operation could succeed if retried.
   *
   * Override in subclasses to provide specific retry logic.
   * Examples of retryable errors: rate limits, timeouts, network issues.
   *
   * @returns `true` if the error is retryable, `false` otherwise
   */
  get isRetryable(): boolean {
    return false;
  }

  /**
   * Suggested delay in milliseconds before retrying the operation.
   *
   * Override in subclasses to provide specific retry delays.
   * Only meaningful when `isRetryable` returns `true`.
   *
   * @returns Delay in ms, or `null` if not retryable
   */
  get retryAfterMs(): number | null {
    return null;
  }

  /**
   * User-friendly troubleshooting hint with actionable guidance.
   *
   * Override in subclasses to provide specific troubleshooting steps.
   * Should explain what went wrong and how to fix it.
   *
   * @returns Troubleshooting hint, or `null` if not available
   */
  get troubleshootingHint(): string | null {
    return null;
  }
}

/**
 * Agent-related errors
 *
 * Thrown when:
 * - Agent execution fails
 * - Max iterations exceeded
 * - Agent aborted
 */
export class AgentError extends ContextAIError {
  constructor(message: string) {
    super(message, 'AGENT_ERROR');
    this.name = 'AgentError';
  }
}

/**
 * Tool-related errors
 *
 * Thrown when:
 * - Tool execution fails
 * - Tool not found
 * - Tool timeout
 */
export class ToolError extends ContextAIError {
  readonly toolName: string;
  readonly cause?: Error;

  constructor(
    message: string,
    toolName: string,
    cause?: Error,
    code: string = 'TOOL_ERROR'
  ) {
    super(message, code);
    this.name = 'ToolError';
    this.toolName = toolName;
    this.cause = cause;
  }
}

/**
 * Tool timeout error
 *
 * Thrown when:
 * - Tool execution exceeds configured timeout
 */

export class ToolTimeoutError extends ToolError {
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(
      `Tool "${toolName}" timed out after ${timeoutMs}ms`,
      toolName,
      undefined,
      'TOOL_TIMEOUT_ERROR'
    );
    this.name = 'ToolTimeoutError';
    this.timeoutMs = timeoutMs;
  }

  /**
   * Timeouts are typically retryable.
   */
  override get isRetryable(): boolean {
    return true;
  }

  /**
   * Wait the same duration as the timeout before retrying.
   */
  override get retryAfterMs(): number {
    return this.timeoutMs;
  }

  /**
   * Provide actionable guidance for timeout errors.
   */
  override get troubleshootingHint(): string {
    return `Tool "${this.toolName}" took longer than ${this.timeoutMs}ms. Consider increasing the timeout or optimizing the tool implementation.`;
  }
}

/**
 * Error thrown when tool output fails validation
 */
export class ToolOutputValidationError extends ToolError {
  readonly issues: Array<{ path: string; message: string }>;

  constructor(
    toolName: string,
    issues: Array<{ path: string; message: string }>
  ) {
    const issueMessages = issues
      .map((i) => `${i.path}: ${i.message}`)
      .join(', ');
    super(
      `Tool "${toolName}" output validation failed: ${issueMessages}`,
      toolName,
      undefined,
      'TOOL_OUTPUT_VALIDATION_ERROR'
    );
    this.name = 'ToolOutputValidationError';
    this.issues = issues;
  }
}

/**
 * Provider-related errors
 *
 * Thrown when:
 * - LLM API call fails
 * - Rate limit exceeded
 * - Authentication fails
 */
export class ProviderError extends ContextAIError {
  readonly provider: string;
  readonly statusCode?: number;

  constructor(message: string, provider: string, statusCode?: number) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

/**
 * Validation errors (Zod-based)
 *
 * Thrown when:
 * - Tool input validation fails
 * - Configuration validation fails
 */
export class ValidationError extends ContextAIError {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.issues = issues;
  }

  /**
   * Format issues as a human-readable string
   */
  formatIssues(): string {
    return this.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
  }
}
