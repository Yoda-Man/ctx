import { describe, it, expect } from 'vitest';
import { errorMessage, toError } from '../error.js';

describe('errorMessage', () => {
  it("gives an Error's message, and any other thrown value as text", () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(404)).toBe('404');
  });
});

describe('toError', () => {
  it('passes an Error through and wraps anything else', () => {
    const original = new TypeError('bad');
    expect(toError(original)).toBe(original);
    expect(toError('oops')).toEqual(new Error('oops'));
  });
});
