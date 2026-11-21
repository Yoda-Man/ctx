/**
 * Configuration Loader
 *
 * Handles the complete config lifecycle:
 * 1. Find/create config directory (~/.ctx)
 * 2. Load config.toml if it exists
 * 3. Validate with Zod schema
 * 4. Merge with defaults (user values override defaults)
 * 5. Provide type-safe access
 */

import * as fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import TOML from '@iarna/toml';
import { ConfigSchema, PartialConfigSchema, type Config, type PartialConfig } from './schema.js';
import { DEFAULT_CONFIG, CONFIG_TEMPLATE } from './defaults.js';
import { ConfigError } from '../errors/index.js';
import { getCtxDir, getConfigPath } from './paths.js';

// Re-export path functions and types for backwards compatibility
export {  getConfigPath };
export type { Config,  };

/**
 * Ensure the ~/.ctx directory exists
 */
function ensureCtxDir(): void {
  const ctxDir = getCtxDir();
  if (!fs.existsSync(ctxDir)) {
    fs.mkdirSync(ctxDir, { recursive: true });
  }
}

/**
 * Deep merge two objects, with source values overriding target
 * This handles nested objects properly (unlike Object.assign or spread)
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    // If both values are objects (not arrays, not null), recurse
    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      // Direct assignment for primitives or when source has a value
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Known config keys at each level of nesting.
 * Used to detect and warn about unknown/misspelled keys.
 */
const KNOWN_CONFIG_KEYS: Record<string, string[]> = {
  root: [
    'default_model',
    'default_provider',
    'embedding',
    'search',
    'rag',
    'indexing',
    'eval',
    'observability',
  ],
  embedding: ['provider', 'model', 'fallback_provider', 'fallback_model', 'batch_size', 'timeout_ms'],
  search: ['top_k'],
  rag: ['max_tokens', 'final_k', 'ordering'],
  indexing: ['ignore_patterns'],
  eval: ['golden_path', 'default_k', 'thresholds'],
  thresholds: ['mrr', 'hit_rate', 'precision_at_k'],
  observability: ['enabled', 'sample_rate'],
};

/**
 * Warn about unknown config fields that will be ignored.
 * Helps users catch typos like "embeding" instead of "embedding".
 */
function warnUnknownFields(
  parsed: Record<string, unknown>,
  level: string = 'root',
  prefix: string = ''
): void {
  const knownKeys = KNOWN_CONFIG_KEYS[level] ?? [];

  for (const key of Object.keys(parsed)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (!knownKeys.includes(key)) {
      console.warn(`Warning: Unknown config field '${fullKey}' will be ignored`);
    } else if (
      typeof parsed[key] === 'object' &&
      parsed[key] !== null &&
      !Array.isArray(parsed[key])
    ) {
      // Recurse into nested objects (embedding, search)
      warnUnknownFields(parsed[key] as Record<string, unknown>, key, fullKey);
    }
  }
}

/**
 * `search.rerank`, from 1.1.0 and earlier, is retired: reranking is opt-in
 * per search (`ctx search --rerank`). Every generated config.toml set it to
 * true, and the reranker then did nothing, so the line is dropped quietly.
 */
function dropRetiredKeys(parsed: Record<string, unknown>): string[][] {
  const search = parsed['search'] as Record<string, unknown> | undefined;
  if (typeof search !== 'object' || search === null || search['rerank'] === undefined) return [];
  delete search['rerank'];
  return [['search', 'rerank']];
}

/**
 * ctx answers only with a local Ollama model. A config written for a cloud
 * provider (anthropic, openai) would name a model Ollama does not have, so
 * both settings are dropped, with a warning, and the defaults apply.
 * Both drop helpers return the dotted paths they removed.
 */
function dropCloudProvider(parsed: Record<string, unknown>): string[][] {
  const provider = parsed['default_provider'];
  if (provider === undefined || provider === 'ollama') return [];
  console.warn(
    `Warning: default_provider = ${JSON.stringify(provider)} is ignored; ctx only uses local Ollama models. ` +
      'Set one with: ctx config set default_model <ollama model>'
  );
  const removed = [['default_provider'], ...(parsed['default_model'] === undefined ? [] : [['default_model']])];
  delete parsed['default_provider'];
  delete parsed['default_model'];
  return removed;
}

/**
 * Load and parse the config file
 * Returns the merged config (defaults + user overrides)
 *
 * @param createIfMissing - If true, creates default config on first run
 * @throws Error if config file exists but is invalid
 */
export function loadConfig(createIfMissing = true): Config {
  const configPath = getConfigPath();

  // If config doesn't exist, either create it or just use defaults
  if (!fs.existsSync(configPath)) {
    if (createIfMissing) {
      ensureCtxDir();
      fs.writeFileSync(configPath, CONFIG_TEMPLATE, 'utf-8');
    }
    return { ...DEFAULT_CONFIG };
  }

  // Read and parse the TOML file
  const content = fs.readFileSync(configPath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = TOML.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    throw new ConfigError(
      `Invalid TOML in config file: ${message}`,
      `Fix the syntax in ${configPath} or run: ctx config reset --force`
    );
  }

  // Warn about unknown fields (helps catch typos)
  if (typeof parsed === 'object' && parsed !== null) {
    dropRetiredKeys(parsed as Record<string, unknown>);
    warnUnknownFields(parsed as Record<string, unknown>);
    dropCloudProvider(parsed as Record<string, unknown>);
  }

  // Validate against the partial schema (allows missing fields)
  const validationResult = PartialConfigSchema.safeParse(parsed);

  if (!validationResult.success) {
    const issues = validationResult.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(
      `Invalid configuration:\n${issues}`,
      'Run: ctx config reset --force  to restore defaults'
    );
  }

  // Merge user config with defaults
  const userConfig = validationResult.data as PartialConfig;
  return deepMerge(DEFAULT_CONFIG, userConfig as Partial<Config>);
}

