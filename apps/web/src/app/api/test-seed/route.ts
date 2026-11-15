import {
  changeMap, changeMarket, changePartner, createCase, createMarket, createProgram, readCase, readCompanyFacts, readPartners, saveCase, saveCompanyFacts,
  ownerToday, readMap, saveProgram, startMap,
} from '@partner-desk/commands';
import { addDays, type BusinessCase, EXAMPLES, type MapChange, type PartnerChange } from '@partner-desk/core';
import { isTestUser, testSignInEnabled } from '@partner-desk/platform';
import { showMemoryRowIssues } from '@partner-desk/storage';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { actorFor, apiKeys, companyFor, currentOwner, depsFor } from '@/server/runtime';
import { markBookOld, programPublicText, trashedPartnerFiles, typeFactsYearly, typeProgramLead, type SeedStorage } from './edits';

/** No company id: the company is always the signed-in test user's own. */
const bodySchema = z.object({
  /**
   * `sample`: the sample book and markets. `programs`: two reseller programs, the second with the focus "DACH".
   * `handEditFacts`: types 21,000 into "Pays every year" of the Company facts file, as a person editing the sheet does.
   * `handEditProgram`: types "Typed in the sheet" into the Program lead of `programId`'s file, the same way.
   * `programRowIssue`: makes `programId`'s file read with an unreadable Reasons row, as a hand-edited sheet can.
   * `trashProgram`: throws `programId`'s file away, as if trashed in Drive by hand (the program stays listed).
   * `case`: makes a business case for `partnerId` through the commands, as New case does (with `programId` when the
   * program must be picked). `handRemovePartner`: deletes `partnerId`'s row from the Partners file, as a person deleting
   * it in the sheet does (no command asks about its cases). `losePartners`: throws the Partners file away, as if
   * trashed in Drive. `caseFacts`: saves Company facts with a typical customer (€24,000 a year, €4,000 once, 90% renew),
   * as the Company facts page does. `caseProgram`: makes a fresh program of `partnerId`'s partner type, its levels
   * named "Member" and "Gold" (with `flatFee`, paying a flat fee per new customer), and puts the partner type in it.
   * `exampleCase`: makes a business case for `partnerId` and saves into it the partner side of the Business Case app's
   * SaaS example (its portfolio, renewals, the reseller's roles and rates, deals, costs) and our side of it (Our case), as a person typing it does.
   * `contact`: adds a contact (`name`, `title`, an example.com email) to the company `accountId`, as People does.
   * `map`: starts the MAP of `partnerId` through the commands, with a milestone "Day 30: First check-in" in 20 days and,
   * for `health`, an activity due in 10 days (on track), one 10 days overdue (at risk), or a triggered exit trigger
   * (off track). `handEditMap`: sets the first activity of `mapId` to Blocked, as a person editing the sheet does who
   * fills in Last updated and Updated by ("Lena Ortiz"). `failMapDatesMove`: records that moving `mapId`'s open dates at
   * its partner type's signing failed, as a MAP file that couldn't be written leaves it. With `map`, `people` also
   * adds Lena Ortiz (the partner's side) and Ben Ito (ours), each with an example.com email, an objective on each side
   * ("Grow deal size with a complete offer", "Close three joint deals by day 90") and an activity each, not started
   * ("Train our sellers", Lena's, due in 14 days; "Send the price list", Ben's, due in 7 days); with `emailTag` their
   * addresses carry the tag. `ageMapLinks`: makes every link of `mapId` last used
   * 100 days ago, as a link nobody opened for that long. `trashMap`: throws `mapId`'s file away as if trashed by hand in
   * Drive; the MAP stays listed and can't be read. `apiKey`: makes an API key for the test user, named `name`, at
   * `level` (default Read only; also propose), as Settings will; the key comes back once. `revokeApiKey`: turns the test user's key
   * `keyId` off, as Settings' "Turn off" will.
   */
  fixture: z.enum([
    'sample', 'programs', 'handEditFacts', 'handEditProgram', 'programRowIssue', 'trashProgram', 'case', 'handRemovePartner', 'losePartners',
    'caseFacts', 'caseProgram', 'exampleCase', 'contact', 'map', 'handEditMap', 'failMapDatesMove', 'ageMapLinks', 'trashMap',
    'apiKey', 'revokeApiKey',
  ]),
  /** With `apiKey`: what the key may do. */
  level: z.enum(['read', 'change', 'propose']).optional(),
  /** The key `revokeApiKey` turns off: one of the test user's own. */
  keyId: z.string().max(64).optional(),
  /** With `map`: people on both sides with an email, and an objective and an activity each. */
  people: z.boolean().optional(),
  /** With `people`: their addresses carry this tag (lena.ortiz+{tag}@example.com), so a test finds its own emails. */
  emailTag: z.string().regex(/^[a-z0-9]{1,20}$/).optional(),
  /** The MAP `handEditMap`, `failMapDatesMove`, `ageMapLinks` and `trashMap` work on: one of the test user's own. */
  mapId: z.string().max(64).optional(),
  /** The company `contact` works on. */
  accountId: z.string().max(64).optional(),
  name: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  /** With `case`: the case's "Beyond the money" benefits, saved as the case page saves them. */
  benefits: z.array(z.string().max(100)).max(4).optional(),
  /** What the `map` fixture's MAP is made to need. */
  /** `empty`: a MAP with nothing in it, so no health (owner, 2026-10-31). */
  health: z.enum(['on_track', 'at_risk', 'off_track', 'empty']).optional(),
  /** The program `handEditProgram`, `programRowIssue` and `trashProgram` work on: one of the test user's own. */
  programId: z.string().max(64).optional(),
  /** The partner type `case`, `handRemovePartner`, `caseProgram` and `exampleCase` work on. */
  partnerId: z.string().max(64).optional(),
  /**
   * With `exampleCase`: every text of our case, and a few of its amounts, is a marker (OURS-MARKER-…, 919191, 818181,
   * 717171), for an e2e to look for on the partner's page.
   */
  oursMarkers: z.boolean().optional(),
  /** With `caseProgram`: the program pays a flat fee per new customer (a referral program). */
  flatFee: z.boolean().optional(),
  /** Also puts the closed (Proseware) and the exited (Lucerne) partner in the first market, for the market cards' "closed" count. */
  closedInMarket: z.boolean().optional(),
  /** Also logs a discovery call with Tailspin (in Austria, linked to the sample hypothesis), dated today, with one note. */
  callInMarket: z.boolean().optional(),
  /** Afterwards throws away a file, as if it were trashed in Drive: the Partners file, or the first market's file. */
  lose: z.enum(['partners', 'market']).optional(),
  /** Also adds Acme as a reseller (Recruitment) and a technology partner (Growth). */
  twoTypes: z.boolean().optional(),
  /** With `twoTypes`: Acme is a referral partner (Recruitment) too. */
  referral: z.boolean().optional(),
  /** After seeding, the Partners file reads as version 1: not opened, and a new file is offered. */
  oldPartners: z.boolean().optional(),
  /** Also gives Austria two confirmed value points (the reasons a program started from it gets). */
  valuePoints: z.boolean().optional(),
  /** Also makes a fresh reseller program that Austria feeds; its id comes back as `programId`. */
  feedingProgram: z.boolean().optional(),
  /** With `feedingProgram`: Tailspin (onboarding) is in that program, at the starting level. */
  joinProgram: z.boolean().optional(),
}).strict();

