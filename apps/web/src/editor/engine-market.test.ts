// The editor engine's behaviors for a Market, through the market adapter.
import { applyMarketChange, type Market, type MarketChange } from '@partner-desk/core';
import { sampleMarket } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketAdapter } from './adapters';
import { createEditorEngine } from './engine';
import type { RemoteResult } from './remote';

const WINDOW = 5000;
const T1 = '2026-10-21T10:05:00.000Z';
const snapshot = (value: Market = sampleMarket()): Snapshot<Market> => ({ value, issues: [] });
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function serverApply(market: Market, change: MarketChange, now: string): Extract<RemoteResult<Market>, { ok: true }> {
  const out = applyMarketChange(market, change, { now, actor: 'Ruth', newId: (entity) => `${entity}_srv` });
  if (!out.ok) throw new Error(out.message);
  return { ok: true, snapshot: snapshot(out.value), entityId: out.entityId };
}

function setup() {
  const calls: Array<{ change: MarketChange; resolve: (r: RemoteResult<Market>) => void }> = [];
  const remote = { apply: vi.fn((change: MarketChange) => new Promise<RemoteResult<Market>>((resolve) => { calls.push({ change, resolve }); })) };
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const engine = createEditorEngine<Market, MarketChange>({
    initial: snapshot(), remote, notify, refresh: vi.fn(), undoWindowMs: WINDOW, adapter: marketAdapter,
  });
  return { engine, calls, notify, view: () => engine.view() };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('market editor', () => {
  it('chains market detail edits on the version each save produced', async () => {
    const { engine, calls, view } = setup();
    engine.dispatch({ kind: 'updateInfo', patch: { marketName: 'Vienna' } });
    engine.dispatch({ kind: 'updateInfo', patch: { statusNote: 'Three calls' } });
    expect(view().info).toMatchObject({ marketName: 'Vienna', statusNote: 'Three calls' });
    await settle();
    expect(calls[0]!.change).toMatchObject({ expectedUpdatedAt: '2026-10-20T09:00:00.000Z' });
    calls[0]!.resolve(serverApply(sampleMarket(), calls[0]!.change, T1));
    await settle();
    expect(calls[1]!.change).toMatchObject({ expectedUpdatedAt: T1 });
  });

  it('undoes a market detail edit, putting back the check-again flags it cleared', async () => {
    const { engine, calls, notify, view } = setup();
    engine.dispatch({ kind: 'updateInfo', patch: { statement: 'New' } }, { label: 'Statement changed' });
    expect(notify.undo).toHaveBeenCalledWith('Statement changed', expect.any(Function));
    await settle();
    calls[0]!.resolve(serverApply(sampleMarket(), calls[0]!.change, T1));
    await settle();
    engine.undo();
    expect(view().info).toMatchObject({ statement: sampleMarket().info.statement, checkAgain: ['mustHaves', 'statement'] });
    await settle();
    expect(calls[1]!.change).toEqual({
      kind: 'updateInfo', patch: { statement: sampleMarket().info.statement, checkAgain: ['mustHaves', 'statement'] }, expectedUpdatedAt: T1,
    });
  });

  it('holds an exclusion’s delete back, and undo keeps it', async () => {
    const { engine, calls, view } = setup();
    engine.dispatch({ kind: 'delete', entity: 'exclusion', id: 'x_1' }, { label: 'Exclusion removed' });
    expect(view().exclusions).toEqual([]);
    engine.undo();
    expect(view().exclusions.map((x) => x.id)).toEqual(['x_1']);
    vi.advanceTimersByTime(WINDOW * 2);
    await settle();
    expect(calls).toHaveLength(0);
  });

  it('on a conflict drops the row’s other edits, and keeps the market details’ edits', async () => {
    const { engine, calls, notify, view } = setup();
    engine.dispatch({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'One' } });
    engine.dispatch({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { lookalike: 'Two' } });
    engine.dispatch({ kind: 'updateInfo', patch: { statusNote: 'Three' } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    await settle();
    expect(view().hypotheses[0]).toMatchObject({ name: 'Mid-size IT firms', lookalike: 'IT firms with 10-50 staff' });
    expect(view().info.statusNote).toBe('Three');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.change).toMatchObject({ kind: 'updateInfo' });
    expect(notify.info).toHaveBeenCalledWith(COPY.SAVE_CONFLICT, expect.objectContaining({ label: COPY.REFRESH }));
  });

  it('sends a hypothesis that links a value point added before it was saved with the value point’s server id', async () => {
    const { engine, calls } = setup();
    const added = engine.dispatch({ kind: 'add', entity: 'valuePoint', values: { text: 'Training revenue' } });
    if (!added.ok) throw new Error('add refused');
    engine.dispatch({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { valuePointIds: ['v_1', added.entityId!] } });
    await settle();
    calls[0]!.resolve(serverApply(sampleMarket(), calls[0]!.change, T1));
    await settle();
    expect(calls[1]!.change).toMatchObject({ patch: { valuePointIds: ['v_1', 'valuePoint_srv'] } });
  });

  it('has no batch save', () => {
    const { engine } = setup();
    expect(() => engine.applyMany([], undefined)).toThrow();
  });
});
