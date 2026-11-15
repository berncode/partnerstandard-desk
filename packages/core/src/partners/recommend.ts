// The labels come from the method package.
import { FOUR_C, FOUR_C_LABELS, type FourC } from '@partner-desk/method';
import type { Scores } from './types';

export type Recommendation = {
  kind: 'skip' | 'call' | 'stop' | 'proceed' | 'not_now';
  /** The Cs scored 0. */
  failing: FourC[];
  /** The Cs scored 1. */
  low: FourC[];
  text: string;
};

const scoredAt = (s: Scores, score: number) => FOUR_C.filter((c) => s[c] === score);
const labels = (cs: FourC[]) => cs.map((c) => FOUR_C_LABELS[c]);

/** "Credibility fails", "Customer base and Commitment fail". */
function fails(cs: FourC[]): string {
  const names = labels(cs);
  if (names.length === 1) return `${names[0]} fails`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} fail`;
}

/** The desk check: empty scores are allowed; nothing scored gives no recommendation. */
export function deskRecommendation(s: Scores): Recommendation | null {
  if (FOUR_C.every((c) => s[c] === null)) return null;
  const failing = scoredAt(s, 0);
  const low = scoredAt(s, 1);
  if (failing.length > 0) return { kind: 'skip', failing, low, text: `Skip: ${fails(failing)}` };
  return { kind: 'call', failing, low, text: 'Worth a discovery call' };
}

/** The confirmed check: all four Cs must be scored for a recommendation. */
export function confirmedRecommendation(s: Scores): Recommendation | null {
  if (FOUR_C.some((c) => s[c] === null)) return null;
  const failing = scoredAt(s, 0);
  const low = scoredAt(s, 1);
  if (failing.length > 0) return { kind: 'stop', failing, low, text: `Stop: ${fails(failing)}` };
  if (low.length === 0) return { kind: 'proceed', failing, low, text: 'Proceed' };
  return { kind: 'not_now', failing, low, text: `Not now, or follow up to fill the gaps: ${labels(low).join(', ')}` };
}