/**
 * Get a specific config value by dot-notation path
 * Example: getConfigValue('embedding.model') => 'BAAI/bge-large-en-v1.5'
 */
export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  const parts = key.split('.');

  let current: unknown = config;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a specific config value by dot-notation path, and write it to the
 * config file. Only known keys are accepted, and the file's comments and
 * layout are kept: just that one setting's line changes.
 */
export function setConfigValue(key: string, value: string): void {
  const configPath = getConfigPath();
  ensureCtxDir();

  const parts = key.split('.');
  // A key is known when each part is a field of the section before it, and it
  // names a setting, not a whole section
  const known = parts.every((part, i) => KNOWN_CONFIG_KEYS[i === 0 ? 'root' : parts[i - 1]!]?.includes(part));
  if (!known || parts.at(-1)! in KNOWN_CONFIG_KEYS) {
    throw new ConfigError(`Unknown config key: '${key}'`, 'Run: ctx config list  to see available keys');
  }

  // Load existing config or start fresh
  const text = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';
  const config = TOML.parse(text) as Record<string, unknown>;

  // Leave out what loadConfig() ignores anyway, as it would: the retired
  // search.rerank, and a cloud default_provider with its default_model. A
  // default_provider or default_model being set now is set below, after this.
  const removed = [...dropRetiredKeys(config), ...dropCloudProvider(config)].filter((path) => path.join('.') !== key);

  // Parse the value (try to convert to appropriate type)
  const parsedValue = parseValue(value);

  // Set the value at the nested path
  let current = config;
  for (const part of parts.slice(0, -1)) {
    if (typeof current[part] !== 'object' || current[part] === null) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = parsedValue;

  // Validate the complete config before saving, as loadConfig() will read it
  const merged = deepMerge(DEFAULT_CONFIG, config as Partial<Config>);
  const validationResult = ConfigSchema.safeParse(merged);

  if (!validationResult.success) {
    const issues = validationResult.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(
      `Invalid value for '${key}':\n${issues}`,
      'Run: ctx config list  to see current values and types'
    );
  }

  // Edit the one line; if the edited text would not read back as the intended
  // config (an unusual layout), rewrite the file, losing its comments
  const edited = removed.reduce((t, path) => setTomlLine(t, path, undefined), setTomlLine(text, parts, parsedValue));
  const safe = (() => {
    try {
      return isDeepStrictEqual(TOML.parse(edited), config);
    } catch {
      return false;
    }
  })();
  fs.writeFileSync(configPath, safe ? edited : TOML.stringify(config as TOML.JsonMap), 'utf-8');
}

/**
 * TOML text with `section.key = value` set: the key's line is replaced, keeping
 * its indent and trailing comment, or added at the end of its section, or in a
 * new section at the end of the file. A value of undefined removes the line.
 */
function setTomlLine(text: string, parts: string[], value: unknown): string {
  const section = parts.slice(0, -1).join('.');
  const key = parts.at(-1)!;
  // Values are scalars, and JSON's are valid TOML (TOML.stringify writes 60_000)
  const assignment = `${key} = ${JSON.stringify(value)}`;
  const lines = text.split('\n');
  const keyLine = new RegExp(`^(\\s*)${key}\\s*=.*?(\\s+#[^"']*)?$`);

  let current = '';
  let lastInSection = section === '' ? -1 : undefined; // root keys go before the first table
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(lines[i]!);
    if (header) {
      current = header[1]!.trim();
      if (current === section) lastInSection = i;
      continue;
    }
    if (current !== section) continue;
    const match = keyLine.exec(lines[i]!);
    if (match) {
      if (value === undefined) lines.splice(i, 1);
      else lines[i] = `${match[1]}${assignment}${match[2] ?? ''}`;
      return lines.join('\n');
    }
    if (lines[i]!.trim() !== '') lastInSection = i;
  }

  if (value === undefined) return text;
  if (lastInSection === undefined) {
    return `${text.replace(/\n*$/, '')}${text.trim() ? '\n\n' : ''}[${section}]\n${assignment}\n`;
  }
  lines.splice(lastInSection + 1, 0, assignment);
  return lines.join('\n');
}

/**
 * Parse a string value into the appropriate type
 * Handles booleans, numbers, and strings
 */
function parseValue(value: string): unknown {
  // Boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;

  // String (default)
  return value;
}

/**
 * List all config values in a flat format
 * Returns entries like ['default_model', 'llama3.2']
 */
export function listConfig(): Array<[string, unknown]> {
  const config = loadConfig();
  const entries: Array<[string, unknown]> = [];

  function flatten(obj: Record<string, unknown>, prefix = ''): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        flatten(value as Record<string, unknown>, fullKey);
      } else {
        entries.push([fullKey, value]);
      }
    }
  }

  flatten(config);
  return entries;
}
