/**
 * Environment Variables
 *
 * ctx answers with a local Ollama model, so the only setting it reads from the
 * environment is where Ollama runs. A .env file in the working directory is
 * loaded too, for local development.
 */

// Node reads .env itself (20.12+); values already in the environment win. No .env is fine.
try {
  process.loadEnvFile();
} catch {
  // ENOENT: no .env in this directory
}

/** The Ollama server URL: OLLAMA_HOST, or Ollama's default address. */
export function getOllamaHost(): string {
  return process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434';
}
