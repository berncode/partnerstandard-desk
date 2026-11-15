import { describe, expect, it } from 'vitest';
import { previewImport } from '../import/preview';
import { applyPartnerChanges } from '../partners/batch';
import type { PartnerChange } from '../partners/changes';
import type { PartnerBook } from '../partners/types';
import { aPartner, EARLIER, NOW, proposalItem, sampleBook, sampleMarket, stamp } from '../test-builders';
import type { ProposalInput, ProposedCompany } from './input';
import { companyItems, proposalRows, proposalTable, proposedValue, statusRows, tidyRows } from './rows';
import type { ProposalScene } from './rules';
import type { ProposalItem } from './types';

const scene = (book: PartnerBook = sampleBook()): ProposalScene => ({ book, market: sampleMarket(), archived: false });
function at() {
  let n = 0;
  return { proposalId: 'prp_1', proposedBy: 'Claude for Ruth', now: NOW, ids: () => `r_${++n}` };
}
const EXPIRES = '2026-11-27T10:00:00.000Z';
const P = { partnerId: 'p_abc123', expectedUpdatedAt: EARLIER };
const company = (over: Partial<ProposedCompany>): ProposedCompany => ({
  company: '', website: '', country: '', vertical: '', subVertical: '', partnerType: '', targetCustomerType: '', whyItFits: '',
  sourceDetail: '', ...over,
});
const values = (changes: PartnerChange[]) => changes.map((c) => {
  if (c.kind !== 'add' || c.entity !== 'proposalItem') throw new Error('expected an add of a proposalItem');
  return c.values;
});
const target = { accountId: 'a_abc123', partnerId: 'p_abc123', marketId: null, hypothesisId: null };
const common = { proposalId: 'prp_1', proposedBy: 'Claude for Ruth', status: 'waiting', proposedOn: NOW, expiresOn: EXPIRES };

