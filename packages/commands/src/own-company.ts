// Every command that takes a company id runs through `ownCompanyOnly`: the id must be the actor's own company.
import type { Actor } from './actor';
import type { Deps } from './deps';
import { FORBIDDEN, invalid, type CommandResult } from './result';

/** A company id as the commands' schemas take it. An input that names anything else is invalid, before the command runs. */
const COMPANY_ID = /^co_[0-9a-z]{10}$/;

/** Every command wrapped by `ownCompanyOnly`, so a test can find a command that takes a company id without it. */
const wrapped = new WeakSet<object>();

/** True for a command wrapped by `ownCompanyOnly`. */
export const isOwnCompanyOnly = (command: object): boolean => wrapped.has(command);

/**
 * Each set of dependencies remembers its people's company ids: one database read per person, however many commands
 * a page runs. The app makes a set per person and request, so nothing is kept longer than that [builder's call].
 */
const known = new WeakMap<Deps, Map<string, Promise<string>>>();

/** The person's company id, read once per set of dependencies (as above). */
export function companyOf(deps: Deps, userId: string): Promise<string> {
  let byUser = known.get(deps);
  if (!byUser) {
    byUser = new Map();
    known.set(deps, byUser);
  }
  const remembered = byUser.get(userId);
  if (remembered) return remembered;
  const lookup = deps.companies.forUser(userId).then((company) => company.companyId);
  byUser.set(userId, lookup);
  // A failed read is not remembered: the next command asks again.
  const forget = byUser;
  lookup.catch(() => { if (forget.get(userId) === lookup) forget.delete(userId); });
  return lookup;
}

/** The company id an input names: null when it names none, 'malformed' when it names something that isn't one. */
function namedCompany(input: unknown): string | null | 'malformed' {
  if (typeof input !== 'object' || input === null || !('companyId' in input)) return null;
  const { companyId } = input as { companyId: unknown };
  return typeof companyId === 'string' && COMPANY_ID.test(companyId) ? companyId : 'malformed';
}

/**
 * Wraps a command so it refuses a company id that is not the actor's own (`Companies.forUser`), before the command
 * reads or writes anything. Ids come from the app's `companyFor` today; the MCP server and the REST API will pass what
 * a client sends, so the commands check it themselves. An agent and a person with a MAP link carry their person's user
 * id, so they are held to that person's company. The answer is `forbidden` whether or not the other company exists:
 * the check never looks at it, so it tells nobody anything.
 */
export function ownCompanyOnly<T, Rest extends unknown[] = []>(
  command: (deps: Deps, actor: Actor, input: unknown, ...rest: Rest) => Promise<CommandResult<T>>,
): (deps: Deps, actor: Actor, input: unknown, ...rest: Rest) => Promise<CommandResult<T>> {
  // `rest`: what a command takes beside its input from another command only (`changePartner`'s changes beside it).
  const guarded = async (deps: Deps, actor: Actor, input: unknown, ...rest: Rest): Promise<CommandResult<T>> => {
    const named = namedCompany(input);
    // A malformed id never reaches the command, so a looser schema later can't let one past the check.
    if (named === 'malformed') return invalid();
    if (named !== null && named !== (await companyOf(deps, actor.userId))) return FORBIDDEN;
    return command(deps, actor, input, ...rest);
  };
  Object.defineProperty(guarded, 'name', { value: command.name });
  wrapped.add(guarded);
  return guarded;
}
