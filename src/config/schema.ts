/**
 * Configuration Schema
 *
 * Defines the shape of ~/.ctx/config.toml using Zod.
 * This provides both TypeScript types AND runtime validation.
 */

import { z } from 'zod';
import { RAGConfigSchema } from '../agent/types.js';
import { EvalConfigSchema, ObservabilityConfigSchema } from '../eval/types.js';

/**
 * Embedding provider configuration
 * Supports multiple providers: Huggingface (local), Ollama (local), or cloud APIs
 */
export const EmbeddingConfigSchema = z.object({
  provider: z
    .enum(['huggingface', 'ollama', 'openai'])
    .describe('Embedding provider (huggingface for local BGE, ollama for nomic-embed)'),
  model: z.string().describe('Embedding model name'),
  fallback_provider: z
    .enum(['huggingface', 'ollama', 'openai'])
    .optional()
    .describe('Fallback provider if primary fails'),
  fallback_model: z
    .string()
    .optional()
    .describe('Fallback model name'),
  batch_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(32)
    .describe('Number of texts to embed per batch (1-100, default 32)'),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(600000)
    .default(120000)
    .describe('Timeout in milliseconds for embedding operations (1000-600000, default 120000 = 2 minutes)'),
});

/**
 * Search configuration
 * Controls how semantic search behaves
 */
const SearchConfigSchema = z.object({
  top_k: z.number().int().min(1).max(100).describe('Number of results to return'),
  rerank: z.boolean().describe('Whether to rerank results for better relevance'),
});

/**
 * LLM provider type (used in multiple schemas)
 */
export const LLMProviderTypeSchema = z.enum(['anthropic', 'openai', 'ollama']);

/**
 * LLM configuration with fallback support
 * This section is optional - defaults work without it
 */
const LLMConfigSchema = z.object({
  /** Fallback providers in order of preference (omit to use defaults) */
  fallback_providers: z
    .array(LLMProviderTypeSchema)
    .optional()
    .describe('Fallback providers if primary fails (e.g., ["openai", "ollama"])'),
  /** Model to use per fallback provider (uses defaults if omitted) */
  fallback_models: z
    .record(LLMProviderTypeSchema, z.string())
    .optional()
    .describe('Model to use per fallback provider (e.g., { openai: "gpt-4o" })'),
});

/**
 * Indexing configuration
 * Controls file discovery behavior during indexing
 */
const IndexingConfigSchema = z.object({
  ignore_patterns: z
    .array(z.string())
    .optional()
    .describe('Additional gitignore-style patterns to ignore during indexing'),
});

/**
 * Root configuration schema
 * This is the complete shape of config.toml
 */
export const ConfigSchema = z.object({
  default_model: z.string().describe('Default LLM model for ask command'),
  default_provider: LLMProviderTypeSchema.describe('LLM provider to use'),
  embedding: EmbeddingConfigSchema,
  search: SearchConfigSchema,
  /** Optional LLM fallback configuration */
  llm: LLMConfigSchema.optional(),
  /** Optional RAG pipeline configuration */
  rag: RAGConfigSchema.optional(),
  /** Optional indexing configuration */
  indexing: IndexingConfigSchema.optional(),
  /** Optional evaluation configuration */
  eval: EvalConfigSchema.optional(),
  /** Optional observability configuration */
  observability: ObservabilityConfigSchema.optional(),
});

/**
 * TypeScript type inferred from the schema
 * Use this for type-safe config access throughout the codebase
 */
export type Config = z.infer<typeof ConfigSchema>;

/** Every field optional, at every depth. */
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

/**
 * What zod 3's deepPartial() did (removed in zod 4): every field optional,
 * nested objects included, and defaults not applied, so a missing field stays
 * missing and the loader merges in the default.
 */
function deepPartial(schema: z.ZodObject): z.ZodObject {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      let inner = field as z.ZodType;
      while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
      return [key, (inner instanceof z.ZodObject ? deepPartial(inner) : inner).optional()];
    })
  );
  return z.object(shape);
}

/**
 * Partial config for merging user overrides with defaults
 * Every field becomes optional, allowing sparse config files
 */
export const PartialConfigSchema = deepPartial(ConfigSchema) as unknown as z.ZodType<DeepPartial<Config>>;
export type PartialConfig = DeepPartial<Config>;
