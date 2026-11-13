/**
 * Keyword search tokenizer.
 *
 * Used on both sides of ctx's keyword (BM25) search, which runs in SQLite
 * FTS5: by the ctx_tokens() SQL function when chunks are indexed (see
 * database/connection.ts and migration 008) and on each query
 * (search/bm25-store.ts), so the two always split text the same way.
 */

import { stemmer } from 'stemmer';

/** Boundaries inside a camelCase or PascalCase word: getUser|By|Id, HTTP|Server. */
const CAMEL_BOUNDARY = /(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;

/**
 * Default tokenizer: lowercase, split on whitespace and punctuation.
 *
 * A camelCase word gives the whole word and its parts (getUserById →
 * getuserbyid, get, user, by, id), so both the exact identifier and a query
 * that spells it out in words can match.
 *
 * Letters and digits of any script count; there is no stemming or stop-word list.
 */
export const defaultTokenizer = (text: string): string[] => {
  const tokens: string[] = [];
  // Split on punctuation and non-alphanumeric characters
  for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
    const parts = word.split(CAMEL_BOUNDARY);
    if (parts.length > 1) tokens.push(word.toLowerCase());
    for (const part of parts) tokens.push(part.toLowerCase());
  }
  // Each word also gives its stem (authentication -> authent), so related
  // forms match while the exact word still does; numbers are left alone
  const withStems: string[] = [];
  for (const token of tokens) {
    if (token.length < 2) continue;
    withStems.push(token);
    if (!/\d/.test(token)) {
      const stem = stemmer(token);
      if (stem !== token && stem.length >= 2) withStems.push(stem);
    }
  }
  return withStems;
};
