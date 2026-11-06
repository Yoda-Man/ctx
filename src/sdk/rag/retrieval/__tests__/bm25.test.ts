import { describe, it, expect } from 'vitest';

import { defaultTokenizer } from '../bm25.js';

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
