import { archiveMarket, changeMarket, changePartner, createMarket, createProgram, readPartners, readProgram, saveProgram, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { describe, expect, it } from 'vitest';
import { marketsToStartFrom, programLevels, programMembers, programOptions, programsOverview } from './program-links';

const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup() {
  const deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  await deps.companies.rename('u_anna', 'Halden');
  await readPartners(deps, anna, { companyId });
  return deps;
}
type Deps = Awaited<ReturnType<typeof setup>>;

const fresh = async (deps: Deps, partnerType = 'reseller') =>
  value(await createProgram(deps, anna, { companyId, partnerType, from: 'fresh' })).programId;

async function edit(deps: Deps, programId: string, change: (p: Record<string, unknown>) => void) {
  const read = value(await readProgram(deps, anna, { programId })).value;
  const program = structuredClone(read);
  change(program as unknown as Record<string, unknown>);
  value(await saveProgram(deps, anna, { programId, program, base: read, expectedUpdatedAt: read.updatedAt || null }));
}

const market = async (deps: Deps, marketName: string, partnerType = 'reseller') =>
  value(await createMarket(deps, anna, { companyId, info: { marketName, partnerType, ourProduct: 'Tool', ourTargetCustomers: 'Banks' } })).marketId;

async function partner(deps: Deps, company: string, partnerType = 'reseller') {
  const account = value(await changePartner(deps, anna, { companyId, change: { kind: 'add', entity: 'account', values: { company } } })).entityId!;
  const partnerId = value(await changePartner(deps, anna, { companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account, partnerType } } })).entityId!;
  return { accountId: account, partnerId };
}

describe('programOptions', () => {
  it('lists the programs by label, and reads the names of twins only', async () => {
    const deps = await setup();
    const first = await fresh(deps);
    const dach = await fresh(deps);
    await edit(deps, dach, (p) => { p.focus = 'DACH'; });
    expect(value(await programOptions(deps, anna, companyId)).map((p) => p.title)).toEqual(['Reseller', 'Reseller · DACH']);

    const copy = await fresh(deps);
    await edit(deps, copy, (p) => { p.name = 'Second Reseller Program'; });
    const reads: string[] = [];
    const read = deps.programs.read.bind(deps.programs);
    deps.programs.read = async (ref) => { reads.push(ref.fileId); return read(ref); };
    const options = value(await programOptions(deps, anna, companyId));
    expect(options.map((p) => [p.programId, p.title])).toEqual([
      [first, 'Reseller · Halden Reseller Program'], [dach, 'Reseller · DACH'], [copy, 'Reseller · Second Reseller Program'],
    ]);
    expect(reads).toHaveLength(2);
  });
});

describe('programLevels', () => {
  it('answers each program’s level names and whether it has Preferred, and a program that is gone as gone', async () => {
    const deps = await setup();
    const named = await fresh(deps);
    await edit(deps, named, (p) => { p.regName = 'Member'; p.prefName = 'Gold'; p.prefOn = false; });
    const gone = await fresh(deps);
    await deps.programs.trash({ fileId: (await deps.directory.program(gone))!.fileId });
    expect(await programLevels(deps, anna, [named, gone, 'pg_nothere000'])).toEqual({
      [named]: { status: 'ready', reg: 'Member', pref: 'Gold', prefOn: false },
      [gone]: { status: 'gone' },
      pg_nothere000: { status: 'gone' },
    });
  });
});

describe('programMembers', () => {
  it('lists the program’s partners with their level, and the open markets that feed it', async () => {
    const deps = await setup();
    const programId = await fresh(deps);
    const other = await fresh(deps);
    const tailspin = await partner(deps, 'Tailspin');
    const wingtip = await partner(deps, 'Wingtip');
    const elsewhere = await partner(deps, 'Elsewhere');
    await partner(deps, 'Nowhere');
    const set = (partnerId: string, patch: Record<string, unknown>) =>
      changePartner(deps, anna, { companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch } });
    await set(tailspin.partnerId, { programId });
    await set(wingtip.partnerId, { programId, level: 'pref' });
    await set(elsewhere.partnerId, { programId: other });
    const austria = await market(deps, 'Austria');
    const germany = await market(deps, 'Germany');
    await market(deps, 'Referral land', 'referral');
    await changeMarket(deps, anna, { marketId: austria, change: { kind: 'updateInfo', patch: { feedsProgramId: programId } } });
    await changeMarket(deps, anna, { marketId: germany, change: { kind: 'updateInfo', patch: { feedsProgramId: other } } });

    expect(value(await programMembers(deps, anna, companyId, programId, 'reseller'))).toEqual({
      partners: [
        { partnerId: tailspin.partnerId, accountId: tailspin.accountId, company: 'Tailspin', partnerType: 'reseller', level: 'reg' },
        { partnerId: wingtip.partnerId, accountId: wingtip.accountId, company: 'Wingtip', partnerType: 'reseller', level: 'pref' },
      ],
      markets: [{ marketId: austria, displayName: 'Austria · Reseller' }],
    });
  });
});

