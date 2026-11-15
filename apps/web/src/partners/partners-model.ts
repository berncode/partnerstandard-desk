// What the Partners screen shows, worked out from the Partner book and the URL. Pure: no React, no I/O.
import {
  accountOf, fillEmpty, findSameAccount, findSamePartner, marketTypeOfDisplayName, newId, sameCompany, sectionsOf, startView, viewOf,
  type AccountFields, type Health, type IsoDate, type Partner, type PartnerAccount, type PartnerBook, type PartnerChange,
} from '@partner-desk/core';
import {
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  RECRUITMENT_STEPS,
  STAGES,
  STAGE_LABELS,
  STEP_LABELS,
  VIEWS,
  type PartnerType,
  type RecruitmentStep,
  type Stage,
  type View,
} from '@partner-desk/method';
import {
  CLOSED_LABELS,
  COPY,
} from '@partner-desk/copy';
import type { ProgramOption } from '@/programs/title';

export type Layout = 'list' | 'board';

/** What the address says: the view, the filters and the layout. */
export interface PartnerQuery {
  view: View;
  type: PartnerType | null;
  market: string | null;
  /** A program's id, `none` for the partners in no program, or null for all. */
  program: string | null;
  /** A choice from `STAGE_CHOICES[view]`, or null for all. */
  stage: string | null;
  /**
   * The MAP health filter (spec 5.7): a health, `empty` for a MAP with nothing planned yet, `none` for the partner types
   * without a MAP, or null for all.
   */
  health: HealthChoice | null;
  /** The list's order: most recently changed first, or what needs attention in the MAP first. */
  sort: SortOrder;
  layout: Layout;
}

export type HealthChoice = Health | 'empty' | 'none';
export const HEALTH_CHOICES: readonly HealthChoice[] = ['off_track', 'at_risk', 'on_track', 'empty', 'none'];

/**
 * The partner types that have a MAP, by their row id: the directory's list (`listMaps`), not the Partners tab. The row
 * keeps no health for an empty MAP (owner, 2026-10-31), so only the directory tells an empty MAP from no MAP.
 */
export type MapsListed = ReadonlySet<string>;
const NO_MAPS: MapsListed = new Set();
export type SortOrder = 'recent' | 'health';

/** A market as the screen knows it: from the directory, so only its id and the name it is listed under. */
export interface MarketOption { marketId: string; displayName: string; archived: boolean }

export interface Choice { value: string; label: string }

/** The stage filter's choices and the board's columns, per view. Potential goes by step, Active by stage. */
export const STAGE_CHOICES: Record<View, Choice[]> = {
  potential: RECRUITMENT_STEPS.map((step) => ({ value: step, label: STEP_LABELS[step] })),
  active: STAGES.filter((stage) => stage !== 'recruitment').map((stage) => ({ value: stage, label: STAGE_LABELS[stage] })),
  closed: [
    { value: 'not_now', label: CLOSED_LABELS.not_now },
    { value: 'no', label: CLOSED_LABELS.no },
    { value: 'exited', label: COPY.STAGE_EXITED },
  ],
};

/** Only Potential and Active have a board: Closed has no steps to put in columns. */
export const hasBoard = (view: View): boolean => view !== 'closed';

/** The choice a partner has in its view's stage filter. */
export function stageValueOf(p: Partner): string {
  switch (viewOf(p)) {
    case 'potential':
      return p.step ?? 'researched';
    case 'active':
      return p.stage;
    case 'closed':
      return p.exitedDate !== null ? 'exited' : (p.closed ?? 'no');
  }
}

type Params = { get(name: string): string | null };

/** The query from the address. Unknown values are dropped; with no view, Active, or Potential when nobody is active. */
export function parseQuery(params: Params, partners: readonly Partner[]): PartnerQuery {
  const given = params.get('view');
  const view = VIEWS.find((v) => v === given) ?? startView(partners as Partner[]);
  const type = PARTNER_TYPES.find((t) => t === params.get('type')) ?? null;
  const stage = STAGE_CHOICES[view].find((c) => c.value === params.get('stage'))?.value ?? null;
  const layout: Layout = params.get('layout') === 'board' && hasBoard(view) ? 'board' : 'list';
  const health = HEALTH_CHOICES.find((h) => h === params.get('health')) ?? null;
  const sort: SortOrder = params.get('sort') === 'health' ? 'health' : 'recent';
  return { view, type, market: params.get('market') || null, program: params.get('program') || null, stage, health, sort, layout };
}