/** The confirmed value points `valuePoints` gives Austria. */
const SAMPLE_VALUE_POINTS = ['Leads from us in your region', 'A product your customers renew'];

/** The made-up note on the seeded call: a topic the partner hypothesis editor offers as evidence. */
const SAMPLE_CALL_NOTE = 'Customers ask for security they can run without a security team.';

/** A made-up partner hypothesis that holds, in the first market (Austria). */
const SAMPLE_HYPOTHESIS = {
  name: 'Mid-size IT resellers',
  status: 'holds',
  theirSide: 'They resell it because their customers ask for it.',
  ourSide: 'They reach mid-size firms we cannot serve directly.',
} as const;

/** Two made-up markets, both for resellers. */
const SAMPLE_MARKETS = [
  { marketName: 'Austria', partnerType: 'reseller' },
  { marketName: 'Germany', partnerType: 'reseller' },
] as const;

/** A name of exactly 60 characters, for the long-name layout. */
const LONG_NAME = 'Northern Isles Maritime Logistics And Trading Group Holdings';

type Place = 'researched' | 'discovery_call' | 'qualification' | 'map' | 'onboarding' | 'growth' | 'not_now' | 'no' | 'exited';

/**
 * Made-up companies for e2e tests, one for every place a partner can be: two researched, one in each later step, one
 * onboarding, one growth, one closed as not now, one as no, one exited. Tailspin is in both markets (its Austria link
 * names the sample hypothesis), Northwind and Fabrikam in one each; the long name has no website and another type.
 */
