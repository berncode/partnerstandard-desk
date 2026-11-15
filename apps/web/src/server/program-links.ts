import { listMarkets, listPrograms, readMarket, readPartners, readProgram, type Actor, type CommandResult, type Deps } from '@partner-desk/commands';
import { levelNames, levelOf, accountOf, type Level } from '@partner-desk/core';
import type { PartnerType } from '@partner-desk/method';
import type { ProgramLevels, ProgramMembers, ProgramRow, ProgramsOverview, StartMarket } from '@/programs/links';
import { twinIds, withTitles, type ProgramOption } from '@/programs/title';
import { marketPartnerType } from '@/partners/partners-model';

// The links between markets, partners and programs, read through the commands for the screens (plan 6, task 7).
// Each says what it costs in Google reads; the store caches a file's read for a minute.

/**
 * The company's programs for a screen, each with its title: its label ("Reseller · DACH"), plus its name when another
 * program has the same label (Program Designer's rule). The list is the directory's (no Google read); only the
 * names of such twins are read, one program file each. A twin that can't be read keeps its label.
 */
export async function programOptions(deps: Deps, actor: Actor, companyId: string): Promise<CommandResult<ProgramOption[]>> {
  const listed = await listPrograms(deps, actor, { companyId });
  if (!listed.ok) return listed;
  const twins = twinIds(listed.value);
  const names = new Map<string, string>();
  await Promise.all(twins.map(async (programId) => {
    const read = await readProgram(deps, actor, { programId });
    if (read.ok) names.set(programId, read.value.value.name);
  }));
  return { ok: true, value: withTitles(listed.value, names) };
}

/**
 * The level names of each program, and whether it has Preferred: one program file read each. A program that
 * isn't there (deleted, its file gone, or not the person's) is `gone`; one that can't be read now says why.
 */
export async function programLevels(deps: Deps, actor: Actor, programIds: readonly string[]): Promise<Record<string, ProgramLevels>> {
  const read = await Promise.all([...new Set(programIds)].map(async (programId): Promise<[string, ProgramLevels]> => {
    const result = await readProgram(deps, actor, { programId });
    if (result.ok) {
      const { reg, pref } = levelNames(result.value.value);
      return [programId, { status: 'ready', reg, pref, prefOn: result.value.value.prefOn }];
    }
    if (result.error === 'file_not_found' || result.error === 'invalid') return [programId, { status: 'gone' }];
    return [programId, { status: 'failed', message: result.message }];
  }));
  return Object.fromEntries(read);
}

/** The company's markets that aren't archived and are for `partnerType` as the directory lists them (or can't tell). */
async function openMarketsOf(deps: Deps, actor: Actor, companyId: string, partnerType: PartnerType) {
  const listed = await listMarkets(deps, actor, { companyId });
  if (!listed.ok) return listed;
  return {
    ok: true as const,
    value: listed.value.filter((m) => !m.archived && (marketPartnerType(m.displayName) ?? partnerType) === partnerType),
  };
}

/**
 * A program's partner types (with their level) and the open markets that feed it, for the program's page. It costs
 * a read of the Partners file and one read of each open market of the program's partner type.
 */
export async function programMembers(
  deps: Deps, actor: Actor, companyId: string, programId: string, partnerType: PartnerType,
): Promise<CommandResult<ProgramMembers>> {
  const [book, markets] = await Promise.all([readPartners(deps, actor, { companyId }), openMarketsOf(deps, actor, companyId, partnerType)]);
  if (!book.ok) return book;
  if (!markets.ok) return markets;
  const value = book.value.value;
  const partners = value.partners
    .filter((p) => p.programId === programId)
    .map((p) => ({
      partnerId: p.id, accountId: p.accountId, company: accountOf(value, p)?.company ?? '', partnerType: p.partnerType, level: levelOf(p) ?? 'reg',
    }))
    .sort((a, b) => a.company.localeCompare(b.company));
  const feeding: ProgramMembers['markets'] = [];
  for (const m of markets.value) {
    const read = await readMarket(deps, actor, { marketId: m.marketId });
    // A market that can't be read now is left out: the list is for finding them, not a count that stops anything.
    if (read.ok && read.value.value.info.feedsProgramId === programId) feeding.push({ marketId: m.marketId, displayName: m.displayName });
  }
  return { ok: true, value: { partners, markets: feeding } };
}

