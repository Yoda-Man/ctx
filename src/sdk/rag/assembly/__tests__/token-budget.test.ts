/**
 * BaseAssembler step 5: ctx's XMLAssembler calls
 * applyTokenBudget(chunks, maxTokens, 'drop', 100) with maxTokens from
 * `rag.max_tokens` (default 4000). 100 chars of XML overhead = 25 tokens a chunk.
 */
import { describe, it, expect } from 'vitest';
import {
  applyTokenBudget,
  calculateTokenBudget,
  estimateTokens,
  DEFAULT_TOKEN_BUDGET,
} from '../token-budget.js';
import type { Chunk } from '../../vector-store/types.js';

const XML_OVERHEAD = 100;
/** A chunk whose content costs exactly `tokens` tokens (4 chars each). */
const chunk = (id: string, tokens: number): Chunk => ({ id, content: 'x'.repeat(tokens * 4), metadata: {} });
const ids = (chunks: Chunk[]) => chunks.map((c) => c.id);

describe('estimateTokens', () => {
  it.each([
    ['', 0],
    ['abcd', 1],
    ['abcde', 2],
    ['x'.repeat(4000), 1000],
  ])('%j -> %d tokens (4 chars a token, rounded up)', (text, tokens) => {
    expect(estimateTokens(text)).toBe(tokens);
  });
});

describe('calculateTokenBudget', () => {
  it('uses maxTokens from the merged assembler config ctx builds', () => {
    expect(calculateTokenBudget({ ...DEFAULT_TOKEN_BUDGET, maxTokens: 4000 })).toBe(4000);
    expect(calculateTokenBudget({ ...DEFAULT_TOKEN_BUDGET, maxTokens: 16000 })).toBe(16000);
  });
});

describe('applyTokenBudget (drop, as ctx runs it)', () => {
  it('includes chunks in order until the budget is reached and reports the totals', () => {
    // each chunk: 100 content + 25 overhead = 125 tokens
    const chunks = [chunk('a', 100), chunk('b', 100), chunk('c', 100), chunk('d', 100)];
    const result = applyTokenBudget(chunks, 400, 'drop', XML_OVERHEAD);

    expect(ids(result.included)).toEqual(['a', 'b', 'c']);
    expect(ids(result.dropped)).toEqual(['d']);
    expect(result.usedTokens).toBe(375);
    expect(result.remainingTokens).toBe(25);
    expect(result.wasTruncated).toBe(false);
  });

  it('a chunk that lands exactly on the budget is kept', () => {
    const result = applyTokenBudget([chunk('a', 75), chunk('b', 75)], 200, 'drop', XML_OVERHEAD);
    expect(ids(result.included)).toEqual(['a', 'b']);
    expect(result.usedTokens).toBe(200);
    expect(result.remainingTokens).toBe(0);
  });

  it('skips an oversized chunk but keeps later ones that still fit', () => {
    const chunks = [chunk('big', 500), chunk('small', 50), chunk('also-small', 50)];
    const result = applyTokenBudget(chunks, 200, 'drop', XML_OVERHEAD);
    expect(ids(result.included)).toEqual(['small', 'also-small']);
    expect(ids(result.dropped)).toEqual(['big']);
    expect(result.usedTokens).toBe(150);
  });

  it('drops a chunk without cutting it, and leaves its content intact', () => {
    const big = chunk('big', 500);
    const result = applyTokenBudget([big], 200, 'drop', XML_OVERHEAD);
    expect(result.included).toEqual([]);
    expect(result.dropped[0]).toBe(big);
    expect(result.wasTruncated).toBe(false);
  });

  it('formatting overhead counts against the budget, so ten 0-token chunks cost 250 tokens', () => {
    const empties = Array.from({ length: 10 }, (_, i) => chunk(`e${i}`, 0));
    const result = applyTokenBudget(empties, 200, 'drop', XML_OVERHEAD);
    expect(result.included).toHaveLength(8);
    expect(result.usedTokens).toBe(200);
  });

  it('defaults to drop with 50 chars (13 tokens) of overhead', () => {
    const result = applyTokenBudget([chunk('a', 87), chunk('b', 87)], 150);
    expect(ids(result.included)).toEqual(['a']);
    expect(result.usedTokens).toBe(100);
    expect(result.wasTruncated).toBe(false);
  });

  it('no chunks, or a zero budget, includes nothing', () => {
    expect(applyTokenBudget([], 4000, 'drop', XML_OVERHEAD)).toEqual({
      included: [],
      dropped: [],
      usedTokens: 0,
      remainingTokens: 4000,
      wasTruncated: false,
    });
    const zero = applyTokenBudget([chunk('a', 1)], 0, 'drop', XML_OVERHEAD);
    expect(ids(zero.dropped)).toEqual(['a']);
    expect(zero.remainingTokens).toBe(0);
  });
});
