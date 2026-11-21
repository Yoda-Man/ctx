/**
 * Ollama model names, shared by the chat provider and the embedding provider.
 */

/** A model name with Ollama's implied tag: `bge-m3` means `bge-m3:latest`. */
const withTag = (name: string) => (/:[^/]*$/.test(name) ? name : `${name}:latest`);

/**
 * Whether `model` is among the installed model names from /api/tags, as Ollama
 * would resolve it: `qwen3.5` is only `qwen3.5:latest`, not `qwen3.5:9b`.
 */
export function hasOllamaModel(installed: string[], model: string): boolean {
  return installed.some((name) => withTag(name) === withTag(model));
}
