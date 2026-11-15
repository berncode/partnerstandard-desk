// The leave-out list and examples come from the Partner book.
import { PARTNER_TYPE_LABELS, PROMPT_TEMPLATE, RECRUITMENT_STEPS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { Market } from '../markets/types';
import { accountOf } from '../partners/accounts';
import type { Partner, PartnerAccount, PartnerBook } from '../partners/types';
import { domainOf, sameCompany } from '../website';

export const OUTPUT_COLUMNS = ['Company', 'Website', 'Country', 'Vertical', 'Sub-vertical', 'Target customer type',
  'Partner type', 'Why it fits', 'Evidence and sources', 'Existing partnerships'] as const;

const MAX_EXAMPLES = 5;
const FIRST_EXAMPLE_STEP = RECRUITMENT_STEPS.indexOf('discovery_call');

const HOW_MARKET_BUYS_TEXT = {
  customer_first: COPY.HOW_BUYS_CUSTOMER_FIRST,
  capability_first: COPY.HOW_BUYS_CAPABILITY_FIRST,
  unknown: '',
} as const;

interface LeaveOutItem { company: string; website: string; reason: string }

const trim = (value: string) => value.trim();

function describe(company: string, website: string, reason = ''): string {
  const site = domainOf(website) ?? trim(website);
  return `- ${trim(company)}${site ? ` (${site})` : ''}${reason ? `: ${reason}` : ''}`;
}

function bullets(items: string[]): string {
  return items.map(trim).filter(Boolean).map((item) => `- ${item}`).join('\n');
}

const indent = (block: string) => (block ? block.replace(/^/gm, '  ') : '');

function howMarketBuys(market: Market): string {
  const { howMarketBuys: kind, howMarketBuysNote } = market.info;
  return [HOW_MARKET_BUYS_TEXT[kind], trim(howMarketBuysNote)].filter(Boolean).join('. ');
}

type Linked = { partner: Partner; account: PartnerAccount; hypothesisId: string | null };

/** The partners linked to this market, with their accounts, in book order. */
function linkedPartners(market: Market, book: PartnerBook): Linked[] {
  const linked: Linked[] = [];
  for (const link of book.marketLinks) {
    if (link.marketId !== market.info.marketId) continue;
    const partner = book.partners.find((p) => p.id === link.partnerId);
    const account = partner && accountOf(book, partner);
    if (partner && account) linked.push({ partner, account, hypothesisId: link.hypothesisId });
  }
  return linked;
}

/**
 * Every partner of the market's type, linked to any market or to none, plus any partner linked to this market, then
 * the market's Exclusions. A company is listed once; a reason (closed "no", or the exclusion's) is kept.
 */
function leaveOut(market: Market, book: PartnerBook): string {
  const items: LeaveOutItem[] = [];
  const add = (item: LeaveOutItem) => {
    const existing = items.find((other) => sameCompany(other, item));
    if (!existing) items.push(item);
    else if (!existing.reason) existing.reason = item.reason;
  };
  const { marketId, partnerType } = market.info;
  const linkedHere = new Set(book.marketLinks.filter((l) => l.marketId === marketId).map((l) => l.partnerId));
  for (const p of book.partners) {
    if (p.partnerType !== partnerType && !linkedHere.has(p.id)) continue;
    const a = accountOf(book, p);
    if (a) add({ company: a.company, website: a.website, reason: p.closed === 'no' ? trim(p.closedReason) : '' });
  }
  for (const e of market.exclusions) add({ company: e.company, website: e.website, reason: trim(e.reason) });
  return items.filter((item) => trim(item.company)).map((i) => describe(i.company, i.website, i.reason)).join('\n');
}

/** A partner is a fair example once it is past recruitment or has reached the discovery call. */
const reachedDiscovery = (p: Partner) =>
  p.stage !== 'recruitment' || (p.step !== null && RECRUITMENT_STEPS.indexOf(p.step) >= FIRST_EXAMPLE_STEP);

function examples(market: Market, book: PartnerBook, hypothesisId: string): string {
  const chosen = linkedPartners(market, book)
    .filter(({ partner: p, account: a, hypothesisId: h }) => h === hypothesisId && p.closed !== 'no' && reachedDiscovery(p) && trim(a.website) !== '')
    .slice(0, MAX_EXAMPLES);
  return chosen.map(({ account: a }) => describe(a.company, a.website)).join('\n');
}

const outputColumns = () =>
  `| ${OUTPUT_COLUMNS.join(' | ')} |\n|${OUTPUT_COLUMNS.map(() => '---').join('|')}|`;

/** Fills the template. A line whose placeholder is empty is dropped, with its label line or section heading. */
export function buildSearchPrompt(input: { market: Market; book: PartnerBook; companyName: string; hypothesisId: string | null }): string {
  const { market, book, companyName, hypothesisId } = input;
  const hypothesis = hypothesisId === null ? null : market.hypotheses.find((h) => h.id === hypothesisId);
  if (hypothesisId !== null && !hypothesis) throw new Error(`buildSearchPrompt: unknown hypothesis "${hypothesisId}"`);
  const { info } = market;

  const values: Record<string, string> = {
    companyName: trim(companyName),
    ourProduct: trim(info.ourProduct),
    ourTargetCustomers: trim(info.ourTargetCustomers),
    marketName: trim(info.marketName),
    partnerType: PARTNER_TYPE_LABELS[info.partnerType],
    whyPartnerRoute: trim(info.whyPartnerRoute),
    mustHaves: indent(bullets(info.mustHaves)),
    howMarketBuys: howMarketBuys(market),
    statement: trim(info.statement),
    leaveOut: leaveOut(market, book),
    outputColumns: outputColumns(),
    lookalike: hypothesis ? trim(hypothesis.lookalike) : '',
    theirSide: hypothesis ? trim(hypothesis.theirSide) : '',
    examples: hypothesis ? indent(examples(market, book, hypothesis.id)) : '',
  };
  const valueOf = (name: string) => (values[name] ?? '');
  const placeholder = /\{\{(\w+)\}\}/g;

  let template = hypothesis ? PROMPT_TEMPLATE.hypothesis : PROMPT_TEMPLATE.market;
  if (!values.leaveOut) template = template.replace(/## Leave out\n[\s\S]*?\{\{leaveOut\}\}\n\n/, '');

  const lines = template.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // A label line that ends with ":" and is followed by a lone placeholder line is a list label.
    const next = lines[i + 1];
    if (line.endsWith(':') && next && /^\{\{\w+\}\}$/.test(next.trim())) {
      const name = next.trim().slice(2, -2);
      if (!valueOf(name)) { i++; continue; }
    }
    const names = [...line.matchAll(placeholder)].map((m) => m[1]!);
    if (names.some((name) => !valueOf(name))) continue;
    out.push(line.replace(placeholder, (_, name: string) => valueOf(name)));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