describe('programsOverview', () => {
  it('lists every program with its partners per level, by its level names, and the open markets that feed it', async () => {
    const deps = await setup();
    const reseller = await fresh(deps);
    const broker = await fresh(deps, 'broker');
    await edit(deps, broker, (p) => { p.regName = 'Member'; p.prefOn = false; });
    const tailspin = await partner(deps, 'Tailspin');
    const wingtip = await partner(deps, 'Wingtip');
    const set = (partnerId: string, patch: Record<string, unknown>) =>
      changePartner(deps, anna, { companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch } });
    await set(tailspin.partnerId, { programId: reseller });
    await set(wingtip.partnerId, { programId: reseller, level: 'pref' });
    const austria = await market(deps, 'Austria');
    const archived = await market(deps, 'Old');
    await changeMarket(deps, anna, { marketId: austria, change: { kind: 'updateInfo', patch: { feedsProgramId: reseller } } });
    await changeMarket(deps, anna, { marketId: archived, change: { kind: 'updateInfo', patch: { feedsProgramId: reseller } } });
    value(await archiveMarket(deps, anna, { marketId: archived, archived: true }));
    // A market of a type no program has can't feed one: it isn't read.
    const referral = await market(deps, 'Referral land', 'referral');
    const reads: string[] = [];
    const read = deps.markets.read.bind(deps.markets);
    deps.markets.read = async (ref) => { reads.push(ref.fileId); return read(ref); };

    expect(value(await programsOverview(deps, anna, companyId))).toEqual({
      problem: null,
      rows: [
        {
          programId: reseller, title: 'Reseller', partnerType: 'reseller', gone: false,
          levels: [{ name: 'Registered', count: 1 }, { name: 'Preferred', count: 1 }],
          markets: [{ marketId: austria, displayName: 'Austria · Reseller' }],
        },
        { programId: broker, title: 'Broker', partnerType: 'broker', gone: false, levels: [{ name: 'Member', count: 0 }], markets: [] },
      ],
    });
    expect(reads).toEqual([(await deps.directory.market(austria))!.fileId]);
    expect(reads).not.toContain((await deps.directory.market(referral))!.fileId);
  });

  it('answers no cards with no program, and marks a program whose file is gone', async () => {
    const deps = await setup();
    expect(value(await programsOverview(deps, anna, companyId))).toEqual({ rows: [], problem: null });
    const gone = await fresh(deps);
    await deps.programs.trash({ fileId: (await deps.directory.program(gone))!.fileId });
    expect(value(await programsOverview(deps, anna, companyId))).toEqual({
      problem: null,
      rows: [{ programId: gone, title: 'Reseller', partnerType: 'reseller', gone: true, levels: null, markets: [] }],
    });
  });

  it('never says no market feeds a program when a market can’t be read, and hands up why the counts can’t be shown', async () => {
    const deps = await setup();
    const programId = await fresh(deps);
    await market(deps, 'Austria');
    deps.markets.read = async () => ({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    deps.partnerBooks.read = async () => ({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    expect(value(await programsOverview(deps, anna, companyId))).toEqual({
      problem: { failure: { error: 'auth', message: COPY.AUTH_MESSAGE }, partnersFile: true },
      rows: [{ programId, title: 'Reseller', partnerType: 'reseller', gone: false, levels: null, markets: null }],
    });
  });
});

describe('marketsToStartFrom', () => {
  it('offers the open markets of the type that have a hypothesis that holds', async () => {
    const deps = await setup();
    const austria = await market(deps, 'Austria');
    const germany = await market(deps, 'Germany');
    const referral = await market(deps, 'Referral land', 'referral');
    for (const [marketId, status] of [[austria, 'holds'], [germany, 'draft'], [referral, 'holds']] as const) {
      await changeMarket(deps, anna, { marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'IT resellers', status } } });
    }
    expect(value(await marketsToStartFrom(deps, anna, companyId, 'reseller'))).toEqual([{ marketId: austria, displayName: 'Austria · Reseller' }]);
    expect(value(await marketsToStartFrom(deps, anna, companyId, 'distributor'))).toEqual([]);
  });
});