const SAMPLE_PARTNERS: ReadonlyArray<{
  company: string; website: string; partnerType: string; place: Place; markets?: number[];
  /** The market whose link names the sample hypothesis. */
  hypothesisIn?: number;
}> = [
  { company: 'Northwind Consulting', website: 'northwind.example', partnerType: 'reseller', place: 'researched', markets: [0] },
  { company: 'Fabrikam Systems', website: 'fabrikam.example', partnerType: 'reseller', place: 'researched', markets: [1] },
  { company: 'Contoso Partners', website: 'contoso.example', partnerType: 'reseller', place: 'discovery_call' },
  { company: 'Adatum Advisory', website: 'adatum.example', partnerType: 'reseller', place: 'qualification' },
  { company: 'Litware Group', website: 'litware.example', partnerType: 'reseller', place: 'map' },
  { company: 'Tailspin Solutions', website: 'tailspin.example', partnerType: 'reseller', place: 'onboarding', markets: [0, 1], hypothesisIn: 0 },
  { company: 'Wingtip Digital', website: 'wingtip.example', partnerType: 'reseller', place: 'growth' },
  { company: 'Proseware Ltd', website: 'proseware.example', partnerType: 'reseller', place: 'not_now' },
  { company: 'Humongous Insurance', website: 'humongous.example', partnerType: 'reseller', place: 'no' },
  { company: 'Lucerne Publishing', website: 'lucerne.example', partnerType: 'reseller', place: 'exited' },
  { company: LONG_NAME, website: '', partnerType: 'managed', place: 'researched' },
];

/** The lifecycle changes that take a new partner (it starts at Researched) to its place. */
function movesTo(partnerId: string, place: Place): PartnerChange[] {
  const signed: PartnerChange = { kind: 'markSigned', partnerId, signedDate: '2026-09-15' };
  switch (place) {
    case 'researched':
      return [];
    case 'discovery_call':
      return [{ kind: 'setStep', partnerId, to: 'discovery_call' }];
    case 'qualification':
      return [{ kind: 'setStep', partnerId, to: 'discovery_call' }, { kind: 'setStep', partnerId, to: 'qualification' }];
    case 'map':
      return [
        { kind: 'setStep', partnerId, to: 'discovery_call' }, { kind: 'setStep', partnerId, to: 'qualification' },
        { kind: 'setStep', partnerId, to: 'map' },
      ];
    case 'onboarding':
      return [signed];
    case 'growth':
      return [signed, { kind: 'setStage', partnerId, to: 'growth' }];
    case 'not_now':
      return [{ kind: 'close', partnerId, as: 'not_now', reason: 'Not this year.' }];
    case 'no':
      return [{ kind: 'close', partnerId, as: 'no', reason: 'Not a fit.' }];
    case 'exited':
      return [signed, { kind: 'markExited', partnerId, exitedDate: '2026-10-21', reason: 'They left the market.' }];
  }
}

/**
 * Test seeding for e2e: adds one account per sample company, then that company's section, to the signed-in test user's
 * Partner book, through the commands like any other change. Exists only with PD_TEST_AUTH=1, which the env check
 * refuses on Vercel; only test users may use it (files in memory, or in the database on the database edition). Answers with ids only.
 */
