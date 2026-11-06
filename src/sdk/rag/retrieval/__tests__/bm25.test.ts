import { describe, it, expect } from 'vitest';

import { BM25Retriever, defaultTokenizer } from '../bm25.js';

describe('defaultTokenizer', () => {
  it('keeps a camelCase identifier whole and adds its parts', () => {
    expect(defaultTokenizer('getUserById')).toEqual(['getuserbyid', 'get', 'user', 'by', 'id']);
    expect(defaultTokenizer('HTTPServer')).toEqual(['httpserver', 'http', 'server']);
  });

  it('splits on punctuation and drops one-character tokens', () => {
    expect(defaultTokenizer('ERR_CONN_RESET')).toEqual(['err', 'conn', 'reset']);
    expect(defaultTokenizer('Is x a v2 API?')).toEqual(['is', 'v2', 'api']);
  });
});

describe('BM25Retriever filter', () => {
  it('filters before the topK cut', async () => {
    const doc = (id: string, content: string, fileType: string) => ({
      id,
      content,
      chunk: { id, content, metadata: { fileType } },
    });
    const retriever = new BM25Retriever();
    retriever.buildIndex([
      doc('a', 'session refresh session refresh', 'code'),
      doc('b', 'session refresh session', 'code'),
      doc('c', 'session refresh notes', 'docs'),
    ]);

    // The docs chunk ranks last, so filtering after a topK of 1 found nothing
    const results = await retriever.retrieve('session refresh', { topK: 1, filter: { fileType: 'docs' } });
    expect(results.map((r) => r.id)).toEqual(['c']);
  });
});
