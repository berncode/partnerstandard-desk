'use server';

import { renameCompany, saveTimeZone } from '@partner-desk/commands';
import type { RemoteOutcome } from '@/editor/remote';
import { asOwner, done } from './context';

/** Renames the signed-in person's own company (`{ name }`): trimmed, at most 80 characters, empty clears it. */
export async function companyRename(input: unknown): Promise<RemoteOutcome<{ name: string }>> {
  return asOwner(async ({ deps, actor }) => done(await renameCompany(deps, actor, input)));
}

/** Saves the signed-in person's timezone (`{ timeZone }`): their MAPs' "today" and the 08:00 emails count in it. */
export async function companyTimeZone(input: unknown): Promise<RemoteOutcome<{ timeZone: string }>> {
  return asOwner(async ({ deps, actor }) => done(await saveTimeZone(deps, actor, input)));
}
