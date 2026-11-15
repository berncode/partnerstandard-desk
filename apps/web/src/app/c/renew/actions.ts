'use server';

import { requestNewMapLink } from '@partner-desk/commands';
import { headers } from 'next/headers';
import { relinkDeps } from '@/server/runtime';

/**
 * "Send me a new link" (MAP §3.2). Rate limited per address and per IP; the answer never says whether it matched.
 * Without email set up it says so and sends nothing.
 */
export async function requestLink(mapId: unknown, email: unknown): Promise<{ ok: boolean; message: string }> {
  const forwarded = (await headers()).get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || null;
  return requestNewMapLink(relinkDeps(), { mapId, email, ip });
}
