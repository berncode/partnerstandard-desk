import { WORD, benefitNames, levelNames } from './catalog';
import { costCheck, formatMoney, num } from './calculate';
import { prefRequirements, rateLine } from './sheet';
import type { CompanyFacts, Program, Level } from './types';

export type PublicBlock = { h1: string } | { h2: string } | { p: string } | { ul: string[] };

export const OUTPUT_NOTE = (when: string): string =>
  `Made by PartnerStandard Desk from your answers. Last updated ${when}. Changes here are overwritten; change the answers in the tool.`;

/** Rewards as the end of "We reward you with …": a sentence's capital first letter lowered, other capitals kept. */
const rewardsText = (rewards: string): string => {
  const text = rewards.trim().replace(/[.\s]+$/, '');
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
};

export function publicBlocks(c: CompanyFacts, p: Program): PublicBlock[] {
  const rules = c.rules, m = p.money;
  const names = levelNames(p);
  const pay = (t: Level): string => rateLine(c, p, t);
  const rewards = rewardsText(m.rewards);
  const earnLine = m.model === 'none'
    ? (rewards ? `We reward you with ${rewards}.` : '')
    : m.model === 'fee' ? `You earn ${formatMoney(num(m.fee.reg), c.currency)} for every new customer.` : `You earn ${rateLine(c, p, 'reg')}.`;
  const ul = (items: string[]): PublicBlock[] => (items.length ? [{ ul: items }] : []);

  const out: PublicBlock[] = [{ h1: `The ${p.name}` }];
  if (p.description) out.push({ p: p.description });
  const why = p.why.filter((x) => x.trim());
  if (why.length) out.push({ h2: 'Why partners join' }, { ul: why });
  if (p.ipp) out.push({ h2: 'Who it is for' }, { p: p.ipp });
  const regBenefits = benefitNames(p, p.reg);
  if (regBenefits.length) out.push({ h2: `What ${names.reg} partners get` }, { ul: regBenefits });
  if (p.prefOn) {
    const higher = m.model !== 'none' && costCheck(c, p).moneyUp ? [`Higher ${WORD[m.model] || 'pay'}: ${pay('pref')}`] : [];
    out.push(
      { h2: `Grow into a ${names.pref} partner` },
      // "Everything above" only when the Registered benefits are listed above.
      { p: regBenefits.length ? `${names.pref} partners get everything above, plus:` : `${names.pref} partners get:` },
      ...ul([...higher, ...benefitNames(p, p.pref.filter((k) => !p.reg.includes(k)))]),
      { p: 'What it takes, checked every year:' },
      ...ul(prefRequirements(p)),
    );
  }
  const earn = earnLine + (p.prefOn && m.model !== 'none' ? ` As a ${names.pref} partner: ${pay('pref')}.` : '');
  if (earn) out.push({ h2: 'What you earn' }, { p: earn });
  if (m.model !== 'none') {
    out.push({ h2: 'Your deals are protected' }, { p: `Register a deal and it is yours for ${num(rules.protect)} days, with one ${num(rules.extend)}-day extension while you are working on it. We answer within ${num(rules.answer)} hours.${rules.paidInFull ? ' If our own team closes a deal you registered, you are still paid in full.' : ''}` });
  }
  out.push({ h2: 'Become a partner' }, { p: 'Apply on this page and we will be in touch within a week.' });
  return out;
}

export function publicPlain(blocks: PublicBlock[]): string {
  return blocks
    .map((b) => ('h1' in b ? `# ${b.h1}` : 'h2' in b ? `\n## ${b.h2}` : 'ul' in b ? b.ul.map((x) => `- ${x}`).join('\n') : b.p))
    .join('\n');
}
