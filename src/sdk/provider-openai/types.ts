import type { GenerateOptions, LLMProviderConfig } from '../core/index.js';

/**
 * Configuration for the OpenAI provider.
 *
 * @example
 * ```typescript
 * const config: OpenAIProviderConfig = {
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-4o',
 *   organization: 'org-xxx', // optional
 *   baseURL: 'https://api.openai.com/v1', // optional, for OpenRouter etc.
 * };
 * ```
 */
export interface OpenAIProviderConfig extends LLMProviderConfig {
  /**
   * OpenAI API key. Required unless using a custom baseURL that doesn't need auth.
   */
  apiKey: string;

  /**
   * Model identifier (e.g., 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo').
   */
  model: string;

  /**
   * Optional organization ID for OpenAI API requests.
   */
  organization?: string;

  /**
   * Optional base URL for the API. Useful for:
   * - OpenRouter: 'https://openrouter.ai/api/v1'
   * - Azure OpenAI: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}'
   * - Local proxies or self-hosted endpoints
   */
  baseURL?: string;

  /**
   * Default generation options applied to all requests.
   * Can be overridden per-request.
   */
  defaultOptions?: Partial<GenerateOptions>;

  /**
   * Request timeout in milliseconds. Default: 60000 (60 seconds).
   */
  timeout?: number;

  /**
   * Maximum number of retries for failed requests. Default: 2.
   */
  maxRetries?: number;

  /**
   * Additional headers to include in API requests.
   */
  headers?: Record<string, string>;
}

/**
 * Internal state for tracking rate limits from response headers.
 */
export interface RateLimitState {
  requestsRemaining: number | null;
  requestsLimit: number | null;
  tokensRemaining: number | null;
  tokensLimit: number | null;
  resetAt: number | null;
}