export async function POST(request: Request) {
  if (!testSignInEnabled()) return new NextResponse('Not found', { status: 404 });
  const session = await currentOwner();
  // A test user only: never a Google account, and on the database edition never a real person (test-users.ts).
  if (!session || session.storage === 'google' || !isTestUser(session.email)) return new NextResponse('Sign in with test sign-in first', { status: 401 });
  const storage: SeedStorage = session.storage;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse('Unknown fixture', { status: 400 });
  if (parsed.data.fixture === 'apiKey') {
    const { name, level = 'read' } = parsed.data;
    if (!name) return new NextResponse('Name the key', { status: 400 });
    const made = await apiKeys().create({ userId: session.personId, name, level });
    return NextResponse.json({ keyId: made.id, key: made.key });
  }
  if (parsed.data.fixture === 'revokeApiKey') {
    const { keyId } = parsed.data;
    if (!keyId) return new NextResponse('Name the key', { status: 400 });
    // Only the test user's own key: `revoke` turns off nothing of another person's.
    if (!(await apiKeys().revoke(session.personId, keyId))) return new NextResponse('Not your key', { status: 404 });
    return NextResponse.json({ keyId });
  }

  const deps = depsFor(session);
  const actor = actorFor(session);
  const { companyId } = await companyFor(session);
  if (parsed.data.fixture === 'programs') return seedPrograms(deps, actor, companyId);
  if (parsed.data.fixture === 'handEditProgram' || parsed.data.fixture === 'programRowIssue' || parsed.data.fixture === 'trashProgram') {
    const { programId } = parsed.data;
    if (!programId) return new NextResponse('Name the program', { status: 400 });
    const entry = await deps.directory.program(programId);
    if (!entry || entry.ownerUserId !== session.owner.userId) return new NextResponse('Not your program', { status: 404 });
    if (parsed.data.fixture === 'handEditProgram') await typeProgramLead(storage, entry.fileId);
    else if (parsed.data.fixture === 'trashProgram') await deps.programs.trash({ fileId: entry.fileId });
    else if (storage !== 'memory') return new NextResponse('Row issues come from typing in a Google sheet', { status: 400 });
    else showMemoryRowIssues(entry.fileId, [{ tab: 'Reasons', row: 4, message: 'Reason in Reasons row 4 is longer than a cell can hold.' }]);
    return NextResponse.json({ programId });
  }
  if (parsed.data.fixture === 'case') {
    const { partnerId, programId } = parsed.data;
    if (!partnerId) return new NextResponse('Name the partner type', { status: 400 });
    const made = await createCase(deps, actor, { companyId, partnerId, ...(programId ? { programId } : {}) });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
    const { benefits } = parsed.data;
    if (benefits) {
      const read = await readCase(deps, actor, { caseId: made.value.caseId });
      if (!read.ok) return NextResponse.json({ error: read.error }, { status: 500 });
      const c = read.value.value;
      const saved = await saveCase(deps, actor, { caseId: made.value.caseId, case: { ...c, benefits }, base: c, expectedUpdatedAt: c.updatedAt });
      if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
    }
    return NextResponse.json({ caseId: made.value.caseId });
  }
  if (parsed.data.fixture === 'caseFacts') return seedCaseFacts(deps, actor, companyId);
  if (parsed.data.fixture === 'contact') {
    const { accountId, name, title = '' } = parsed.data;
    if (!accountId || !name) return new NextResponse('Name the company and the person', { status: 400 });
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
    const out = await changePartner(deps, actor, { companyId, change: { kind: 'add', entity: 'person', values: { accountId, name, title, email } } });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    return NextResponse.json({ personId: out.value.entityId });
  }
  if (parsed.data.fixture === 'map') {
    const { partnerId, health = 'on_track' } = parsed.data;
    if (!partnerId) return new NextResponse('Name the partner type', { status: 400 });
    const made = await startMap(deps, actor, { companyId, partnerId });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
    const { mapId } = made.value;
    const today = await ownerToday(deps, actor.userId);
    const changes: MapChange[] = health === 'empty' ? [] : [
      { kind: 'add', entity: 'milestone', values: { name: 'Day 30: First check-in', targetDate: addDays(today, 20), criteria: '' } },
      health === 'off_track'
        ? { kind: 'add', entity: 'exitTrigger', values: { condition: 'No qualified opportunity within 90 days', status: 'triggered' } }
        : { kind: 'add', entity: 'activity', values: { title: 'Kickoff with both sponsors', side: 'joint', dueDate: addDays(today, health === 'at_risk' ? -10 : 10) } },
    ];
    for (const change of changes) {
      const out = await changeMap(deps, actor, { mapId, change });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    }
    if (parsed.data.people) {
      const add = async (change: MapChange) => {
        const out = await changeMap(deps, actor, { mapId, change });
        return out.ok ? out.value.entityId : null;
      };
      const address = (local: string) => (parsed.data.emailTag ? `${local}+${parsed.data.emailTag}@example.com` : `${local}@example.com`);
      const lena = await add({ kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena Ortiz', title: 'Sales lead', email: address('lena.ortiz'), role: 'sales_lead' } });
      const ben = await add({ kind: 'add', entity: 'person', values: { side: 'us', name: 'Ben Ito', title: 'Partner manager', email: address('ben.ito'), role: 'other' } });
      if (!lena || !ben) return NextResponse.json({ error: 'people' }, { status: 500 });
      const rows: MapChange[] = [
        { kind: 'add', entity: 'objective', values: { side: 'partner', statement: 'Grow deal size with a complete offer', successMeasure: '' } },
        { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Close three joint deals by day 90', successMeasure: '' } },
        { kind: 'add', entity: 'activity', values: { title: 'Train our sellers', side: 'partner', ownerId: lena, dueDate: addDays(today, 14) } },
        { kind: 'add', entity: 'activity', values: { title: 'Send the price list', side: 'us', ownerId: ben, dueDate: addDays(today, 7) } },
      ];
      for (const change of rows) if (!(await add(change))) return NextResponse.json({ error: 'rows' }, { status: 500 });
    }
    return NextResponse.json({ mapId });
  }
  if (parsed.data.fixture === 'ageMapLinks' || parsed.data.fixture === 'trashMap') {
    const { mapId } = parsed.data;
    const entry = mapId ? await deps.directory.map(mapId) : null;
    if (!mapId || !entry || entry.ownerUserId !== session.owner.userId) return new NextResponse('Not your MAP', { status: 404 });
    if (parsed.data.fixture === 'trashMap') {
      await deps.maps.trash({ fileId: entry.fileId });
      return NextResponse.json({ mapId });
    }
    const longAgo = new Date(Date.parse(deps.clock()) - 100 * 86_400_000).toISOString();
    for (const link of await deps.mapLinks.listForMap(mapId)) await deps.mapLinks.touch(link.id, longAgo);
    return NextResponse.json({ mapId });
  }
  if (parsed.data.fixture === 'handEditMap' || parsed.data.fixture === 'failMapDatesMove') {
    const { mapId } = parsed.data;
    if (!mapId) return new NextResponse('Name the MAP', { status: 400 });
    const entry = await deps.directory.map(mapId);
    const read = await readMap(deps, actor, { mapId });
    if (!entry || !read.ok) return new NextResponse('Not your MAP', { status: 404 });
    const { record } = read.value;
    if (parsed.data.fixture === 'failMapDatesMove') {
      if (!record.signedDate) return new NextResponse('Sign the partner type first', { status: 400 });
      await deps.directory.setMapDatesMoved(mapId, { failedFor: record.signedDate });
      return NextResponse.json({ mapId });
    }
    const activity = read.value.value.activities[0];
    if (!activity) return new NextResponse('The MAP has no activity', { status: 400 });
    const out = await deps.maps.apply(
      { fileId: entry.fileId },
      { kind: 'update', entity: 'activity', id: activity.id, patch: { status: 'blocked' }, record },
      { now: deps.clock(), actor: 'Lena Ortiz' },
    );
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    return NextResponse.json({ mapId });
  }
  if (parsed.data.fixture === 'caseProgram' || parsed.data.fixture === 'exampleCase') {
    const { partnerId } = parsed.data;
    if (!partnerId) return new NextResponse('Name the partner type', { status: 400 });
    return parsed.data.fixture === 'caseProgram'
      ? seedCaseProgram(deps, actor, companyId, partnerId, parsed.data.flatFee ?? false)
      : seedExampleCase(deps, actor, companyId, partnerId, parsed.data.oursMarkers ?? false);
  }
  if (parsed.data.fixture === 'handRemovePartner' || parsed.data.fixture === 'losePartners') {
    const entry = await deps.directory.partnerBook(companyId);
    if (!entry || entry.ownerUserId !== session.owner.userId) return new NextResponse('No Partners file', { status: 404 });
    if (parsed.data.fixture === 'losePartners') {
      await deps.partnerBooks.discard({ fileId: entry.fileId });
      return NextResponse.json({ partnersFileId: entry.fileId });
    }
    const { partnerId } = parsed.data;
    if (!partnerId) return new NextResponse('Name the partner type', { status: 400 });
    const out = await deps.partnerBooks.apply(
      { fileId: entry.fileId }, { kind: 'delete', entity: 'partner', id: partnerId }, { now: deps.clock(), actor: 'Typed in the sheet' },
    );
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    return NextResponse.json({ partnerId });
  }
  if (parsed.data.fixture === 'handEditFacts') {
    // The first read makes the file.
    const facts = await readCompanyFacts(deps, actor, { companyId });
    const entry = await deps.directory.companyFacts(companyId);
    if (!facts.ok || !entry) return NextResponse.json({ error: facts.ok ? 'no_file' : facts.error }, { status: 500 });
    await typeFactsYearly(storage, entry.fileId);
    return NextResponse.json({ factsFileId: entry.fileId });
  }
  // The first read makes the (empty) book.
  const book = await readPartners(deps, actor, { companyId });
  if (!book.ok) return NextResponse.json({ error: book.error }, { status: 500 });
  const marketIds: string[] = [];
  for (const info of SAMPLE_MARKETS) {
    const made = await createMarket(deps, actor, { companyId, info: { ...info, ourProduct: 'Our product', ourTargetCustomers: 'Our customers' } });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
    marketIds.push(made.value.marketId);
  }
  const hypothesis = await changeMarket(deps, actor, {
    marketId: marketIds[0], change: { kind: 'add', entity: 'hypothesis', values: SAMPLE_HYPOTHESIS },
  });
  if (!hypothesis.ok || !hypothesis.value.entityId) return NextResponse.json({ error: hypothesis.ok ? 'no_id' : hypothesis.error }, { status: 500 });
  const hypothesisId = hypothesis.value.entityId;
  const partnerIds: string[] = [];
  const accountIds: string[] = [];
  const send = (change: PartnerChange) => changePartner(deps, actor, { companyId, change });
  for (const { company, website, partnerType, place, markets = [], hypothesisIn } of SAMPLE_PARTNERS) {
    const account = await send({ kind: 'add', entity: 'account', values: { company, website } });
    if (!account.ok || !account.value.entityId) return NextResponse.json({ error: account.ok ? 'no_id' : account.error }, { status: 500 });
    accountIds.push(account.value.entityId);
    const added = await send({ kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType } });
    if (!added.ok || !added.value.entityId) return NextResponse.json({ error: added.ok ? 'no_id' : added.error }, { status: 500 });
    const id = added.value.entityId;
    partnerIds.push(id);
    const changes: PartnerChange[] = [
      ...markets.map((m): PartnerChange => ({
        kind: 'add', entity: 'marketLink', values: { partnerId: id, marketId: marketIds[m]!, hypothesisId: m === hypothesisIn ? hypothesisId : null },
      })),
      ...movesTo(id, place),
    ];
    for (const change of changes) {
      const out = await send(change);
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    }
  }
  if (parsed.data.closedInMarket) {
    for (const company of ['Proseware Ltd', 'Lucerne Publishing']) {
      const partnerId = partnerIds[SAMPLE_PARTNERS.findIndex((p) => p.company === company)]!;
      const out = await send({ kind: 'add', entity: 'marketLink', values: { partnerId, marketId: marketIds[0]!, hypothesisId: null } });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    }
  }
  if (parsed.data.callInMarket) {
    const partnerId = partnerIds[SAMPLE_PARTNERS.findIndex((p) => p.company === 'Tailspin Solutions')]!;
    const out = await send({
      kind: 'add', entity: 'call',
      values: { partnerId, date: deps.clock().slice(0, 10), kind: 'discovery', topics: { customerPains: SAMPLE_CALL_NOTE } },
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
  }
  if (parsed.data.lose === 'partners') {
    const entry = await deps.directory.partnerBook(companyId);
    if (entry) await deps.partnerBooks.discard({ fileId: entry.fileId });
  } else if (parsed.data.lose === 'market') {
    const entry = await deps.directory.market(marketIds[0]!);
    if (entry) await deps.markets.discard({ fileId: entry.fileId });
  }
  if (parsed.data.valuePoints) {
    for (const text of SAMPLE_VALUE_POINTS) {
      const out = await changeMarket(deps, actor, { marketId: marketIds[0]!, change: { kind: 'add', entity: 'valuePoint', values: { text, state: 'confirmed' } } });
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    }
  }
  let programId: string | undefined;
  if (parsed.data.feedingProgram) {
    const made = await createProgram(deps, actor, { companyId, partnerType: 'reseller', from: 'fresh' });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
    programId = made.value.programId;
    const fed = await changeMarket(deps, actor, { marketId: marketIds[0]!, change: { kind: 'updateInfo', patch: { feedsProgramId: programId } } });
    if (!fed.ok) return NextResponse.json({ error: fed.error }, { status: 500 });
    if (parsed.data.joinProgram) {
      const partnerId = partnerIds[SAMPLE_PARTNERS.findIndex((p) => p.company === 'Tailspin Solutions')]!;
      const joined = await send({ kind: 'update', entity: 'partner', id: partnerId, patch: { programId, level: 'reg' } });
      if (!joined.ok) return NextResponse.json({ error: joined.error }, { status: 500 });
    }
  }
  let acmeAccountId: string | undefined;
  let acmePartnerIds: { reseller: string; technology: string; referral?: string } | undefined;
  if (parsed.data.twoTypes) {
    const account = await send({ kind: 'add', entity: 'account', values: { company: 'Acme', website: 'acme.example', country: 'Austria' } });
    if (!account.ok || !account.value.entityId) return NextResponse.json({ error: account.ok ? 'no_id' : account.error }, { status: 500 });
    acmeAccountId = account.value.entityId;
    const reseller = await send({ kind: 'add', entity: 'partner', values: { accountId: acmeAccountId, partnerType: 'reseller' } });
    if (!reseller.ok || !reseller.value.entityId) return NextResponse.json({ error: reseller.ok ? 'no_id' : reseller.error }, { status: 500 });
    const technology = await send({ kind: 'add', entity: 'partner', values: { accountId: acmeAccountId, partnerType: 'technology' } });
    if (!technology.ok || !technology.value.entityId) return NextResponse.json({ error: technology.ok ? 'no_id' : technology.error }, { status: 500 });
    const signed = await send({ kind: 'markSigned', partnerId: technology.value.entityId, signedDate: '2026-09-15' });
    if (!signed.ok) return NextResponse.json({ error: signed.error }, { status: 500 });
    const growth = await send({ kind: 'setStage', partnerId: technology.value.entityId, to: 'growth' });
    if (!growth.ok) return NextResponse.json({ error: growth.error }, { status: 500 });
    acmePartnerIds = { reseller: reseller.value.entityId, technology: technology.value.entityId };
    if (parsed.data.referral) {
      const referral = await send({ kind: 'add', entity: 'partner', values: { accountId: acmeAccountId, partnerType: 'referral' } });
      if (!referral.ok || !referral.value.entityId) return NextResponse.json({ error: referral.ok ? 'no_id' : referral.error }, { status: 500 });
      acmePartnerIds = { ...acmePartnerIds, referral: referral.value.entityId };
    }
  }
  const entry = await deps.directory.partnerBook(companyId);
  if (parsed.data.oldPartners) {
    if (!entry) return NextResponse.json({ error: 'no_file' }, { status: 500 });
    await markBookOld(storage, entry.fileId);
  }
  return NextResponse.json({
    partnerIds, accountIds, marketIds, ...(entry ? { partnersFileId: entry.fileId } : {}), ...(acmeAccountId ? { acmeAccountId } : {}),
    ...(acmePartnerIds ? { acmePartnerIds } : {}),
    ...(programId ? { programId } : {}),
  });
}

/** Two reseller programs, fresh: "Reseller", then "Reseller · DACH". Answers with their ids, oldest first. */
async function seedPrograms(deps: ReturnType<typeof depsFor>, actor: ReturnType<typeof actorFor>, companyId: string) {
  const programIds: string[] = [];
  for (const focus of ['', 'DACH']) {
    const made = await createProgram(deps, actor, { companyId, partnerType: 'reseller', from: 'fresh' });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
    const { programId, snapshot: { value } } = made.value;
    if (focus) {
      const saved = await saveProgram(deps, actor, { programId, program: { ...value, focus }, base: value, expectedUpdatedAt: value.updatedAt || null });
      if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
    }
    programIds.push(programId);
  }
  return NextResponse.json({ programIds });
}

type SeedDeps = ReturnType<typeof depsFor>;
type SeedActor = ReturnType<typeof actorFor>;

/** Company facts with a typical customer, saved as the Company facts page saves them. */
async function seedCaseFacts(deps: SeedDeps, actor: SeedActor, companyId: string) {
  const read = await readCompanyFacts(deps, actor, { companyId });
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 500 });
  const facts = read.value.value;
  const saved = await saveCompanyFacts(deps, actor, {
    companyId, facts: { ...facts, currency: 'EUR', yearly: 24000, once: 4000, renew: 90 }, base: facts, expectedUpdatedAt: facts.updatedAt || null,
  });
  return saved.ok ? NextResponse.json({ companyId }) : NextResponse.json({ error: saved.error }, { status: 500 });
}

/** A fresh program of the partner type's type, its levels "Member" and "Gold", with the partner type in it at Member. */
async function seedCaseProgram(deps: SeedDeps, actor: SeedActor, companyId: string, partnerId: string, flatFee: boolean) {
  const book = await readPartners(deps, actor, { companyId });
  if (!book.ok) return NextResponse.json({ error: book.error }, { status: 500 });
  const partner = book.value.value.partners.find((p) => p.id === partnerId);
  if (!partner) return new NextResponse('Not your partner type', { status: 404 });
  const made = await createProgram(deps, actor, { companyId, partnerType: partner.partnerType, from: 'fresh' });
  if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
  const { programId, snapshot: { value } } = made.value;
  const program = { ...value, regName: 'Member', prefName: 'Gold', ...(flatFee ? { money: { ...value.money, model: 'fee' as const } } : {}) };
  const saved = await saveProgram(deps, actor, { programId, program, base: value, expectedUpdatedAt: value.updatedAt || null });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  const joined = await changePartner(deps, actor, { companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch: { programId, level: 'reg' } } });
  if (!joined.ok) return NextResponse.json({ error: joined.error }, { status: 500 });
  return NextResponse.json({ programId });
}

/** A case for the partner type with the SaaS example's partner side typed in, saved through the commands. */
/** Our case with every text a marker, and a few amounts written to be found nowhere else. */
function markedOurs(ours: BusinessCase['ours']): BusinessCase['ours'] {
  return {
    ...ours,
    recommendation: 'OURS-MARKER-RECOMMENDATION',
    ask: 'OURS-MARKER-ASK',
    preparedBy: 'OURS-MARKER-PREPARED',
    risk: { ...ours.risk, why: 'OURS-MARKER-RISK', amount: 919191 },
    efficiency: { ...ours.efficiency, on: true, note: 'OURS-MARKER-EFFICIENCY' },
    churn: { ...ours.churn, note: 'OURS-MARKER-CHURN' },
    strategic: [{ id: 'reason_marker0001', text: 'OURS-MARKER-REASON', weight: 'high', alone: true }],
    costs: [...ours.costs, { id: 'cost_marker00001', name: 'OURS-MARKER-COST', when: 'yearly', amount: 818181, source: 'finance' }],
    alone: { ...ours.alone, costs: [{ id: 'cost_marker00002', name: 'OURS-MARKER-ALONE', when: 'start', amount: 717171, source: 'sales' }] },
  };
}

async function seedExampleCase(deps: SeedDeps, actor: SeedActor, companyId: string, partnerId: string, oursMarkers: boolean) {
  const made = await createCase(deps, actor, { companyId, partnerId });
  if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
  const { caseId } = made.value;
  const read = await readCase(deps, actor, { caseId });
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 500 });
  const c = read.value.value;
  const example = structuredClone(EXAMPLES.saas.case);
  const type = example.offer.types[0]!;
  const next = {
    ...c,
    deals: example.deals, scenario: example.scenario, implementation: example.implementation, managed: example.managed, other: example.other,
    serviceProfit: example.serviceProfit, supportCost: example.supportCost, costs: example.costs,
    ours: oursMarkers ? markedOurs(example.ours) : example.ours,
    offer: {
      ...c.offer, currency: example.offer.currency, renewal: example.offer.renewal, preferred: example.offer.preferred, products: example.offer.products,
      types: c.offer.types.map((t) => (t.id === c.typeId ? { ...t, roles: type.roles, registered: type.registered, preferred: type.preferred, fee: type.fee } : t)),
    },
  };
  const saved = await saveCase(deps, actor, { caseId, case: next, base: c, expectedUpdatedAt: c.updatedAt });
  return saved.ok ? NextResponse.json({ caseId }) : NextResponse.json({ error: saved.error }, { status: 500 });
}

