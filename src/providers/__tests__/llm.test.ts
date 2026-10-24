/**
 * ctx answers only with the local Ollama model named in config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLLMProvider } from '../llm.js';
import { createOllamaProvider } from '../ollama.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';

vi.mock('../ollama.js', () => ({
  createOllamaProvider: vi.fn(async (options: { model: string }) => ({
    provider: { name: 'ollama' },
    name: 'ollama',
    model: options.model,
    host: 'http://localhost:11434',
  })),
}));

describe('createLLMProvider', () => {
  beforeEach(() => {
    vi.mocked(createOllamaProvider).mockClear();
  });

  it('uses the Ollama model from config', async () => {
    const result = await createLLMProvider({ ...DEFAULT_CONFIG, default_model: 'qwen3.5:9b' });

    expect(result.name).toBe('ollama');
    expect(result.model).toBe('qwen3.5:9b');
    expect(createOllamaProvider).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen3.5:9b' }));
  });

  it('lets options.model override the config', async () => {
    const result = await createLLMProvider(DEFAULT_CONFIG, { model: 'llama3.2', skipAvailabilityCheck: true });

    expect(result.model).toBe('llama3.2');
    expect(createOllamaProvider).toHaveBeenCalledWith({ model: 'llama3.2', skipAvailabilityCheck: true });
  });

  it('reports Ollama being unavailable instead of trying anything else', async () => {
    vi.mocked(createOllamaProvider).mockRejectedValueOnce(new Error('Ollama is not running'));

    await expect(createLLMProvider(DEFAULT_CONFIG)).rejects.toThrow('Ollama is not running');
    expect(createOllamaProvider).toHaveBeenCalledTimes(1);
  });
});