/** The address for a query: only what is set, so a plain visit has a plain address. */
export function queryString(q: PartnerQuery): string {
  const params = new URLSearchParams({ view: q.view });
  if (q.type) params.set('type', q.type);
  if (q.market) params.set('market', q.market);
  if (q.program) params.set('program', q.program);
  if (q.stage) params.set('stage', q.stage);
  if (q.health) params.set('health', q.health);
  if (q.sort === 'health') params.set('sort', 'health');
  if (q.layout === 'board') params.set('layout', 'board');
  return `?${params.toString()}`;
}

/** Another view keeps the type, the market and the layout, and drops the stage (each view has its own). */
export const switchView = (q: PartnerQuery, view: View): PartnerQuery => ({
  ...q, view, stage: null, layout: hasBoard(view) ? q.layout : 'list',
});

export const hasFilters = (q: PartnerQuery): boolean =>
  q.type !== null || q.market !== null || q.program !== null || q.stage !== null || q.health !== null;

/** The query with every filter cleared; the view, the order and the layout stay. */
export const withoutFilters = (q: PartnerQuery): PartnerQuery => ({ ...q, type: null, market: null, program: null, stage: null, health: null });

/**
 * What the MAP health column says of a partner type (spec 5.7, ruling R6): "Not signed" once it was closed before
 * signing, as its MAP says on every screen (and the row's copy is cleared on the MAP's next write); else its MAP's
 * health; else "Nothing planned yet" when it has a MAP (`hasMap`, from the directory) with no health; else no MAP.
 */
export function mapHealthOf(p: Pick<Partner, 'closed' | 'signedDate' | 'mapHealth'>, hasMap = false): HealthChoice | 'not_signed' {
  if (p.closed !== null && p.signedDate === null) return 'not_signed';
  return p.mapHealth ?? (hasMap ? 'empty' : 'none');
}

const healthIn = (p: Partner, maps: MapsListed) => mapHealthOf(p, maps.has(p.id));
const inHealth = (p: Partner, health: HealthChoice | null, maps: MapsListed): boolean => health === null || healthIn(p, maps) === health;

/** The MAP health column and filter show once a partner type has a MAP, or the address asks for them. */
export const showsMapHealth = (book: PartnerBook, q: PartnerQuery, maps: MapsListed = NO_MAPS): boolean =>
  q.health !== null || q.sort === 'health' || maps.size > 0 || book.partners.some((p) => p.mapHealth !== null);

/** The Program filter's choice for the partners in no program. */
export const NO_PROGRAM = 'none';

const inProgram = (p: Partner, program: string | null): boolean =>
  program === null || (program === NO_PROGRAM ? p.programId === null : p.programId === program);

/**
 * The Program column: the program's title, a program the list doesn't hold as gone, or nothing. When the list
 * couldn't be read (`listed` false) a program is the stored id, never "deleted".
 */
export function programText(p: Pick<Partner, 'programId'>, programs: readonly ProgramOption[], listed = true): string {
  if (p.programId === null) return '';
  return programs.find((item) => item.programId === p.programId)?.title ?? (listed ? COPY.PROGRAM_GONE : p.programId);
}

const inMarket = (book: PartnerBook, partnerId: string, marketId: string) =>
  book.marketLinks.some((l) => l.partnerId === partnerId && l.marketId === marketId);

/** Partners the type, market, program and MAP health filters let through, in any view. */
function filteredByTypeAndMarket(book: PartnerBook, q: PartnerQuery, maps: MapsListed): Partner[] {
  return book.partners.filter((p) =>
    (q.type === null || p.partnerType === q.type) && (q.market === null || inMarket(book, p.id, q.market)) && inProgram(p, q.program)
    && inHealth(p, q.health, maps));
}

/** How many partners each view holds, under the type, market, program and MAP health filters (the stage filter belongs to one view). */
export function viewCounts(book: PartnerBook, q: PartnerQuery, maps: MapsListed = NO_MAPS): Record<View, number> {
  const counts: Record<View, number> = { potential: 0, active: 0, closed: 0 };
  for (const p of filteredByTypeAndMarket(book, q, maps)) counts[viewOf(p)]++;
  return counts;
}

/** The company's name for a partner type, or nothing when the company row is missing. */
export function companyName(book: PartnerBook, partner: Partner): string {
  return accountOf(book, partner)?.company ?? '';
}

/** Most recently changed first, then by name, so the order is the same on every visit. */
function byRecent(book: PartnerBook): (a: Partner, b: Partner) => number {
  return (a, b) => {
    if (a.updatedAt !== b.updatedAt) return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    return companyName(book, a).localeCompare(companyName(book, b));
  };
}

