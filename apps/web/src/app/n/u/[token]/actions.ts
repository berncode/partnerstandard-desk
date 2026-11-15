'use server';

import { unsubscribeDeps } from '@/server/runtime';
import { unsubscribe } from '@/server/unsubscribe';

/** The unsubscribe page's button. The token is untrusted input and is checked again here. */
export async function unsubscribeAction(token: string): Promise<{ ok: boolean }> {
  return { ok: (await unsubscribe(unsubscribeDeps(), token)).ok };
}
