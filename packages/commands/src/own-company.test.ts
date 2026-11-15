import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import type { Deps } from './deps';
import * as commands from './index';
import {
  changePartner, createCase, createMarket, createProgram, importPartners, listCases, listMapIds, listMaps, listMarkets, listPrograms,
  listReviews, readCompanyFacts, readPartners, readThisWeek, recreatePartnerBook, removePartnerType, saveCompanyFacts, startMap, createProposal, withdrawProposal,
  acceptProposal, rejectProposal,
} from './index';
import { isOwnCompanyOnly, ownCompanyOnly } from './own-company';
import { FORBIDDEN, ok } from './result';
import { makeTestDeps } from './testing';

const MINE = 'co_aaaaaaaaaa';
const THEIRS = 'co_bbbbbbbbbb';
const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Lena' };
const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };

/** The store and table parts of `Deps`: everything a command could read or write, apart from the companies. */
const WATCHED = [
  'partnerBooks', 'markets', 'programs', 'companyFacts', 'cases', 'maps', 'directory', 'shareLinks', 'reviewLinks', 'mapLinks',
  'mapSessions', 'mapEvents', 'rateLimits', 'events', 'webhooks',
] as const;

/** Deps whose stores note every call, and a count of the company lookups. */
function watchedDeps() {
  const deps = makeTestDeps({ companies: { u1: MINE, u2: THEIRS } });
  const calls: string[] = [];
  let lookups = 0;
  const forUser = deps.companies.forUser.bind(deps.companies);
  deps.companies.forUser = async (userId) => { lookups++; return forUser(userId); };
  const watch = <T extends object>(target: T, name: string): T => new Proxy(target, {
    get(t, key, receiver) {
      const value = Reflect.get(t, key, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => { calls.push(`${name}.${String(key)}`); return (value as (...a: unknown[]) => unknown).apply(t, args); };
    },
  });
  const watched = { ...deps } as Deps;
  for (const name of WATCHED) (watched as unknown as Record<string, object>)[name] = watch(deps[name] as object, name);
  return { deps, watched, calls, lookups: () => lookups };
}

type Command = (deps: Deps, actor: Actor, input: unknown) => Promise<{ ok: boolean }>;

/** Every command that takes a company id, with an input it would otherwise accept. */
const COMPANY_COMMANDS: Array<[string, Command, Record<string, unknown>]> = [
  ['readPartners', readPartners, {}],
  ['changePartner', changePartner, { change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }],
  ['importPartners', importPartners, { changes: [{ kind: 'add', entity: 'account', values: { company: 'Acme' } }] }],
  ['removePartnerType', removePartnerType, { partnerId: 'p_1', expected: ['p_1'] }],
  ['recreatePartnerBook', recreatePartnerBook, {}],
  ['createMarket', createMarket, { info: { marketName: 'DACH', partnerType: 'reseller', ourProduct: 'Ours', ourTargetCustomers: 'Teams' } }],
  ['listMarkets', listMarkets, {}],
  ['readCompanyFacts', readCompanyFacts, {}],
  ['saveCompanyFacts', saveCompanyFacts, { facts: {}, base: {}, expectedUpdatedAt: null }],
  ['listPrograms', listPrograms, {}],
  ['createProgram', createProgram, { partnerType: 'reseller', from: 'fresh' }],
  ['listCases', listCases, {}],
  ['createCase', createCase, { partnerId: 'p_1' }],
  ['listMaps', listMaps, {}],
  ['listMapIds', listMapIds, {}],
  ['startMap', startMap, { partnerId: 'p_1' }],
  ['listReviews', listReviews, {}],
  ['readThisWeek', readThisWeek, {}],
  ['createProposal', createProposal, { proposal: { kind: 'stage', partnerId: 'p_1', expectedUpdatedAt: null, to: 'discovery_call', reason: 'Fits' } }],
  ['withdrawProposal', withdrawProposal, { proposalId: 'prp_aaaaaaaaaa' }],
  ['acceptProposal', acceptProposal, { proposalId: 'prp_aaaaaaaaaa' }],
  ['rejectProposal', rejectProposal, { proposalId: 'prp_aaaaaaaaaa', note: 'No' }],
];

describe('commands refuse a company id that is not the actor\'s own', () => {
  it.each(COMPANY_COMMANDS)('%s: another company\'s id is refused and no store is touched', async (_name, command, rest) => {
    const { deps, watched, calls } = watchedDeps();
    // The other person's company is in use: their Partners file exists.
    expect((await readPartners(deps, other, { companyId: THEIRS })).ok).toBe(true);
    expect(await command(watched, owner, { companyId: THEIRS, ...rest })).toEqual(FORBIDDEN);
    expect(calls).toEqual([]);
  });

  it.each(COMPANY_COMMANDS)('%s: an agent acts with its person\'s company only', async (_name, command, rest) => {
    const { deps, watched, calls } = watchedDeps();
    expect((await readPartners(deps, other, { companyId: THEIRS })).ok).toBe(true);
    expect(await command(watched, agent, { companyId: THEIRS, ...rest })).toEqual(FORBIDDEN);
    expect(calls).toEqual([]);
  });

  it('the first read of a company nobody has used yet is refused too: nobody can claim it', async () => {
    const { deps, watched, calls } = watchedDeps();
    expect(await readPartners(watched, owner, { companyId: THEIRS })).toEqual(FORBIDDEN);
    expect(await readCompanyFacts(watched, owner, { companyId: THEIRS })).toEqual(FORBIDDEN);
    expect(calls).toEqual([]);
    // Its owner still makes their own files on their first read.
    expect((await readPartners(deps, other, { companyId: THEIRS })).ok).toBe(true);
    expect(deps.directory.books.get(THEIRS)?.ownerUserId).toBe('u2');
  });

  it('the actor\'s own company passes, for a person and their agent', async () => {
    const { watched } = watchedDeps();
    expect((await readPartners(watched, owner, { companyId: MINE })).ok).toBe(true);
    expect((await listMarkets(watched, agent, { companyId: MINE })).ok).toBe(true);
  });

  it('looks the company up once per set of dependencies', async () => {
    const { watched, lookups } = watchedDeps();
    await readPartners(watched, owner, { companyId: MINE });
    await Promise.all([listMarkets(watched, owner, { companyId: MINE }), listPrograms(watched, agent, { companyId: MINE })]);
    expect(lookups()).toBe(1);
  });

  it('a malformed company id is still invalid input, not a refusal', async () => {
    const { watched } = watchedDeps();
    expect(await readPartners(watched, owner, { companyId: 'not-a-company' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('a malformed company id is refused before the command runs, whatever its own schema accepts', async () => {
    let ran = false;
    const loose = ownCompanyOnly(async () => { ran = true; return ok(1); });
    expect(await loose(makeTestDeps(), owner, { companyId: 'acme' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await loose(makeTestDeps(), owner, { companyId: 42 })).toMatchObject({ ok: false, error: 'invalid' });
    expect(ran).toBe(false);
  });

  it('every exported command takes no company id or is wrapped', () => {
    // Commands that take a record's id (checked by \`isOwner\` on its directory row), the actor's own company, or a MAP
    // link's session. A new command lands here only on purpose: one that takes a company id must be wrapped instead.
    // The webhook commands take none: a webhook is its person's, found by the actor's user id. So is listing proposals.
    // `runTool` takes an agent's context, whose company is its person's own (`agentContext`), and runs wrapped commands.
    // `exportFile` takes a database file id and checks the file's company against the actor's own (`companyOf`).
    // The member and invite commands (plan 15) reach only the actor's own workspace, through `deps.team`.
    const NO_COMPANY_ID = [
      'cancelInvite', 'createInvite', 'listInvites', 'listMembers', 'removeMember', 'setMemberRole',
      // The trash (plan 16): the actor's own company's, found by `companyOf`.
      'listTrash', 'restoreFromTrash',
      'archiveMarket', 'changeMap', 'changeMarket', 'closeReview', 'copyCase', 'copyMarket', 'createWebhook', 'deleteCase', 'deleteMap',
      'deleteProgram', 'deleteWebhook', 'endMapSession', 'exportFile', 'fillMap', 'importExclusions', 'listProposals', 'listWebhookDeliveries', 'listWebhooks', 'mapNotifySettings',
      'mapSharing', 'openReview',
      'readCase', 'readCaseSources', 'readMap', 'readMapForJob', 'readMarket', 'readProgram', 'readReview', 'recalculateCase',
      'refreshProgramOutputs', 'renameCompany', 'resendWebhookDelivery', 'resolveMapSession', 'revokeMapLinks', 'revokeSummary', 'runTool', 'saveCase',
      'saveMapNotifySettings', 'saveProgram', 'saveTimeZone', 'shareCase', 'shareMap', 'shiftMapDates', 'testWebhook', 'timeZoneSetting',
      'turnOffWebhook', 'turnOnWebhook', 'unshareCase',
    ];
    const unwrapped = Object.entries(commands)
      .filter(([, v]) => typeof v === 'function' && v.constructor.name === 'AsyncFunction' && v.length === 3 && !isOwnCompanyOnly(v))
      .map(([name]) => name)
      .sort();
    expect(unwrapped).toEqual([...NO_COMPANY_ID].sort());
    for (const [, command] of COMPANY_COMMANDS) expect(isOwnCompanyOnly(command)).toBe(true);
  });

  it('no exported command reaches a store with another company\'s id', async () => {
    // A MAP link's session takes a cookie token and a MAP id, no actor and no company: not a command in this sense.
    const sessions = new Set(['resolveMapSession', 'endMapSession']);
    const swept: string[] = [];
    for (const [name, value] of Object.entries(commands)) {
      if (typeof value !== 'function' || value.constructor.name !== 'AsyncFunction' || value.length !== 3 || sessions.has(name)) continue;
      const { deps, watched, calls } = watchedDeps();
      await readPartners(deps, other, { companyId: THEIRS });
      let result: unknown;
      try {
        result = await (value as Command)(watched, owner, { companyId: THEIRS });
      } catch {
        result = undefined;
      }
      swept.push(name);
      expect({ name, ok: (result as { ok?: boolean } | undefined)?.ok, calls }).toEqual({ name, ok: false, calls: [] });
    }
    for (const [name] of COMPANY_COMMANDS) expect(swept).toContain(name);
  });
});
