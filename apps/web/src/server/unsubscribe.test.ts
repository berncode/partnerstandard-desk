import { describe, expect, it, vi } from 'vitest';
import { addressHash, MemoryEmailPrefs } from '@partner-desk/commands';
import { signUnsubscribe } from './signed-tokens';
import { unsubscribe, unsubscribeView, type UnsubscribeDeps } from './unsubscribe';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const deps = (): UnsubscribeDeps => ({ secret: SECRET, prefs: new MemoryEmailPrefs(), now: () => '2026-10-20T09:00:00.000Z' });

describe('unsubscribe', () => {
  it('asks first, never writing on GET, then remembers the choice for that type only', async () => {
    const d = deps();
    const write = vi.spyOn(d.prefs, 'unsubscribe');
    const token = signUnsubscribe(SECRET, 'lena@example.com', 'nudges');
    expect(await unsubscribeView(d, token)).toEqual({ kind: 'confirm', type: 'nudges', label: 'reminders about your activities' });
    expect(write).not.toHaveBeenCalled();
    expect(await unsubscribe(d, token)).toEqual({ ok: true, label: 'reminders about your activities' });
    expect(await unsubscribeView(d, token)).toEqual({ kind: 'done', type: 'nudges', label: 'reminders about your activities' });
    expect(await d.prefs.unsubscribed(['lena@example.com'], 'digest')).toEqual(new Set());
    expect(await unsubscribe(d, token)).toEqual({ ok: true, label: 'reminders about your activities' });
  });

  it('refuses a bad or foreign token without writing', async () => {
    const d = deps();
    const write = vi.spyOn(d.prefs, 'unsubscribe');
    for (const bad of ['garbage', signUnsubscribe('another-secret-that-is-at-least-32-chars', 'lena@example.com', 'nudges'), 42]) {
      expect(await unsubscribeView(d, bad)).toEqual({ kind: 'invalid' });
      expect(await unsubscribe(d, bad)).toEqual({ ok: false });
    }
    expect(write).not.toHaveBeenCalled();
    expect(await d.prefs.isUnsubscribed(addressHash('lena@example.com'), 'nudges')).toBe(false);
  });
});