const HEALTH_RANK: Record<HealthChoice | 'not_signed', number> = { off_track: 0, at_risk: 1, on_track: 2, empty: 3, not_signed: 4, none: 5 };

/**
 * What needs attention in the MAP first (spec 5.7): off track, at risk, on track, nothing planned yet, not signed, no
 * MAP, as the Plans page sorts; then the nearest next milestone; then the most recently changed.
 */
function byHealth(book: PartnerBook, maps: MapsListed): (a: Partner, b: Partner) => number {
  const recent = byRecent(book);
  return (a, b) => {
    const rank = HEALTH_RANK[healthIn(a, maps)] - HEALTH_RANK[healthIn(b, maps)];
    if (rank !== 0) return rank;
    if (a.mapNextMilestone !== b.mapNextMilestone) {
      if (a.mapNextMilestone === null) return 1;
      if (b.mapNextMilestone === null) return -1;
      return a.mapNextMilestone.localeCompare(b.mapNextMilestone);
    }
    return recent(a, b);
  };
}

/** The partners of the query's view that pass every filter, in the query's order. A partner in two markets is one row. */
export function partnersFor(book: PartnerBook, q: PartnerQuery, maps: MapsListed = NO_MAPS): Partner[] {
  return filteredByTypeAndMarket(book, q, maps)
    .filter((p) => viewOf(p) === q.view && (q.stage === null || stageValueOf(p) === q.stage))
    .sort(q.sort === 'health' ? byHealth(book, maps) : byRecent(book));
}

export interface Column { value: string; title: string; partners: Partner[] }

