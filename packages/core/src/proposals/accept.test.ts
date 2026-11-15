import { describe, expect, it } from 'vitest';
import { applyPartnerChanges } from '../partners/batch';
import type { Partner, PartnerBook } from '../partners/types';
import { aPartner, EARLIER, NOW, proposalItem, qualification, sampleBook, stamp } from '../test-builders';
import { acceptChange, mergeNote, overallStatus } from './accept';
import type { ProposalItem } from './types';
import { proposalViews, type ProposalHead, type ProposalView } from './view';

const head = (over: Partial<ProposalHead> = {}): ProposalHead => ({
  id: 'prp_abc123', kind: 'fourC', status: 'waiting', createdAt: EARLIER, answeredAt: null, expiresAt: '2026-10-31T09:00:00.000Z',
  agentName: 'Claude', makerOn: true, ...over,
});
const viewOf = (book: PartnerBook, kind: ProposalHead['kind'] = 'fourC'): ProposalView => {
  const [view] = proposalViews([head({ kind })], { book, markets: {} }, NOW);
  if (!view) throw new Error('no view');
  return view;
};
const LETTERS = [
  ['customerBase', '2', 'About a third of their customers fit'], ['credibility', '3', 'Ten customers named on their site'],
  ['capability', '2', 'They sell on yearly terms'], ['commitment', '2', 'A sponsor, no sellers yet'],
] as const;
const letterItems = () => LETTERS.map(([c, score, evidence], i) =>
  proposalItem({ id: `r_${i}`, what: `desk.${c}` as ProposalItem['what'], proposed: score, evidence }));
const withNotes = (notes: Partial<Record<(typeof LETTERS)[number][0], string>>, partner: Partial<Partner> = {}) => sampleBook({
  partners: [aPartner(partner)], proposalItems: letterItems(),
  qualifications: [qualification({ deskNotes: { customerBase: '', credibility: '', capability: '', commitment: '', ...notes } })],
});

describe('mergeNote', () => {
  it('gives the evidence to an empty note, and puts it on a new line below the person\'s words', () => {
    expect(mergeNote('', 'Ten customers')).toBe('Ten customers');
    expect(mergeNote('  ', 'Ten customers')).toBe('Ten customers');
    expect(mergeNote('Saw their site', 'Ten customers')).toBe('Saw their site\nTen customers');
  });
});

