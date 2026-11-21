/**
 * `ctx config set` accepts only known keys and changes just the one setting's
 * line, so the config file keeps its comments.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'ctx-config-set-'));
const file = join(dir, 'config.toml');
vi.mock('../paths.js', () => ({ getCtxDir: () => dir, getConfigPath: () => file }));

const { setConfigValue, loadConfig } = await import('../loader.js');
const { CONFIG_TEMPLATE } = await import('../defaults.js');

afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => writeFileSync(file, CONFIG_TEMPLATE));

describe('setConfigValue', () => {
  it('changes only the setting, keeping comments', () => {
    setConfigValue('embedding.timeout_ms', '60000');

    const before = CONFIG_TEMPLATE.split('\n');
    const after = readFileSync(file, 'utf-8').split('\n');
    const changed = after.filter((line, i) => line !== before[i]);
    expect(after).toHaveLength(before.length);
    expect(changed).toEqual(['timeout_ms = 60000  # 2 minutes (allows for model download)']);
    expect(loadConfig().embedding.timeout_ms).toBe(60000);
  });

  it('adds a setting missing from its section, and a missing section', () => {
    writeFileSync(file, '# mine\ndefault_model = "qwen3.5:9b"\n\n[search]\n# results\ntop_k = 5\n');

    setConfigValue('rag.final_k', '8');
    setConfigValue('embedding.batch_size', '16');
    setConfigValue('default_model', 'qwen3.5:27b');

    const text = readFileSync(file, 'utf-8');
    expect(text).toContain('# mine\ndefault_model = "qwen3.5:27b"\n');
    expect(text).toContain('[search]\n# results\ntop_k = 5\n');
    const config = loadConfig();
    expect(config.rag?.final_k).toBe(8);
    expect(config.embedding.batch_size).toBe(16);
    expect(config.search.top_k).toBe(5);
  });

  it('rejects an unknown key and leaves the file alone', () => {
    for (const key of ['embeding.model', 'search.topk', 'search', 'eval.thresholds.speed', 'nope']) {
      expect(() => setConfigValue(key, '1')).toThrow(/Unknown config key/);
    }
    expect(readFileSync(file, 'utf-8')).toBe(CONFIG_TEMPLATE);
  });

  it('rewrites the file when the line cannot be edited safely', () => {
    writeFileSync(file, '# dotted keys, not a [search] table\nsearch.top_k = 5\n');
    setConfigValue('search.top_k', '7');
    expect(loadConfig().search.top_k).toBe(7);
  });

  it('removes what loading ignores, keeping the rest', () => {
    writeFileSync(file, '# mine\ndefault_provider = "openai"\ndefault_model = "gpt-4o"\n\n[search]\ntop_k = 5\nrerank = true\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    setConfigValue('default_model', 'qwen3.5:9b');

    expect(readFileSync(file, 'utf-8')).toBe('# mine\ndefault_model = "qwen3.5:9b"\n\n[search]\ntop_k = 5\n');
    expect(loadConfig().default_model).toBe('qwen3.5:9b'); // no longer hidden by the cloud provider
  });

  it('removes a cloud provider and its model when another key is set', () => {
    writeFileSync(file, 'default_provider = "openai"\ndefault_model = "gpt-4o"\n\n[search]\ntop_k = 5\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    setConfigValue('search.top_k', '7');

    expect(readFileSync(file, 'utf-8')).toBe('\n[search]\ntop_k = 7\n');
    expect(loadConfig().default_model).toBe('llama3.2'); // the default, not gpt-4o
  });

  it('refuses a cloud provider', () => {
    expect(() => setConfigValue('default_provider', 'anthropic')).toThrow(/Invalid value for 'default_provider'/);
    expect(readFileSync(file, 'utf-8')).toBe(CONFIG_TEMPLATE);
  });

  it('accepts nested keys', () => {
    setConfigValue('eval.thresholds.mrr', '0.8');
    expect(loadConfig().eval?.thresholds?.mrr).toBe(0.8);
  });
});
