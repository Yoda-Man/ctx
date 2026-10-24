/**
 * LLM Provider Factory
 *
 * ctx answers with a local model through Ollama, and only that: no code or
 * question leaves the machine. This creates the provider from config.
 *
 * USAGE:
 * ```typescript
 * import { loadConfig } from '../config';
 * import { createLLMProvider } from '../providers';
 *
 * const config = await loadConfig();
 * const { provider, name, model } = await createLLMProvider(config);
 *
 * const response = await provider.chat([
 *   { role: 'user', content: 'Hello!' }
 * ]);
 * ```
 */

import type { LLMProvider } from '../sdk/core/index.js';
import type { Config } from '../config/schema.js';
import { createOllamaProvider, type OllamaProviderOptions } from './ollama.js';

/** Result of creating the LLM provider, with metadata for logs. */
interface LLMProviderResult {
  /** The configured provider instance (implements LLMProvider interface) */
  provider: LLMProvider;
  /** Provider name for identification in logs */
  name: 'ollama';
  /** Model being used (e.g., 'llama3.2', 'qwen3.5:9b') */
  model: string;
}

/** Options for creating the LLM provider. */
export interface LLMProviderOptions extends Omit<OllamaProviderOptions, 'model'> {
  /**
   * Override the model from config.
   * Takes precedence over config.default_model.
   */
  model?: string;
}

/**
 * Create the local Ollama provider for config.default_model.
 *
 * @throws Error if Ollama is not running or the model is not pulled
 *   (unless skipAvailabilityCheck)
 */
export async function createLLMProvider(
  config: Config,
  options: LLMProviderOptions = {}
): Promise<LLMProviderResult> {
  const { provider, name, model } = await createOllamaProvider({
    ...options,
    model: options.model ?? config.default_model,
  });
  return { provider, name, model };
}