/**
 * Every program of the company for the Programs page, with its partners per level and the open markets that feed it.
 * It costs the directory's list, a read of the Partners file, one read of each program (for its level names) and one
 * of each open market of a type some program has (the others can't feed one), side by side. A market that can't be
 * read leaves every card's markets unknown; a failed read of the Partners file or a program is handed up (`problem`).
 */
export async function programsOverview(deps: Deps, actor: Actor, companyId: string): Promise<CommandResult<ProgramsOverview>> {
  const listed = await programOptions(deps, actor, companyId);
  if (!listed.ok) return listed;
  if (listed.value.length === 0) return { ok: true, value: { rows: [], problem: null } };
  const types = new Set<PartnerType>(listed.value.map((p) => p.partnerType));
  const [book, markets, programs] = await Promise.all([
    readPartners(deps, actor, { companyId }),
    listMarkets(deps, actor, { companyId }),
    Promise.all(listed.value.map((p) => readProgram(deps, actor, { programId: p.programId }))),
  ]);
  let feeding: Map<string, { marketId: string; displayName: string }[]> | null = null;
  if (markets.ok) {
    const open = markets.value.filter((m) => {
      const type = marketPartnerType(m.displayName);
      return !m.archived && (type === null || types.has(type));
    });
    const reads = await Promise.all(open.map((m) => readMarket(deps, actor, { marketId: m.marketId })));
    if (reads.every((r) => r.ok)) {
      feeding = new Map();
      reads.forEach((read, i) => {
        const fed = read.ok ? read.value.value.info.feedsProgramId : '';
        if (fed) feeding!.set(fed, [...(feeding!.get(fed) ?? []), { marketId: open[i]!.marketId, displayName: open[i]!.displayName }]);
      });
    }
  }
  const goneError = (error: string) => error === 'file_not_found' || error === 'invalid';
  const failedProgram = programs.find((r) => !r.ok && !goneError(r.error));
  const problem: ProgramsOverview['problem'] = !book.ok ? { failure: { error: book.error, message: book.message }, partnersFile: true }
    : failedProgram && !failedProgram.ok ? { failure: { error: failedProgram.error, message: failedProgram.message }, partnersFile: false }
    : null;
  const rows = listed.value.map(({ programId, title, partnerType }, i): ProgramRow => {
    const read = programs[i]!;
    let levels: ProgramRow['levels'] = null;
    if (read.ok && book.ok) {
      const names = levelNames(read.value.value);
      const at = (level: Level) => book.value.value.partners.filter((p) => p.programId === programId && (levelOf(p) ?? 'reg') === level).length;
      // Preferred is counted while the program has it, or while a partner still sits there (as on the program's page).
      const shown: Level[] = read.value.value.prefOn || at('pref') > 0 ? ['reg', 'pref'] : ['reg'];
      levels = shown.map((level) => ({ name: names[level], count: at(level) }));
    }
    return { programId, title, partnerType, gone: !read.ok && goneError(read.error), levels, markets: feeding ? feeding.get(programId) ?? [] : null };
  });
  return { ok: true, value: { rows, problem } };
}

/**
 * The markets a program of `partnerType` can start from (spec 4.3): open, of that type, with a partner hypothesis that
 * holds. One read of each open market of the type.
 */
export async function marketsToStartFrom(
  deps: Deps, actor: Actor, companyId: string, partnerType: PartnerType,
): Promise<CommandResult<StartMarket[]>> {
  const markets = await openMarketsOf(deps, actor, companyId, partnerType);
  if (!markets.ok) return markets;
  const offered: StartMarket[] = [];
  for (const m of markets.value) {
    const read = await readMarket(deps, actor, { marketId: m.marketId });
    if (!read.ok) continue;
    const { info, hypotheses } = read.value.value;
    if (info.partnerType === partnerType && hypotheses.some((h) => h.status === 'holds')) offered.push({ marketId: m.marketId, displayName: m.displayName });
  }
  return { ok: true, value: offered.sort((a, b) => a.displayName.localeCompare(b.displayName)) };
}
