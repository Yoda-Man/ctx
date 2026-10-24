/**
 * Environment Variables
 *
 * ctx answers with a local Ollama model, so the only setting it reads from the
 * environment is where Ollama runs. A .env file in the working directory is
 * loaded too, for local development.
 */

import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ quiet: true }); // dotenv otherwise announces itself on every run

/** The Ollama server URL: OLLAMA_HOST, or Ollama's default address. */
export function getOllamaHost(): string {
  return process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434';
}
