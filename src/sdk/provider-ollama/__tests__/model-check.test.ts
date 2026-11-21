/**
 * The installed-model check matches the tag Ollama would run, so a configured
 * `qwen3.5` is not reported as available when only `qwen3.5:9b` is installed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasOllamaModel } from '../model-name.js';
import { OllamaProvider } from '../ollama-provider.js';
import { OllamaEmbeddingProvider } from '../../rag/embeddings/ollama-provider.js';

afterEach(() => vi.unstubAllGlobals());

describe('hasOllamaModel', () => {
  it('matches the exact tag, with no tag meaning :latest', () => {
    expect(hasOllamaModel(['qwen3.5:9b'], 'qwen3.5:9b')).toBe(true);
    expect(hasOllamaModel(['qwen3.5:latest'], 'qwen3.5')).toBe(true);
    expect(hasOllamaModel(['bge-m3'], 'bge-m3:latest')).toBe(true);
    expect(hasOllamaModel(['qwen3.5:9b'], 'qwen3.5')).toBe(false);
    expect(hasOllamaModel(['qwen3.5:9b'], 'qwen3.5:27b')).toBe(false);
    expect(hasOllamaModel(['qwen3.5-coder:latest'], 'qwen3.5')).toBe(false);
  });

  it('reads a registry port as part of the name, not a tag', () => {
    expect(hasOllamaModel(['host:5000/team/model:latest'], 'host:5000/team/model')).toBe(true);
  });
});

describe('isAvailable', () => {
  const tags = (...names: string[]) =>
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ models: names.map((name) => ({ name })) })));

  it('the chat provider needs the configured tag installed', async () => {
    tags('qwen3.5:9b');
    expect(await new OllamaProvider({ model: 'qwen3.5:27b' }).isAvailable()).toBe(false);
    expect(await new OllamaProvider({ model: 'qwen3.5:9b' }).isAvailable()).toBe(true);
  });

  it('the embedding provider needs the configured tag installed', async () => {
    tags('bge-m3:567m');
    expect(await new OllamaEmbeddingProvider({ model: 'bge-m3' }).isAvailable()).toBe(false);
    expect(await new OllamaEmbeddingProvider({ model: 'bge-m3:567m' }).isAvailable()).toBe(true);
  });
});
