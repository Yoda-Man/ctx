import type { GenerateOptions, LLMProviderConfig } from '../core/index.js';

/**
 * Configuration for the Anthropic Claude provider.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicProvider({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   model: 'claude-sonnet-4-20250514',
 * });
 * ```
 */
export interface AnthropicProviderConfig extends LLMProviderConfig {
  /**
   * Anthropic API key.
   * Get one at: https://console.anthropic.com/
   */
  apiKey: string;

  /**
   * Model identifier.
   * Examples: 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'
   */
  model: string;

  /**
   * Base URL for the Anthropic API.
   * @default 'https://api.anthropic.com'
   */
  baseURL?: string;

  /**
   * Default generation options applied to all requests.
   * Can be overridden per-request.
   */
  defaultOptions?: Partial<GenerateOptions>;

  /**
   * Request timeout in milliseconds.
   * @default 60000 (60 seconds)
   */
  timeout?: number;

  /**
   * Maximum number of retries for failed requests.
   * @default 2
   */
  maxRetries?: number;

  /**
   * Custom headers to include in all requests.
   */
  headers?: Record<string, string>;

  /**
   * Enable beta features.
   * Adds the 'anthropic-beta' header with the specified features.
   * @example ['prompt-caching-2024-07-31', 'max-tokens-3-5-sonnet-2024-07-15']
   */
  betaFeatures?: string[];
}

/**
 * Tracks rate limit information from Anthropic response headers.
 *
 * Anthropic returns these headers:
 * - anthropic-ratelimit-requests-limit
 * - anthropic-ratelimit-requests-remaining
 * - anthropic-ratelimit-requests-reset
 * - anthropic-ratelimit-tokens-limit
 * - anthropic-ratelimit-tokens-remaining
 * - anthropic-ratelimit-tokens-reset
 */
export interface RateLimitState {
  /** Maximum requests allowed in the current window */
  requestsLimit: number | null;
  /** Remaining requests in the current window */
  requestsRemaining: number | null;
  /** When the request limit resets (Unix timestamp ms) */
  requestsResetAt: number | null;
  /** Maximum tokens allowed in the current window */
  tokensLimit: number | null;
  /** Remaining tokens in the current window */
  tokensRemaining: number | null;
  /** When the token limit resets (Unix timestamp ms) */
  tokensResetAt: number | null;
}
