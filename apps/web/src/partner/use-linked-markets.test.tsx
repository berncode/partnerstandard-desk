// @vitest-environment jsdom
import type { Market } from '@partner-desk/core';
import { sampleMarket } from '@partner-desk/core/test-builders';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteResult } from '@/editor/remote';
import { useLinkedMarkets, type MarketAccess } from './use-linked-markets';

const NONE = {};
const snapshot = (market: Market): RemoteResult<Market> => ({ ok: true, snapshot: { value: market, issues: [] }, entityId: null });

function access(over: Partial<MarketAccess> = {}): MarketAccess {
  return { read: vi.fn().mockResolvedValue(snapshot(sampleMarket())), remoteFor: vi.fn(), ...over };
}

describe('useLinkedMarkets', () => {
  it('uses the files the page was loaded with, and reads a market linked later once', async () => {
    const markets = access();
    const initial = { m_a: { status: 'ready' as const, market: sampleMarket() } };
    const { result, rerender } = renderHook(({ ids }) => useLinkedMarkets(initial, ids, markets), { initialProps: { ids: ['m_a'] } });
    expect(result.current.states.m_a?.status).toBe('ready');
    expect(markets.read).not.toHaveBeenCalled();

    rerender({ ids: ['m_a', 'm_b'] });
    expect(result.current.states.m_b).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.states.m_b?.status).toBe('ready'));
    rerender({ ids: ['m_a', 'm_b'] });
    expect(markets.read).toHaveBeenCalledTimes(1);
    expect(markets.read).toHaveBeenCalledWith('m_b');
  });

  it('shows why a market could not be read', async () => {
    const markets = access({ read: vi.fn().mockResolvedValue({ ok: false, error: 'file_not_found', message: 'We can’t reach this file.' }) });
    const { result } = renderHook(() => useLinkedMarkets(NONE, ['m_a'], markets));
    await waitFor(() => expect(result.current.states.m_a).toEqual({ status: 'failed', message: 'We can’t reach this file.' }));
  });

  it('says the market couldn’t be read when the read itself fails', async () => {
    const markets = access({ read: vi.fn().mockRejectedValue(new Error('offline')) });
    const { result } = renderHook(() => useLinkedMarkets(NONE, ['m_a'], markets));
    await waitFor(() => expect(result.current.states.m_a).toEqual({
      status: 'failed', message: 'Couldn’t load this market. Check your connection, then reload the page.',
    }));
  });

  it('adds a hypothesis to the market, keeps the saved market and answers the new id', async () => {
    const saved = sampleMarket({ hypotheses: [{ ...sampleMarket().hypotheses[0]!, id: 'h_new', name: 'Acme GmbH' }] });
    const apply = vi.fn().mockResolvedValue({ ...snapshot(saved), entityId: 'h_new' });
    const markets = access({ remoteFor: vi.fn(() => ({ apply })) });
    const initial = { m_a: { status: 'ready' as const, market: sampleMarket() } };
    const { result } = renderHook(() => useLinkedMarkets(initial, ['m_a'], markets));
    let answer: unknown;
    await act(async () => { answer = await result.current.addHypothesis('m_a', { name: 'Acme GmbH', status: 'draft' }); });
    expect(answer).toEqual({ ok: true, id: 'h_new' });
    expect(apply).toHaveBeenCalledWith({ kind: 'add', entity: 'hypothesis', values: { name: 'Acme GmbH', status: 'draft' } });
    expect(result.current.states.m_a).toEqual({ status: 'ready', market: saved });
  });

  it('answers a refused or failed save with its words', async () => {
    const refused = vi.fn().mockResolvedValue({ ok: false, error: 'auth', message: 'Google needs your permission again.' });
    const { result } = renderHook(() => useLinkedMarkets(NONE, [], access({ remoteFor: () => ({ apply: refused }) })));
    await expect(result.current.addHypothesis('m_a', {})).resolves.toEqual({ ok: false, message: 'Google needs your permission again.' });
    const thrown = vi.fn().mockRejectedValue(new Error('offline'));
    const { result: second } = renderHook(() => useLinkedMarkets(NONE, [], access({ remoteFor: () => ({ apply: thrown }) })));
    await expect(second.current.addHypothesis('m_a', {})).resolves.toEqual({ ok: false, message: 'Couldn’t save your change. Check your connection and try again.' });
  });
});
