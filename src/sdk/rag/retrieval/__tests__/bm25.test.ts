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

describe('defaultTokenizer stems', () => {
  it('adds the stem after a word, so related forms share a token', () => {
    expect(defaultTokenizer('authentication')).toEqual(['authentication', 'authent']);
    expect(defaultTokenizer('authenticate')).toEqual(['authenticate', 'authent']);
    expect(defaultTokenizer('refreshing sessions')).toEqual(['refreshing', 'refresh', 'sessions', 'session']);
  });

  it('leaves words without a shorter stem, and numbers, alone', () => {
    expect(defaultTokenizer('user v2 4821')).toEqual(['user', 'v2', '4821']);
  });
});
