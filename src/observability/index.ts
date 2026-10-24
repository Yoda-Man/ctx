/**
 * Observability Module
 *
 * Interactions are recorded to the local eval_traces table only, as
 * [observability] in config.toml allows.
 */

export { shouldRecord } from './sampling.js';
