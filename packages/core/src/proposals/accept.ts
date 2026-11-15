// What accepting a partner kind writes (agent proposals design, spec 10.3): the same change a person makes, with the
// 4C evidence put into the desk notes below what the person wrote.
import { FOUR_C, type FourC } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { RuleResult } from '../partners/lifecycle';
import type { PartnerChange } from '../partners/changes';
import type { ClosedAs, IsoDate, IsoDateTime, PartnerBook, Score } from '../partners/types';
import { proposedValue, type ProposedValue } from './rows';
import type { ProposalView } from './view';

/** What the person chose: the 4C letters to accept (all when not given), and the close or sign dialog's values. */
export type AcceptPick = { letters?: FourC[]; signedDate?: IsoDate; as?: ClosedAs; reason?: string };

const refuse = (message: string): RuleResult => ({ ok: false, message });

/** A desk note with the evidence: an empty note gets the evidence; one the person wrote keeps its words, the evidence below. */
export function mergeNote(current: string, evidence: string): string {
  return current.trim() === '' ? evidence : `${current}\n${evidence}`;
}

/**
 * The change that accepts a 4C, stage, close or signed proposal, and the changes that go with it in the same write
 * (the desk notes). `expectedUpdatedAt` is the partner row's as the person saw it, so a change since is a conflict.
 * The proposal's own rows are not here: the command adds their statuses. A proposal that can't apply, expired or was
 * answered is refused with its message.
 */
export function acceptChange(
  view: ProposalView, book: PartnerBook, pick: AcceptPick, expectedUpdatedAt: IsoDateTime | null,
): { change: PartnerChange; with: PartnerChange[] } | RuleResult {
  if (view.state === 'cannot') return refuse(view.cannot ?? COPY.GONE);
  if (view.state === 'expired') return refuse(COPY.PROPOSAL_EXPIRED);
  if (view.state === 'answered') return refuse(COPY.CONFLICT);
  const partnerId = view.target.partnerId;
  const items = view.rows.map((row) => book.proposalItems.find((i) => i.id === row.itemId));
  if (partnerId === null || items.some((i) => i === undefined)) return refuse(COPY.GONE);
  const values = items.map((i) => proposedValue(i!));
  if (values.some((v) => v === null)) return refuse(COPY.GONE);
  const only: ProposedValue | null = values.length === 1 ? values[0]! : null;

  switch (view.head.kind) {
    case 'fourC': {
      const proposed = new Map<FourC, { score: Score; evidence: string }>();
      values.forEach((v, i) => { if (v?.field === 'desk') proposed.set(v.letter, { score: v.score, evidence: items[i]!.evidence }); });
      const picked = FOUR_C.filter((c) => (pick.letters ?? [...proposed.keys()]).includes(c));
      if (picked.length === 0 || (pick.letters ?? []).some((c) => !proposed.has(c))) return refuse(COPY.FIX_FIELDS);
      const desk = Object.fromEntries(picked.map((c) => [c, proposed.get(c)!.score]));
      const qualification = book.qualifications.find((q) => q.partnerId === partnerId);
      const deskNotes = Object.fromEntries(picked.map((c) => [c, mergeNote(qualification?.deskNotes[c] ?? '', proposed.get(c)!.evidence)]));
      const note: PartnerChange = qualification
        ? { kind: 'update', entity: 'qualification', id: qualification.id, patch: { deskNotes }, expectedUpdatedAt: qualification.updatedAt }
        : { kind: 'add', entity: 'qualification', values: { partnerId, deskNotes } };
      return { change: { kind: 'update', entity: 'partner', id: partnerId, patch: { desk }, expectedUpdatedAt }, with: [note] };
    }
    case 'stage':
      if (only?.field === 'step') return { change: { kind: 'setStep', partnerId, to: only.to }, with: [] };
      if (only?.field === 'stage') return { change: { kind: 'setStage', partnerId, to: only.to }, with: [] };
      return refuse(COPY.GONE);
    case 'close':
      return only?.field === 'closed'
        ? { change: { kind: 'close', partnerId, as: pick.as ?? only.as, reason: pick.reason ?? view.reason }, with: [] }
        : refuse(COPY.GONE);
    case 'signed':
      return only?.field === 'signedDate'
        ? { change: { kind: 'markSigned', partnerId, signedDate: pick.signedDate ?? only.date }, with: [] }
        : refuse(COPY.GONE);
    case 'partners': case 'hypothesisStatus': case 'marketStatus':
      // Not a change of a partner type: new partners go through the import preview, a status through the market.
      return refuse(COPY.GONE);
  }
}

/** The whole proposal's status once the person answered: every item accepted, some, or none. */
export function overallStatus(accepted: number, total: number): 'accepted' | 'partly_accepted' | 'rejected' {
  if (accepted <= 0) return 'rejected';
  return accepted >= total ? 'accepted' : 'partly_accepted';
}
