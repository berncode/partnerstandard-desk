import { applyPartnerChanges, proposalViews, type PartnerBook, type PartnerChange, type ProposalHead, type ProposalItem } from '@partner-desk/core';
import { aPartner, EARLIER, NOW, proposalItem, qualification, sampleBook } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { describe, expect, it } from 'vitest';
import {
  acceptChanges, acceptInput, cardsFor, cardTitle, closeValues, expiresOn, letterOf, madeWhen, rejectChanges, signedValues, stepAdvice,
} from './proposal-model';

const head = (over: Partial<ProposalHead> = {}): ProposalHead => ({
  id: 'prp_abc123', kind: 'fourC', status: 'waiting', createdAt: EARLIER, answeredAt: null, expiresAt: '2026-10-31T09:00:00.000Z',
  agentName: 'Claude', makerOn: true, ...over,
});
const letter = (what: ProposalItem['what'], proposed: string, id: string) => proposalItem({ id, what, proposed, evidence: `Evidence ${id}` });
const FOUR = [letter('desk.customerBase', '3', 'r_1'), letter('desk.credibility', '2', 'r_2'), letter('desk.capability', '1', 'r_3'), letter('desk.commitment', '0', 'r_4')];
const viewOf = (book: PartnerBook, h: ProposalHead = head()) => proposalViews([h], { book, markets: {} }, NOW)[0]!;
const stamp = { now: NOW, actor: 'Anna' };

describe('the card’s words', () => {
  it('says who proposes, and "(turned off)" for an agent turned off since', () => {
    expect(cardTitle(head())).toBe('Desk Agent proposes');
    expect(cardTitle(head({ makerOn: false }))).toBe('Desk Agent (turned off) proposes');
  });

  it('counts when it was made in the owner’s days, and the expiry is the owner’s date', () => {
    // 23:30 in Berlin on 27 October is the 28th in Auckland.
    expect(madeWhen('2026-10-28T08:00:00.000Z', NOW, 'Europe/Berlin')).toBe('today');
    expect(madeWhen('2026-10-27T22:30:00.000Z', NOW, 'Europe/Berlin')).toBe('yesterday');
    expect(madeWhen('2026-10-27T22:30:00.000Z', NOW, 'Pacific/Auckland')).toBe('today');
    expect(madeWhen('2026-10-26T09:00:00.000Z', NOW, 'Europe/Berlin')).toBe('2 days ago');
    expect(expiresOn('2026-11-27T23:30:00.000Z', 'Europe/Berlin')).toBe('Expires on 28 Nov 2026');
    expect(expiresOn('2026-11-27T23:30:00.000Z', 'America/New_York')).toBe('Expires on 27 Nov 2026');
  });
});

describe('where a card shows', () => {
  it('a 4C proposal beside the desk check; a step, stage, close or signed proposal under the stepper; only the open partner type’s', () => {
    const items = [
      proposalItem({ id: 'r_1', proposalId: 'prp_4c' }),
      proposalItem({ id: 'r_2', proposalId: 'prp_step', kind: 'stage', what: 'step', proposed: 'Discovery call' }),
      proposalItem({ id: 'r_3', proposalId: 'prp_close', kind: 'close', what: 'closed', proposed: 'Not now', evidence: 'No budget' }),
      proposalItem({ id: 'r_4', proposalId: 'prp_other', partnerId: 'p_other' }),
    ];
    const heads = [head({ id: 'prp_4c' }), head({ id: 'prp_step', kind: 'stage' }), head({ id: 'prp_close', kind: 'close' }), head({ id: 'prp_other' })];
    const views = proposalViews(heads, { book: sampleBook({ proposalItems: items }), markets: {} }, NOW);
    expect(cardsFor(views, 'p_abc123', 'desk').map((v) => v.head.id)).toEqual(['prp_4c']);
    expect(cardsFor(views, 'p_abc123', 'stepper').map((v) => v.head.id).sort()).toEqual(['prp_close', 'prp_step']);
  });
});

