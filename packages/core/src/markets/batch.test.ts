import { describe, expect, it } from 'vitest';
import { NOW, sampleMarket, stamp } from '../test-builders';
import { MAX_BATCH } from '../partners/batch';
import { applyMarketChanges, parseMarketChanges, remapMarketChange } from './batch';
import type { MarketChange } from './changes';

const pointAndHypothesis = (provisional: string, name: string): MarketChange[] => [
  { kind: 'add', entity: 'valuePoint', values: { id: provisional, text: name } },
  { kind: 'add', entity: 'hypothesis', values: { name, valuePointIds: [provisional] } },
];

/** A stamp whose new ids count up per call: `valuePoint_1`, `hypothesis_2`, ... */
function counting() {
  let n = 0;
  return stamp({ newId: (kind) => `${kind}_${++n}` });
}

describe('applyMarketChanges', () => {
  it('applies in order, gives each add a real id and makes later changes follow it', () => {
    const out = applyMarketChanges(sampleMarket(), [...pointAndHypothesis('tmp_a', 'Alpha'), ...pointAndHypothesis('tmp_b', 'Beta')], counting());
    if (!out.ok) throw new Error(out.message);
    expect(out.entityIds).toEqual(['valuePoint_1', 'hypothesis_2', 'valuePoint_3', 'hypothesis_4']);
    expect(out.value.hypotheses.slice(-2).map((h) => [h.id, h.valuePointIds, h.updatedAt, h.updatedBy])).toEqual([
      ['hypothesis_2', ['valuePoint_1'], NOW, 'Ruth'], ['hypothesis_4', ['valuePoint_3'], NOW, 'Ruth'],
    ]);
  });

  it('can keep the provisional ids (the editor\'s optimistic view)', () => {
    const out = applyMarketChanges(sampleMarket(), pointAndHypothesis('v_local1', 'Alpha'), stamp(), (_kind, provisional) => provisional);
    if (!out.ok) throw new Error(out.message);
    expect(out.value.hypotheses.at(-1)?.valuePointIds).toEqual(['v_local1']);
  });

  it('is all or nothing and says how many changes came before the refused one', () => {
    const before = sampleMarket();
    const changes: MarketChange[] = [
      ...pointAndHypothesis('tmp_a', 'Alpha'),
      { kind: 'add', entity: 'exclusion', values: { company: ' ' } },
      ...pointAndHypothesis('tmp_b', 'Beta'),
    ];
    expect(applyMarketChanges(before, changes, counting())).toMatchObject({ ok: false, error: 'invalid', valid: 2, fieldErrors: { company: expect.any(String) } });
    expect(before).toEqual(sampleMarket());
  });

  it('refuses a provisional id used twice or already taken by a row', () => {
    expect(applyMarketChanges(sampleMarket(), [...pointAndHypothesis('tmp_a', 'A'), ...pointAndHypothesis('tmp_a', 'B')], counting()))
      .toMatchObject({ ok: false, error: 'invalid', valid: 2 });
    expect(applyMarketChanges(sampleMarket(), pointAndHypothesis('v_1', 'A'), counting())).toMatchObject({ ok: false, error: 'invalid', valid: 0 });
  });
});

describe('parseMarketChanges', () => {
  it('accepts up to MAX_BATCH changes, with provisional ids on adds', () => {
    const changes = pointAndHypothesis('v_tmp001', 'Alpha');
    expect(parseMarketChanges(changes)).toEqual({ ok: true, changes });
    expect(parseMarketChanges(Array.from({ length: MAX_BATCH }, () => changes[0]))).toMatchObject({ ok: true });
  });

  it('refuses an empty or oversized batch, or one that is not a list', () => {
    expect(parseMarketChanges([])).toEqual({ ok: false });
    expect(parseMarketChanges(Array.from({ length: MAX_BATCH + 1 }, () => pointAndHypothesis('v_tmp001', 'A')[0]))).toEqual({ ok: false });
    expect(parseMarketChanges({ kind: 'add' })).toEqual({ ok: false });
  });

  it('names the change and the fields that are wrong', () => {
    const changes = [...pointAndHypothesis('v_tmp001', 'A'), { kind: 'add', entity: 'exclusion', values: { company: 'x'.repeat(45_001) } }];
    expect(parseMarketChanges(changes)).toMatchObject({ ok: false, valid: 2, fieldErrors: { company: expect.any(String) } });
    expect(parseMarketChanges([{ kind: 'add', entity: 'exclusion', values: { id: '', company: 'X' } }])).toMatchObject({ ok: false, valid: 0 });
    expect(parseMarketChanges([{ kind: 'update', entity: 'exclusion', id: 'x_1', patch: { id: 'x_2' } }])).toMatchObject({ ok: false, valid: 0 });
  });
});

describe('remapMarketChange', () => {
  it('rewrites a change\'s target and references', () => {
    const ids = { v_local: 'v_srv', h_local: 'h_srv' };
    expect(remapMarketChange({ kind: 'update', entity: 'hypothesis', id: 'h_local', patch: { valuePointIds: ['v_local', 'v_1'] } }, ids))
      .toEqual({ kind: 'update', entity: 'hypothesis', id: 'h_srv', patch: { valuePointIds: ['v_srv', 'v_1'] } });
    expect(remapMarketChange({ kind: 'add', entity: 'change', values: { entityId: 'h_local' } }, ids))
      .toEqual({ kind: 'add', entity: 'change', values: { entityId: 'h_srv' } });
    expect(remapMarketChange({ kind: 'clearCheckAgain', target: { entity: 'valuePoint', id: 'v_local' } }, ids))
      .toEqual({ kind: 'clearCheckAgain', target: { entity: 'valuePoint', id: 'v_srv' } });
  });
});
