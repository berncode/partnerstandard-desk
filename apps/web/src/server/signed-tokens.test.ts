import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addressHash } from '@partner-desk/commands';
import { issuedAtOf, shortEmailHash, signAction, signUnsubscribe, verifyAction, verifyUnsubscribe } from './signed-tokens';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const NOW = Date.parse('2026-10-20T08:05:00.000Z');
const DAY = 86_400_000;
const claims = { mapId: 'map_0123456789', activityId: 'a_test01', action: 'done' as const, personId: 'p_ben001', emailHash: shortEmailHash('ben@example.com') };

/** The documented format, rebuilt independently: payload.signature, keyed by HMAC(secret, label). */
function forge(label: string, payload: unknown, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = createHmac('sha256', secret).update(label).digest();
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

describe('action tokens', () => {
  it('issuedAtOf gives back when the button was signed, to the second', () => {
    const signedAt = Date.parse('2026-11-03T07:30:00.500Z');
    const verified = verifyAction(SECRET, signAction(SECRET, claims, signedAt), signedAt)!;
    expect(issuedAtOf(verified)).toBe(Date.parse('2026-11-03T07:30:00.000Z'));
  });

  it('round-trip, expiring 14 days after they were made', () => {
    const token = signAction(SECRET, claims, NOW);
    expect(token).toMatch(/^[\w-]+\.[\w-]{43}$/);
    expect(verifyAction(SECRET, token, NOW)).toEqual({ ...claims, exp: Math.floor(NOW / 1000) + 14 * 86_400 });
    expect(verifyAction(SECRET, token, NOW + 14 * DAY - 1000)).not.toBeNull();
    expect(verifyAction(SECRET, token, NOW + 14 * DAY)).toBeNull();
  });

  it('match the documented format', () => {
    const exp = Math.floor(NOW / 1000) + 14 * 86_400;
    expect(signAction(SECRET, claims, NOW)).toBe(forge('pd:map-action:v1', { v: 1, p: claims.mapId, a: claims.activityId, x: 'done', r: claims.personId, e: claims.emailHash, exp }));
  });

  it('refuse a changed payload, a changed signature, another secret or another purpose', () => {
    const token = signAction(SECRET, claims, NOW);
    const [payload = '', signature = ''] = token.split('.');
    const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), a: 'a_other1' })).toString('base64url');
    expect(verifyAction(SECRET, `${other}.${signature}`, NOW)).toBeNull();
    const flip = (c: string) => (c === 'A' ? 'B' : 'A');
    expect(verifyAction(SECRET, `${payload}.${flip(signature[0]!)}${signature.slice(1)}`, NOW)).toBeNull();
    // The last character's spare bits: a non-canonical spelling of the same signature is refused too.
    expect(verifyAction(SECRET, `${payload}.${signature.slice(0, -1)}${flip(signature.at(-1)!)}`, NOW)).toBeNull();
    expect(verifyAction('another-secret-that-is-at-least-32-chars', token, NOW)).toBeNull();
    expect(verifyAction(SECRET, signUnsubscribe(SECRET, 'ben@example.com', 'nudges'), NOW)).toBeNull();
  });

  it('refuse anything malformed without throwing', () => {
    for (const bad of ['', 'abc', 'a.b.c', `${'x'.repeat(2000)}.${'y'.repeat(43)}`, 'not base64!.sig', 42, null, undefined, {}]) {
      expect(verifyAction(SECRET, bad, NOW)).toBeNull();
    }
    expect(verifyAction(SECRET, forge('pd:map-action:v1', 'just a string'), NOW)).toBeNull();
  });

  it('refuse a well-signed payload of the wrong shape', () => {
    const exp = Math.floor(NOW / 1000) + 60;
    const good = { v: 1, p: 'map_0123456789', a: 'a_test01', x: 'done', r: 'p_ben001', e: claims.emailHash, exp };
    expect(verifyAction(SECRET, forge('pd:map-action:v1', good), NOW)).not.toBeNull();
    for (const bad of [
      { ...good, x: 'delete' }, { ...good, v: 2 }, { ...good, p: 'not-a-plan' }, { ...good, e: 'ben@example.com' },
      { ...good, exp: 'later' }, { ...good, extra: true }, { ...good, a: '' },
    ]) expect(verifyAction(SECRET, forge('pd:map-action:v1', bad), NOW)).toBeNull();
  });
});

describe('unsubscribe tokens', () => {
  it('round-trip with the address’s hash, never the address, and don’t expire', () => {
    const token = signUnsubscribe(SECRET, ' Ben@Example.com ', 'digest');
    expect(verifyUnsubscribe(SECRET, token)).toEqual({ emailHash: addressHash('ben@example.com'), type: 'digest' });
    expect(Buffer.from(token.split('.')[0]!, 'base64url').toString()).not.toMatch(/ben|example/i);
  });

  it('refuse other purposes, other secrets and unknown types', () => {
    expect(verifyUnsubscribe(SECRET, signAction(SECRET, claims, NOW))).toBeNull();
    expect(verifyUnsubscribe('another-secret-that-is-at-least-32-chars', signUnsubscribe(SECRET, 'ben@example.com', 'nudges'))).toBeNull();
    expect(verifyUnsubscribe(SECRET, forge('pd:map-unsub:v1', { v: 1, h: addressHash('ben@example.com'), t: 'reconnect' }))).toBeNull();
    expect(verifyUnsubscribe(SECRET, 'garbage')).toBeNull();
  });
});