describe('accepting on the page', () => {
  it('a 4C accept sets the picked scores with the updatedAt the card showed, the evidence in the notes, and each row’s answer', () => {
    const book = sampleBook({ partners: [aPartner({ updatedAt: '2026-10-20T09:00:00.000Z' })], qualifications: [qualification()], proposalItems: FOUR });
    const view = viewOf(book);
    expect(view.state).toBe('changed');
    const built = acceptChanges(view, book, { letters: ['customerBase', 'capability'], note: 'Too early' }, NOW);
    if (!built.ok) throw new Error(built.message);
    expect(built.changes[0]).toEqual({
      kind: 'update', entity: 'partner', id: 'p_abc123', patch: { desk: { customerBase: 3, capability: 1 } }, expectedUpdatedAt: '2026-10-20T09:00:00.000Z',
    });
    expect(built.changes[1]).toMatchObject({ kind: 'update', entity: 'qualification' });
    expect(built.changes.slice(2)).toEqual([
      { kind: 'update', entity: 'proposalItem', id: 'r_1', expectedUpdatedAt: EARLIER, patch: { status: 'accepted', answeredOn: NOW } },
      { kind: 'update', entity: 'proposalItem', id: 'r_3', expectedUpdatedAt: EARLIER, patch: { status: 'accepted', answeredOn: NOW } },
      { kind: 'update', entity: 'proposalItem', id: 'r_2', expectedUpdatedAt: EARLIER, patch: { status: 'rejected', answeredOn: NOW, answerNote: 'Too early' } },
      { kind: 'update', entity: 'proposalItem', id: 'r_4', expectedUpdatedAt: EARLIER, patch: { status: 'rejected', answeredOn: NOW, answerNote: 'Too early' } },
    ]);
    expect(acceptInput(view, { letters: ['customerBase', 'capability'], note: 'Too early' })).toEqual({
      proposalId: 'prp_abc123', expectedUpdatedAt: '2026-10-20T09:00:00.000Z', letters: ['customerBase', 'capability'], note: 'Too early',
    });
    // Accepted on screen at once: the card turns into its one line.
    const after = applyAll(book, built.changes);
    expect(viewOf(after)).toMatchObject({ state: 'answered', answeredLine: 'Accepted 2 of 4' });
  });

  it('a target that holds the proposal already only answers the rows; one that can’t apply is refused with its message', () => {
    const book = sampleBook({ partners: [aPartner({ step: 'discovery_call' })], proposalItems: [
      proposalItem({ kind: 'stage', what: 'step', proposed: 'Discovery call' }),
    ] });
    const already = acceptChanges(viewOf(book, head({ kind: 'stage' })), book, {}, NOW);
    expect(already.ok && already.changes.map((c) => c.kind === 'update' && c.entity)).toEqual(['proposalItem']);
    const closed = sampleBook({ partners: [aPartner({ closed: 'no', closedReason: 'No fit' })], proposalItems: book.proposalItems });
    expect(acceptChanges(viewOf(closed, head({ kind: 'stage' })), closed, {}, NOW)).toEqual({ ok: false, message: 'Reopen this partner before you move it.' });
  });

  it('a rejection answers every waiting row, with the note', () => {
    const book = sampleBook({ proposalItems: FOUR.slice(0, 2) });
    expect(rejectChanges(viewOf(book), book, ' Not this one ', NOW)).toEqual([
      { kind: 'update', entity: 'proposalItem', id: 'r_1', expectedUpdatedAt: EARLIER, patch: { status: 'rejected', answeredOn: NOW, answerNote: 'Not this one' } },
      { kind: 'update', entity: 'proposalItem', id: 'r_2', expectedUpdatedAt: EARLIER, patch: { status: 'rejected', answeredOn: NOW, answerNote: 'Not this one' } },
    ]);
    expect(rejectChanges(viewOf(book), book, '  ', NOW)[0]).toMatchObject({ patch: { status: 'rejected', answeredOn: NOW } });
    expect(rejectChanges(viewOf(book), book, '  ', NOW)[0]).not.toHaveProperty('patch.answerNote');
  });

  it('a row’s letter, and the values the close and sign dialogs open with', () => {
    const book = sampleBook({ proposalItems: [
      ...FOUR,
      proposalItem({ id: 'r_c', proposalId: 'prp_close', kind: 'close', what: 'closed', proposed: 'No', evidence: 'They sell a rival' }),
      proposalItem({ id: 'r_s', proposalId: 'prp_sign', kind: 'signed', what: 'signedDate', proposed: '2026-10-11', evidence: 'Signed on Friday' }),
    ] });
    expect(letterOf(book, 'r_2')).toBe('credibility');
    expect(letterOf(book, 'r_c')).toBeNull();
    expect(closeValues(viewOf(book, head({ id: 'prp_close', kind: 'close' })), book)).toEqual({ as: 'no', reason: 'They sell a rival' });
    expect(signedValues(viewOf(book, head({ id: 'prp_sign', kind: 'signed' })), book)).toEqual({ signedDate: '2026-10-11' });
    expect(signedValues(viewOf(book), book)).toBeNull();
  });
});

describe('the stepper’s advice for a step proposal', () => {
  const into = (step: string, partner: Parameters<typeof aPartner>[0]) => {
    const book = sampleBook({ partners: [aPartner(partner)], marketLinks: [], proposalItems: [proposalItem({ kind: 'stage', what: 'step', proposed: step })] });
    return stepAdvice(viewOf(book, head({ kind: 'stage' })), book, book.partners[0]!, {});
  };

  it('into Qualification without a hypothesis that holds, and into MAP without the confirmed check: the stepper’s words', () => {
    expect(into('Qualification', { step: 'discovery_call' })).toEqual({ to: 'qualification', text: COPY.HYPOTHESIS_FIRST });
    expect(into('MAP', { step: 'qualification' })).toEqual({ to: 'map', text: COPY.CONFIRM_FIRST });
  });

  it('none for a step with nothing to finish, or a stage after signing', () => {
    expect(into('Discovery call', { step: 'researched' })).toBeNull();
    const signed = sampleBook({ partners: [aPartner({ stage: 'onboarding', step: null, signedDate: '2026-10-01' })], proposalItems: [
      proposalItem({ kind: 'stage', what: 'stage', proposed: 'Growth' }),
    ] });
    expect(stepAdvice(viewOf(signed, head({ kind: 'stage' })), signed, signed.partners[0]!, {})).toBeNull();
  });
});

function applyAll(book: PartnerBook, changes: PartnerChange[]): PartnerBook {
  const out = applyPartnerChanges(book, changes, stamp);
  if (!out.ok) throw new Error(out.message);
  return out.value;
}