/**
 * The Partners files that went to the trash, so an e2e can see the old file went. Like POST: only with test sign-in on
 * (never on Vercel), and only for a signed-in test user (files in memory, or in the database on the database edition).
 * Ids only.
 */
export async function GET(request?: Request) {
  if (!testSignInEnabled()) return new NextResponse('Not found', { status: 404 });
  const session = await currentOwner();
  // A test user only: never a Google account, and on the database edition never a real person (test-users.ts).
  if (!session || session.storage === 'google' || !isTestUser(session.email)) return new NextResponse('Sign in with test sign-in first', { status: 401 });
  const storage: SeedStorage = session.storage;
  // `?programId=`: the Program Sheet and Public page last written to that program's file (one of the user's own).
  const programId = request ? new URL(request.url).searchParams.get('programId') : null;
  if (programId) {
    const entry = await depsFor(session).directory.program(programId);
    if (!entry || entry.ownerUserId !== session.owner.userId) return new NextResponse('Not your program', { status: 404 });
    const publicText = await programPublicText(storage, entry.fileId);
    return NextResponse.json({ programOutputs: publicText === null ? null : { publicText } });
  }
  const { companyId } = await companyFor(session);
  return NextResponse.json({ trashedPartnerFiles: await trashedPartnerFiles(storage, companyId) });
}
