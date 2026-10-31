/**
 * LRUCacheProvider as ctx uses it: count-based, as the embedding cache
 * (default 10000 entries, no TTL) and as the RAG result cache (50 entries,
 * 5-minute default TTL, per-call TTL override).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LRUCacheProvider } from '../lru-cache.js';

afterEach(() => { vi.useRealTimers(); });

/** Which of `keys` are still cached, read without touching recency. */
async function present(cache: LRUCacheProvider<number>, keys: string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const key of keys) if (await cache.has(key)) kept.push(key);
  return kept;
}

describe('LRUCacheProvider eviction', () => {
  it('evicts the least recently used entry, and get() counts as a use', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 3 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    expect(await cache.get('a')).toBe(1); // a is now the most recent; b is the oldest

    await cache.set('d', 4);

    expect(await present(cache, ['a', 'b', 'c', 'd'])).toEqual(['a', 'c', 'd']);
    expect(cache.size()).toBe(3);
  });

  it('evicts in insertion order when nothing is read', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 2 });
    for (const [i, key] of ['a', 'b', 'c', 'd', 'e'].entries()) await cache.set(key, i);

    expect(await present(cache, ['a', 'b', 'c', 'd', 'e'])).toEqual(['d', 'e']);
  });

  it('has() does not refresh recency', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    expect(await cache.has('a')).toBe(true);

    await cache.set('c', 3);

    expect(await present(cache, ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });

  it('overwriting a key replaces the value, makes it most recent, and does not grow the cache', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('a', 10);
    expect(cache.size()).toBe(2);

    await cache.set('c', 3);

    expect(await cache.get('a')).toBe(10);
    expect(await present(cache, ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('defaults to 10000 entries, the size the embedding cache gets from ctx', async () => {
    const cache = new LRUCacheProvider<number>();
    for (let i = 0; i <= 10000; i++) await cache.set(`k${i}`, i);

    expect(cache.size()).toBe(10000);
    expect(await cache.has('k0')).toBe(false);
    expect(await cache.get('k1')).toBe(1);
    expect(await cache.get('k10000')).toBe(10000);
  });

  it('a miss returns undefined', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 2 });
    await cache.set('a', 0); // a falsy value is still a hit
    expect(await cache.get('a')).toBe(0);
    expect(await cache.get('nope')).toBeUndefined();
  });
});

describe('LRUCacheProvider delete and clear keep the list consistent', () => {
  it('deleting the oldest entry makes the next oldest the one evicted', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 3 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);

    expect(await cache.delete('a')).toBe(true);
    expect(await cache.delete('a')).toBe(false);
    await cache.set('d', 4);
    await cache.set('e', 5);

    expect(await present(cache, ['a', 'b', 'c', 'd', 'e'])).toEqual(['c', 'd', 'e']);
  });

  it('deleting the newest and a middle entry leaves eviction order intact', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 3 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    await cache.delete('c'); // head
    await cache.delete('b'); // now head again, after a

    await cache.set('d', 4);
    await cache.set('e', 5);
    await cache.set('f', 6);

    expect(await present(cache, ['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['d', 'e', 'f']);
  });

  it('evicting the only entry leaves an empty, usable cache', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 1 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);

    expect(await present(cache, ['a', 'b', 'c'])).toEqual(['c']);
    expect(cache.size()).toBe(1);
  });

  it('clear() empties the cache and it evicts correctly afterwards', async () => {
    const cache = new LRUCacheProvider<number>({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);

    await cache.clear();
    expect(cache.size()).toBe(0);
    expect(await cache.get('a')).toBeUndefined();

    await cache.set('x', 1);
    await cache.set('y', 2);
    await cache.set('z', 3);
    expect(await present(cache, ['a', 'b', 'x', 'y', 'z'])).toEqual(['y', 'z']);
  });
});

describe('LRUCacheProvider TTL (the RAG result cache)', () => {
  it('an entry expires exactly at its default TTL and get() removes it', async () => {
    vi.useFakeTimers();
    const cache = new LRUCacheProvider<number>({ maxSize: 50, defaultTtl: 1000 });
    await cache.set('q', 1);

    vi.advanceTimersByTime(999);
    expect(await cache.get('q')).toBe(1);

    vi.advanceTimersByTime(1);
    expect(await cache.has('q')).toBe(false);
    expect(cache.size()).toBe(1); // has() only reports, it does not remove
    expect(await cache.get('q')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('a per-call TTL overrides the default; undefined falls back to it', async () => {
    vi.useFakeTimers();
    const cache = new LRUCacheProvider<number>({ defaultTtl: 1000 });
    await cache.set('short', 1, 50);
    await cache.set('default', 2, undefined);

    vi.advanceTimersByTime(50);
    expect(await cache.get('short')).toBeUndefined();
    expect(await cache.get('default')).toBe(2);

    vi.advanceTimersByTime(950);
    expect(await cache.get('default')).toBeUndefined();
  });

  it('overwriting an entry restarts its TTL', async () => {
    vi.useFakeTimers();
    const cache = new LRUCacheProvider<number>({ defaultTtl: 1000 });
    await cache.set('q', 1);
    vi.advanceTimersByTime(800);
    await cache.set('q', 2);

    vi.advanceTimersByTime(800);
    expect(await cache.get('q')).toBe(2);
  });

  it('without a TTL entries never expire', async () => {
    vi.useFakeTimers();
    const cache = new LRUCacheProvider<number>({ maxSize: 2 });
    await cache.set('a', 1);

    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
    expect(await cache.get('a')).toBe(1);
  });

  it('removing an expired entry from the middle keeps eviction order intact', async () => {
    vi.useFakeTimers();
    const cache = new LRUCacheProvider<number>({ maxSize: 3 });
    await cache.set('a', 1);
    await cache.set('b', 2, 10);
    await cache.set('c', 3);
    vi.advanceTimersByTime(10);

    expect(await cache.get('b')).toBeUndefined();
    await cache.set('d', 4);
    await cache.set('e', 5);

    expect(await present(cache, ['a', 'b', 'c', 'd', 'e'])).toEqual(['c', 'd', 'e']);
  });
});