describe('acceptChange', () => {
  it('acceptChange for two of four letters sets two desk scores and puts the evidence below the person\'s note', () => {
    const book = withNotes({ credibility: 'Saw their site' });
    const out = acceptChange(viewOf(book), book, { letters: ['credibility', 'commitment'] }, EARLIER);
    expect(out).toEqual({
      change: { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { desk: { credibility: 3, commitment: 2 } }, expectedUpdatedAt: EARLIER },
      with: [{
        kind: 'update', entity: 'qualification', id: 'q_abc123', expectedUpdatedAt: EARLIER,
        patch: { deskNotes: { credibility: 'Saw their site\nTen customers named on their site', commitment: 'A sponsor, no sellers yet' } },
      }],
    });
    if (!('change' in out)) throw new Error('refused');
    const applied = applyPartnerChanges(book, [out.change, ...out.with], stamp({ actor: 'Ruth, proposed by Claude' }));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.partners[0]!.desk).toEqual({ customerBase: null, credibility: 3, capability: 3, commitment: 2 });
    expect(applied.value.qualifications[0]!.deskNotes).toEqual({
      customerBase: '', credibility: 'Saw their site\nTen customers named on their site', capability: '', commitment: 'A sponsor, no sellers yet',
    });
  });

  it('takes every letter when none is picked, and adds the Qualification row when there is none', () => {
    const book = sampleBook({ partners: [aPartner()], proposalItems: letterItems(), qualifications: [] });
    const out = acceptChange(viewOf(book), book, {}, '2026-10-20T09:00:00.000Z');
    expect(out).toEqual({
      change: {
        kind: 'update', entity: 'partner', id: 'p_abc123', expectedUpdatedAt: '2026-10-20T09:00:00.000Z',
        patch: { desk: { customerBase: 2, credibility: 3, capability: 2, commitment: 2 } },
      },
      with: [{
        kind: 'add', entity: 'qualification',
        values: { partnerId: 'p_abc123', deskNotes: Object.fromEntries(LETTERS.map(([c, , evidence]) => [c, evidence])) },
      }],
    });
  });

  it('refuses letters the proposal doesn\'t have', () => {
    const book = withNotes({});
    const items = letterItems().slice(0, 1);
    const one = { ...book, proposalItems: items };
    expect(acceptChange(viewOf(one), one, { letters: ['commitment'] }, EARLIER)).toEqual({ ok: false, message: 'Please fix the highlighted fields' });
  });

  it('moves the step or the stage', () => {
    const step = sampleBook({ proposalItems: [proposalItem({ kind: 'stage', what: 'step', proposed: 'Discovery call', evidence: 'r' })] });
    expect(acceptChange(viewOf(step, 'stage'), step, {}, EARLIER)).toEqual({ change: { kind: 'setStep', partnerId: 'p_abc123', to: 'discovery_call' }, with: [] });
    const stage = sampleBook({
      partners: [aPartner({ stage: 'onboarding', step: null, signedDate: '2026-01-10' })],
      proposalItems: [proposalItem({ kind: 'stage', what: 'stage', proposed: 'Growth', evidence: 'r' })],
    });
    expect(acceptChange(viewOf(stage, 'stage'), stage, {}, EARLIER)).toEqual({ change: { kind: 'setStage', partnerId: 'p_abc123', to: 'growth' }, with: [] });
  });

  it('closes and signs with the person\'s dialog values, else the proposal\'s', () => {
    const close = sampleBook({ proposalItems: [proposalItem({ kind: 'close', what: 'closed', proposed: 'No', evidence: 'No overlap' })] });
    expect(acceptChange(viewOf(close, 'close'), close, {}, EARLIER))
      .toEqual({ change: { kind: 'close', partnerId: 'p_abc123', as: 'no', reason: 'No overlap' }, with: [] });
    expect(acceptChange(viewOf(close, 'close'), close, { as: 'not_now', reason: 'Ask again in spring' }, EARLIER))
      .toEqual({ change: { kind: 'close', partnerId: 'p_abc123', as: 'not_now', reason: 'Ask again in spring' }, with: [] });
    const signed = sampleBook({ proposalItems: [proposalItem({ kind: 'signed', what: 'signedDate', proposed: '2026-11-03', evidence: 'r' })] });
    expect(acceptChange(viewOf(signed, 'signed'), signed, {}, EARLIER))
      .toEqual({ change: { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-11-03' }, with: [] });
    expect(acceptChange(viewOf(signed, 'signed'), signed, { signedDate: '2026-11-02' }, EARLIER))
      .toEqual({ change: { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-11-02' }, with: [] });
  });

  it('refuses a proposal that can\'t apply any more with the rule\'s message', () => {
    const book = sampleBook({ partners: [], proposalItems: [proposalItem({ kind: 'stage', what: 'step', proposed: 'Discovery call', evidence: 'r' })] });
    expect(acceptChange(viewOf(book, 'stage'), book, {}, EARLIER)).toEqual({ ok: false, message: 'This item no longer exists' });
    const late = sampleBook({ proposalItems: letterItems() });
    const [expired] = proposalViews([head()], { book: late, markets: {} }, '2026-11-02T00:00:00.000Z');
    expect(acceptChange(expired!, late, {}, EARLIER)).toEqual({ ok: false, message: 'Expired: not answered within 30 days.' });
  });
});

describe('overallStatus', () => {
  it('is accepted, partly accepted or rejected', () => {
    expect(overallStatus(4, 4)).toBe('accepted');
    expect(overallStatus(2, 4)).toBe('partly_accepted');
    expect(overallStatus(0, 4)).toBe('rejected');
    expect(overallStatus(1, 1)).toBe('accepted');
  });
});
