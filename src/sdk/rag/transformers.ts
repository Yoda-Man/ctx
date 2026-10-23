/**
 * The one place the embedding provider and reranker load transformers.js,
 * so both use the same library and keep their models in ~/.ctx/models.
 */
import { MODELS_DIR } from '../../config/paths.js';

export async function loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = MODELS_DIR;
  return transformers;
}