/** The board: one column per step (Potential) or stage (Active), every column shown even when empty. */
export function columnsFor(partners: readonly Partner[], view: View): Column[] {
  return STAGE_CHOICES[view].map(({ value, label }) => ({
    value, title: label, partners: partners.filter((p) => stageValueOf(p) === value),
  }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "21 Oct 2026" from a date or a date and time. Not a locale format, so every visit and every server reads the same. */
export function formatDate(iso: string | null): string {
  const match = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return '';
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''} ${match[1]}`;
}

/** The Stage column: the step inside Recruitment, the date after an exit, the way a partner was closed. */
export function stageText(p: Partner): string {
  if (p.exitedDate !== null) return COPY.EXITED_ON_DATE(formatDate(p.exitedDate));
  if (p.closed !== null) return CLOSED_LABELS[p.closed];
  if (p.stage === 'recruitment') return p.step ? COPY.STAGE_IN_RECRUITMENT(STEP_LABELS[p.step]) : STAGE_LABELS.recruitment;
  return STAGE_LABELS[p.stage];
}

/** The names of the markets a partner is in (every link once), in the order they were linked. Markets we can't name are left out. */
export function marketNamesOf(book: PartnerBook, markets: readonly MarketOption[], partnerId: string): string[] {
  const names = book.marketLinks
    .filter((l) => l.partnerId === partnerId)
    .flatMap((l) => markets.find((m) => m.marketId === l.marketId)?.displayName ?? []);
  return [...new Set(names)];
}

/** The partner type a market is for. The directory lists a market as "{name} · {partner type}", so it is read from the end. */
export const marketPartnerType = (displayName: string): PartnerType | null => marketTypeOfDisplayName(displayName);

/** The markets the dialog offers for a partner type: not archived, and for that type. */
export const marketsForType = (markets: readonly MarketOption[], type: PartnerType): MarketOption[] =>
  markets.filter((m) => !m.archived && marketPartnerType(m.displayName) === type)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

/** Where a partner can be put when it is added: a recruitment step, or a stage after signing. */
export type Where = RecruitmentStep | Exclude<Stage, 'recruitment' | 'exit'>;
export const WHERE_STAGES = ['onboarding', 'growth', 'expansion'] as const satisfies readonly Where[];
export const isSignedWhere = (where: Where): where is (typeof WHERE_STAGES)[number] => (WHERE_STAGES as readonly string[]).includes(where);

/**
 * The moves that take a new partner (which starts at Researched) to `where`: a step at a time, or signing and then a
 * stage at a time. They are the ordinary lifecycle changes, so every rule applies.
 */
export function placementChanges(partnerId: string, where: Where, signedDate: IsoDate): PartnerChange[] {
  if (isSignedWhere(where)) {
    const stages = WHERE_STAGES.slice(1, WHERE_STAGES.indexOf(where) + 1);
    return [
      { kind: 'markSigned', partnerId, signedDate },
      ...stages.map((to): PartnerChange => ({ kind: 'setStage', partnerId, to })),
    ];
  }
  return RECRUITMENT_STEPS.slice(1, RECRUITMENT_STEPS.indexOf(where) + 1).map((to): PartnerChange => ({ kind: 'setStep', partnerId, to }));
}

export type Duplicate =
  | { kind: 'same_type'; partner: Partner; account: PartnerAccount; linked: boolean }
  | { kind: 'other_type'; partner: Partner; account: PartnerAccount; fill: Partial<AccountFields> }
  | { kind: 'exclusion'; company: string };

/**
 * What adding a partner by hand says about a company that may be here already. The company is found first
 * (`findSameAccount`), then a section of this type (`findSamePartner`). A company on the market's Exclusions is
 * named only when it is not already a partner.
 */
export function duplicateOf(
  book: PartnerBook,
  input: { company: string; website: string; country?: string; partnerType: PartnerType; marketId: string | null },
  exclusions: readonly { company: string; website: string }[] = [],
): Duplicate | null {
  if (input.company.trim() === '' && input.website.trim() === '') return null;
  const same = findSamePartner(book, input);
  if (same) {
    const account = accountOf(book, same);
    if (!account) return null;
    return { kind: 'same_type', partner: same, account, linked: input.marketId !== null && inMarket(book, same.id, input.marketId) };
  }
  const account = findSameAccount(book, input);
  if (account) {
    const other = sectionsOf(book, account.id).find((section) => section.partnerType !== input.partnerType);
    if (other) {
      const fill = fillEmpty(account, {
        company: input.company.trim(), website: input.website.trim(), country: input.country?.trim() ?? '',
      });
      return { kind: 'other_type', partner: other, account, fill };
    }
  }
  const excluded = exclusions.find((item) => sameCompany(item, input));
  return excluded ? { kind: 'exclusion', company: excluded.company.trim() || input.company.trim() } : null;
}

/**
 * The changes that add a partner type for a company typed by hand (the Add a partner dialog, the pipeline's quick
 * add), to be saved as one batch. The company that is already here (`findSameAccount`: one with a partner type first,
 * so also one left with none by a half-saved add) gets the type, and only its empty facts are filled; otherwise a new
 * company comes with it. The caller has ruled out that type on that company already (`duplicateOf`).
 */
export function newPartnerChanges(
  book: PartnerBook, values: { company: string; website: string; country?: string }, partnerType: PartnerType, partnerId: string,
  accountId: () => string = () => newId('account'),
): PartnerChange[] {
  const company = values.company.trim();
  const website = values.website.trim();
  const country = values.country?.trim();
  const addType = (id: string): PartnerChange => ({ kind: 'add', entity: 'partner', values: { id: partnerId, accountId: id, partnerType } });
  const account = findSameAccount(book, { company, website });
  if (account) {
    const fill = fillEmpty(account, { company, website, ...(country !== undefined ? { country } : {}) });
    return [
      ...(Object.keys(fill).length > 0
        ? [{ kind: 'update', entity: 'account', id: account.id, patch: fill, expectedUpdatedAt: account.updatedAt } satisfies PartnerChange]
        : []),
      addType(account.id),
    ];
  }
  const id = accountId();
  return [
    { kind: 'add', entity: 'account', values: { id, company, website, ...(country !== undefined ? { country } : {}) } },
    addType(id),
  ];
}

/** The sentence for a company that already has this partner type. A closed one says Not now or No, as the import's note does (a section keeps no closed date). */
export function sameTypeMessage(duplicate: Extract<Duplicate, { kind: 'same_type' }>): string {
  const company = duplicate.account.company;
  const type = PARTNER_TYPE_LABELS[duplicate.partner.partnerType];
  if (duplicate.partner.closed) return COPY.ROW_CLOSED(company, type, CLOSED_LABELS[duplicate.partner.closed]);
  return COPY.SAME_TYPE_FOUND(company, type);
}

/** The sentence for a company that already has a different partner type. */
export function otherTypeMessage(duplicate: Extract<Duplicate, { kind: 'other_type' }>, addedType: PartnerType): string {
  return COPY.ALREADY_YOUR_TYPE(duplicate.account.company, PARTNER_TYPE_LABELS[duplicate.partner.partnerType], PARTNER_TYPE_LABELS[addedType]);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Today as YYYY-MM-DD in the browser's time zone, for the market pages' dates (a change-log line, an import). The
 * partner pages' dialogs (signing, exit, a call, a new partner) start on the owner's today from the server instead.
 * Never the UTC date, which is yesterday in Vienna just after midnight and tomorrow in the US every evening.
 */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
