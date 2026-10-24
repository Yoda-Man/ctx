/**
 * Trace Recording
 *
 * Decides whether an interaction is recorded to the local eval_traces table.
 * Applied at the command layer before calling insertTrace(). Nothing is ever
 * sent off the machine.
 *
 * [observability] enabled = false records nothing. Otherwise sample_rate
 * applies: 1.0 (default) records every interaction, 0.0 none, and values in
 * between record that fraction at random.
 */

/**
 * Check if this interaction should be recorded.
 *
 * @param observability - The [observability] config section (defaults apply when absent)
 * @returns true if this interaction should be recorded
 */
export function shouldRecord(observability?: { enabled?: boolean; sample_rate?: number }): boolean {
  if (observability?.enabled === false) return false;
  const sampleRate = observability?.sample_rate ?? 1.0;
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0.0) return false;
  return Math.random() < sampleRate;
}
