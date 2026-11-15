import { addressHash, MemoryEmailPrefs } from '@partner-desk/commands';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signUnsubscribe } from '@/server/signed-tokens';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const state = vi.hoisted(() => ({ prefs: null as unknown as InstanceType<typeof import('@partner-desk/commands').MemoryEmailPrefs> }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('@/server/runtime', () => ({ unsubscribeDeps: () => ({ secret: SECRET, prefs: state.prefs, now: () => '2026-11-03T08:00:00.000Z' }) }));

const route = await import('./route');
const post = (token: string) => route.POST(new Request(`https://desk.test/api/unsubscribe/${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }), { params: Promise.resolve({ token }) });

beforeEach(() => {
  state.prefs = new MemoryEmailPrefs();
});

describe('/api/unsubscribe/[token] (one-click, RFC 8058)', () => {
  it('has no GET, so a link scanner opening it unsubscribes nobody (Review Focus 2)', () => {
    expect(Object.keys(route)).toEqual(['POST']);
  });

  it('unsubscribes the address from that kind on POST', async () => {
    const res = await post(signUnsubscribe(SECRET, 'lena@example.com', 'digest'));
    expect(res.status).toBe(200);
    expect(await state.prefs.isUnsubscribed(addressHash('lena@example.com'), 'digest')).toBe(true);
    expect(await state.prefs.isUnsubscribed(addressHash('lena@example.com'), 'nudges')).toBe(false);
  });

  it('refuses a bad token and changes nothing', async () => {
    const res = await post('garbage');
    expect(res.status).toBe(400);
    expect(await state.prefs.listForHash(addressHash('lena@example.com'))).toEqual([]);
  });
});
