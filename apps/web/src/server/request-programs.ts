import { cache } from 'react';
import { programOptions } from './program-links';
import { actorFor, companyFor, depsFor, type OwnerSession } from './runtime';

/**
 * The signed-in person's programs with their titles (`programOptions`), at most once per request: one directory
 * read, one `programs.list` event and the twins' reads, however many parts of the page ask. React's `cache` keys it
 * by the session, which `currentOwner` itself caches per request.
 */
export const programOptionsFor = cache(async (session: OwnerSession) => {
  const { companyId } = await companyFor(session);
  return programOptions(depsFor(session), actorFor(session), companyId);
});
