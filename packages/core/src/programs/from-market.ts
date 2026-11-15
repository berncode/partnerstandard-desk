import type { Market } from '../markets/types';
import { newProgram, type ProgramIds } from './new-program';
import type { CompanyFacts, Program, ProgramType } from './types';
import { MAX_LINE, MAX_LONG } from './validate';

/** At most this many of a market's confirmed value points become reasons to join. */
export const MAX_REASONS = 5;

/**
 * `text`, trimmed, in at most `max` characters: a longer text is cut at the last space in its final fifth (else
 * mid-word) and ends in "…". A market's texts can be far longer than a program's.
 */
export function clipText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(' ');
  if (space >= Math.floor(max * 0.8)) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/**
 * A fresh program started from a market (spec 4.3). Four answers come from the market: the ideal partner (the
 * first holding hypothesis's name, then "For example: {lookalike}." when it has one; empty when none holds), the ideal customer (our target customers), the reasons to join
 * (confirmed value points, in order, at most five) and the focus (the market's name), each clipped to what a program
 * holds (`clipText`). Everything else is the starting answers for the type. The caller checks that the market is for
 * this type.
 */
export function programFromMarket(type: ProgramType, facts: CompanyFacts, market: Market, ids: ProgramIds): Program {
  const p = newProgram(type, facts, ids);
  const holding = market.hypotheses.find((h) => h.status === 'holds');
  const lookalike = holding?.lookalike.trim();
  p.ipp = holding ? clipText(`${holding.name.trim()}${lookalike ? `. For example: ${lookalike}.` : ''}`, MAX_LONG) : '';
  p.icp = clipText(market.info.ourTargetCustomers, MAX_LONG);
  p.why = market.valuePoints.filter((v) => v.state === 'confirmed').map((v) => clipText(v.text, MAX_LINE)).filter(Boolean).slice(0, MAX_REASONS);
  p.focus = clipText(market.info.marketName, MAX_LINE);
  return p;
}
