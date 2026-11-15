import { describe, expect, it } from 'vitest';
import { hashToken, isToken, newShareLinkId, newToken } from './share-tokens';

describe('share tokens', () => {
  it('makes 256-bit url-safe tokens, never the same twice', () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
  });

  it('hashes with SHA-256', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('recognizes only well-formed tokens', () => {
    expect(isToken(newToken())).toBe(true);
    for (const bad of ['', 'short', `${newToken()}x`, `${'a'.repeat(42)}!`, `${'a'.repeat(42)}.`, 42, null, undefined]) expect(isToken(bad)).toBe(false);
  });

  it('makes share link ids that are ids, not secrets', () => {
    expect(newShareLinkId()).toMatch(/^sl_[0-9a-z]{16}$/);
  });
});