describe('proposalRows', () => {
  it('writes one row per letter for 4C and one per company, with the words the screen shows', () => {
    const fourC: ProposalInput = {
      kind: 'fourC', ...P,
      letters: { commitment: { score: 2, evidence: 'A sponsor, no sellers yet' }, credibility: { score: 3, evidence: 'Ten customers named' } },
    };
    expect(values(proposalRows(fourC, scene(), at()))).toEqual([
      {
        id: 'r_1', ...common, kind: 'fourC', ...target, about: 'Acme GmbH', what: 'desk.credibility', proposed: '3', details: '',
        evidence: 'Ten customers named', targetUpdated: EARLIER,
      },
      {
        id: 'r_2', ...common, kind: 'fourC', ...target, about: 'Acme GmbH', what: 'desk.commitment', proposed: '2', details: '',
        evidence: 'A sponsor, no sellers yet', targetUpdated: EARLIER,
      },
    ]);

    const partners: ProposalInput = {
      kind: 'partners', marketId: 'm_abcdefghij', hypothesisId: 'h_1', reason: 'A web search for IT firms',
      companies: [
        company({ company: 'Delta IT', website: 'delta.at', country: 'Austria', whyItFits: 'Sells to clinics\nand labs', sourceDetail: 'Web search, Nov' }),
        company({ company: 'Epsilon', partnerType: 'VAR', targetCustomerType: 'SMB', vertical: 'IT', subVertical: 'Health' }),
      ],
    };
    const market = { accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: 'h_1' };
    expect(values(proposalRows(partners, scene(), at()))).toEqual([
      {
        id: 'r_1', ...common, kind: 'partners', ...market, about: 'Austria', what: 'company', proposed: 'Delta IT',
        details: 'Website: delta.at\nCountry: Austria\nWhy it fits: Sells to clinics\nand labs\nSource detail: Web search, Nov',
        evidence: 'A web search for IT firms', targetUpdated: null,
      },
      {
        id: 'r_2', ...common, kind: 'partners', ...market, about: 'Austria', what: 'company', proposed: 'Epsilon',
        details: 'Vertical: IT\nSub-vertical: Health\nTarget customer type: SMB\nPartner type: VAR',
        evidence: 'A web search for IT firms', targetUpdated: null,
      },
    ]);
  });

  it('writes one row for every other kind', () => {
    const one = (input: ProposalInput, book?: PartnerBook) => values(proposalRows(input, scene(book), at()));
    expect(one({ kind: 'stage', ...P, to: 'discovery_call', reason: 'They asked for a call' })).toEqual([{
      id: 'r_1', ...common, kind: 'stage', ...target, about: 'Acme GmbH', what: 'step', proposed: 'Discovery call', details: '',
      evidence: 'They asked for a call', targetUpdated: EARLIER,
    }]);
    const signedBook = sampleBook({ partners: [aPartner({ stage: 'onboarding', step: null, signedDate: '2026-01-10' })] });
    expect(one({ kind: 'stage', ...P, to: 'growth', reason: 'First deals' }, signedBook)[0]).toMatchObject({ what: 'stage', proposed: 'Growth' });
    expect(one({ kind: 'close', ...P, as: 'not_now', reason: 'Busy with a merger' })[0])
      .toMatchObject({ kind: 'close', what: 'closed', proposed: 'Not now', evidence: 'Busy with a merger' });
    expect(one({ kind: 'signed', ...P, signedDate: '2026-11-03', reason: 'Signed on Monday' })[0])
      .toMatchObject({ kind: 'signed', what: 'signedDate', proposed: '2026-11-03' });
    expect(one({ kind: 'hypothesisStatus', marketId: 'm_abcdefghij', hypothesisId: 'h_1', expectedUpdatedAt: null, to: 'dropped', reason: 'No buyer' }))
      .toEqual([{
        id: 'r_1', ...common, kind: 'hypothesisStatus', accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: 'h_1',
        about: 'Mid-size IT firms', what: 'hypothesisStatus', proposed: 'Dropped', details: '', evidence: 'No buyer',
        targetUpdated: '2026-10-16T08:30:00.000Z',
      }]);
    expect(one({ kind: 'marketStatus', marketId: 'm_abcdefghij', expectedUpdatedAt: null, to: 'validated', note: 'Three calls\nback it', reason: 'Calls' }))
      .toEqual([{
        id: 'r_1', ...common, kind: 'marketStatus', accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: null,
        about: 'Austria', what: 'marketStatus', proposed: 'Validated', details: 'Status note: Three calls\nback it', evidence: 'Calls',
        targetUpdated: '2026-10-20T09:00:00.000Z',
      }]);
  });

  it('gives rows the Proposals tab accepts', () => {
    const input: ProposalInput = { kind: 'fourC', ...P, letters: { credibility: { score: 3, evidence: 'x' }, capability: { score: 2, evidence: 'y' } } };
    const out = applyPartnerChanges(sampleBook(), proposalRows(input, scene(), at()), stamp({ actor: 'Claude for Ruth' }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.proposalItems.map((i) => [i.what, i.status])).toEqual([['desk.credibility', 'waiting'], ['desk.capability', 'waiting']]);
  });
});

describe('proposedValue', () => {
  const item = (over: Partial<ProposalItem>) => proposalItem(over);

  it('reads back every kind\'s Proposed words', () => {
    expect(proposedValue(item({ what: 'desk.capability', proposed: '2' }))).toEqual({ field: 'desk', letter: 'capability', score: 2 });
    expect(proposedValue(item({ kind: 'stage', what: 'step', proposed: 'Discovery call' }))).toEqual({ field: 'step', to: 'discovery_call' });
    expect(proposedValue(item({ kind: 'stage', what: 'stage', proposed: 'Expansion' }))).toEqual({ field: 'stage', to: 'expansion' });
    expect(proposedValue(item({ kind: 'close', what: 'closed', proposed: 'Not now' }))).toEqual({ field: 'closed', as: 'not_now' });
    expect(proposedValue(item({ kind: 'signed', what: 'signedDate', proposed: '2026-11-03' }))).toEqual({ field: 'signedDate', date: '2026-11-03' });
    expect(proposedValue(item({ kind: 'hypothesisStatus', what: 'hypothesisStatus', proposed: 'Holds' }))).toEqual({ field: 'hypothesisStatus', to: 'holds' });
    expect(proposedValue(item({ kind: 'marketStatus', what: 'marketStatus', proposed: 'Partly validated', details: 'Status note: Two calls\nand a demo' })))
      .toEqual({ field: 'marketStatus', to: 'partly_validated', note: 'Two calls\nand a demo' });
    expect(proposedValue(item({ kind: 'marketStatus', what: 'marketStatus', proposed: 'Open', details: '' }))).toEqual({ field: 'marketStatus', to: 'open', note: '' });
    expect(proposedValue(item({
      kind: 'partners', what: 'company', proposed: 'Delta IT', details: 'Website: delta.at\nWhy it fits: Sells to clinics\nand labs\nSource detail: Web',
    }))).toEqual({
      field: 'company', company: {
        company: 'Delta IT', website: 'delta.at', country: '', vertical: '', subVertical: '', partnerType: '', targetCustomerType: '',
        whyItFits: 'Sells to clinics\nand labs', sourceDetail: 'Web',
      },
    });
  });

  it('reads a company\'s Details by the eight labels only: a "Web:" line in Why it fits stays in Why it fits', () => {
    expect(proposedValue(item({
      kind: 'partners', what: 'company', proposed: 'Delta IT', details: 'Website: delta.at\nWhy it fits: Sells to clinics\nWeb: strong shop\nURL: none',
    }))).toMatchObject({ field: 'company', company: { website: 'delta.at', whyItFits: 'Sells to clinics\nWeb: strong shop\nURL: none' } });
    // The labels are read ignoring case, spaces and punctuation, as every reader here.
    expect(proposedValue(item({ kind: 'partners', what: 'company', proposed: 'Delta IT', details: 'website: delta.at\nsub vertical: Labs' })))
      .toMatchObject({ company: { website: 'delta.at', subVertical: 'Labs' } });
  });

  it('reads words typed by hand, and gives null for words it can\'t read', () => {
    expect(proposedValue(item({ kind: 'stage', what: 'step', proposed: ' discovery CALL ' }))).toEqual({ field: 'step', to: 'discovery_call' });
    expect(proposedValue(item({ kind: 'stage', what: 'step', proposed: 'Growth' }))).toBeNull();
    expect(proposedValue(item({ kind: 'stage', what: 'stage', proposed: 'Recruitment' }))).toBeNull();
    expect(proposedValue(item({ what: 'desk.capability', proposed: '4' }))).toBeNull();
    expect(proposedValue(item({ what: 'desk.capability', proposed: '' }))).toBeNull();
    expect(proposedValue(item({ kind: 'close', what: 'closed', proposed: 'Later' }))).toBeNull();
    expect(proposedValue(item({ kind: 'signed', what: 'signedDate', proposed: '3 Nov' }))).toBeNull();
    expect(proposedValue(item({ kind: 'partners', what: 'company', proposed: ' ' }))).toBeNull();
  });
});

describe('proposalTable', () => {
  const rowsOf = (companies: ProposedCompany[]) => values(proposalRows(
    { kind: 'partners', marketId: 'm_abcdefghij', hypothesisId: null, reason: 'Search', companies }, scene(), at(),
  )).map((v) => proposalItem(v as Partial<ProposalItem>));

  it('gives a new partners proposal as the import preview\'s table, one row per company', () => {
    const items = rowsOf([company({ company: 'Delta IT', website: 'delta.at', sourceDetail: 'Web search, Nov' }), company({ company: 'Acme GmbH' })]);
    const table = proposalTable(items);
    expect(table.headers).toEqual(['Company', 'Website', 'Country', 'Vertical', 'Sub-vertical', 'Target customer type', 'Partner type', 'Why it fits', 'Source detail']);
    expect(table.rows).toEqual([
      ['Delta IT', 'delta.at', '', '', '', '', '', '', 'Web search, Nov'],
      ['Acme GmbH', '', '', '', '', '', '', '', ''],
    ]);
    const { rows } = previewImport({ book: sampleBook(), market: sampleMarket(), table });
    expect(rows.map((r) => [r.values.Company, r.sourceDetail, r.duplicate?.kind ?? null])).toEqual([
      ['Delta IT', 'Web search, Nov', null], ['Acme GmbH', null, 'linked'],
    ]);
  });

  it('leaves out an item it can\'t read, and companyItems names the item behind each row', () => {
    const items = [...rowsOf([company({ company: 'Delta IT' })]), proposalItem({ kind: 'partners', what: 'company', proposed: '' })];
    expect(proposalTable(items).rows).toHaveLength(1);
    expect(companyItems(items).map((i) => i.proposed)).toEqual(['Delta IT']);
  });
});

describe('statusRows', () => {
  it('sets each row\'s status and answer, against the row as it was read', () => {
    const items = [proposalItem({ id: 'r_1' }), proposalItem({ id: 'r_2', updatedAt: '2026-10-02T09:00:00.000Z' })];
    expect(statusRows(items, 'rejected', NOW, 'Not this year')).toEqual([
      { kind: 'update', entity: 'proposalItem', id: 'r_1', patch: { status: 'rejected', answeredOn: NOW, answerNote: 'Not this year' }, expectedUpdatedAt: EARLIER },
      {
        kind: 'update', entity: 'proposalItem', id: 'r_2', patch: { status: 'rejected', answeredOn: NOW, answerNote: 'Not this year' },
        expectedUpdatedAt: '2026-10-02T09:00:00.000Z',
      },
    ]);
    expect(statusRows(items.slice(0, 1), 'accepted', NOW)).toEqual([
      { kind: 'update', entity: 'proposalItem', id: 'r_1', patch: { status: 'accepted', answeredOn: NOW }, expectedUpdatedAt: EARLIER },
    ]);
  });
});

describe('tidyRows', () => {
  it('marks a Waiting row the index doesn\'t know Not sent, and one past Expires on Expired', () => {
    const items = [
      proposalItem({ id: 'r_orphan', proposalId: 'prp_orphan', expiresOn: '2026-11-20T00:00:00.000Z' }),
      proposalItem({ id: 'r_old', proposalId: 'prp_old', expiresOn: '2026-10-27T09:00:00.000Z' }),
      proposalItem({ id: 'r_fine', proposalId: 'prp_fine', expiresOn: '2026-11-20T00:00:00.000Z' }),
      proposalItem({ id: 'r_done', proposalId: 'prp_orphan2', status: 'accepted', answeredOn: EARLIER }),
      proposalItem({ id: 'r_repl', proposalId: 'prp_repl', expiresOn: '2026-11-20T00:00:00.000Z' }),
      proposalItem({ id: 'r_with', proposalId: 'prp_with', expiresOn: '2026-11-20T00:00:00.000Z' }),
    ];
    const index = {
      waiting: new Set(['prp_old', 'prp_fine']), known: new Set(['prp_old', 'prp_fine', 'prp_repl', 'prp_with']),
      marked: new Map([['prp_repl', 'replaced' as const], ['prp_with', 'withdrawn' as const]]),
    };
    const update = (id: string, patch: Record<string, unknown>) => ({ kind: 'update', entity: 'proposalItem', id, patch, expectedUpdatedAt: EARLIER });
    expect(tidyRows(items, index, NOW)).toEqual([
      update('r_orphan', { status: 'not_sent' }),
      update('r_old', { status: 'expired', answeredOn: '2026-10-27T09:00:00.000Z' }),
      update('r_repl', { status: 'replaced', answeredOn: NOW }),
      update('r_with', { status: 'withdrawn', answeredOn: NOW }),
    ]);
  });

  it('marks a row past Expires on Expired even when the index no longer knows it', () => {
    const items = [proposalItem({ id: 'r_old', proposalId: 'prp_pruned', expiresOn: '2026-07-01T00:00:00.000Z' })];
    expect(tidyRows(items, { waiting: new Set(), known: new Set() }, NOW)).toEqual([
      { kind: 'update', entity: 'proposalItem', id: 'r_old', patch: { status: 'expired', answeredOn: '2026-07-01T00:00:00.000Z' }, expectedUpdatedAt: EARLIER },
    ]);
  });
});
