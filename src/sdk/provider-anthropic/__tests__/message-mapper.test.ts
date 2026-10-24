import { describe, it, expect } from 'vitest';
import { buildRequestParams } from '../message-mapper.js';

describe('buildRequestParams', () => {
  const messages = [{ role: 'user' as const, content: 'Hi' }];

  it('asks for adaptive thinking, never a fixed budget current models reject', () => {
    const params = buildRequestParams('claude-opus-5-5', messages, {
      thinking: { enabled: true, budgetTokens: 5000 },
    }) as unknown as Record<string, unknown>;
    expect(params.thinking).toEqual({ type: 'adaptive' });
  });

  it('sends no sampling parameters, which the Messages API now rejects', () => {
    const params = buildRequestParams('claude-opus-5-5', messages, {
      temperature: 0.2,
      topP: 0.9,
    }) as unknown as Record<string, unknown>;
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('thinking');
  });
});
