// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Server actions run one at a time: a rewrite sent as one would hold up every save behind it. The scheduler never uses them.
vi.mock('@/app/(signed-in)/actions/programs', () => {
  throw new Error('The output scheduler must not use server actions');
});

type Answer = { failed: string[]; refused: string[] } | { status: number };
/** What the server answers for the ids of one POST /api/programs/outputs. */
const answerFor = vi.fn<(ids: string[]) => Promise<Answer>>();
const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  const answer = await answerFor(JSON.parse(String(init.body)).programIds as string[]);
  if ('status' in answer) return new Response(null, { status: answer.status });
  return Response.json(answer);
});

const { OutputRefreshProvider, useOutputRefresh, REFRESH_DELAY_MS, OPEN_FRESH_MS } = await import('./use-output-refresh');

type Refresh = ReturnType<typeof useOutputRefresh>;
const handle: { current: Refresh | null } = { current: null };
const api = () => handle.current as Refresh;

function Probe() {
  const refresh = useOutputRefresh();
  useEffect(() => {
    handle.current = refresh;
  });
  return <p data-testid="failed">{refresh.failed.join(',')}</p>;
}

const show = () => render(<OutputRefreshProvider><Probe /></OutputRefreshProvider>);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `pg_${String(i).padStart(10, '0')}`);
/** Lets the promises a timer started settle. */
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

describe('useOutputRefresh', () => {
  const sendBeacon = vi.fn<(url: string, body: string) => boolean>(() => true);

  beforeEach(() => {
    vi.useFakeTimers();
    answerFor.mockReset();
    answerFor.mockResolvedValue({ failed: [], refused: [] });
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    sendBeacon.mockClear();
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends a rewrite with fetch to /api/programs/outputs, never as a server action, so saves never wait behind it', async () => {
    show();
    await act(() => api().flush(['pg_a']));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/programs/outputs');
    expect(init).toMatchObject({ method: 'POST', keepalive: false, body: JSON.stringify({ programIds: ['pg_a'] }) });
  });

  it('waits 30 seconds after the last queue, then rewrites everything queued in one call', async () => {
    show();
    expect(REFRESH_DELAY_MS).toBe(30_000);
    act(() => api().queue(['pg_a']));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => api().queue(['pg_b']));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => api().queue(['pg_a', 'pg_c']));
    act(() => vi.advanceTimersByTime(29_999));
    expect(answerFor).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    await settle();
    expect(answerFor).toHaveBeenCalledTimes(1);
    expect(answerFor).toHaveBeenCalledWith(['pg_a', 'pg_b', 'pg_c']);
    act(() => vi.advanceTimersByTime(60_000));
    expect(answerFor).toHaveBeenCalledTimes(1);
  });

  it('flush rewrites at once: the ids given, or everything queued', async () => {
    show();
    await act(() => api().flush(['pg_x']));
    expect(answerFor).toHaveBeenCalledTimes(1);
    expect(answerFor).toHaveBeenLastCalledWith(['pg_x']);

    act(() => api().queue(['pg_a', 'pg_b']));
    await act(() => api().flush());
    expect(answerFor).toHaveBeenCalledTimes(2);
    expect(answerFor).toHaveBeenLastCalledWith(['pg_a', 'pg_b']);
    // Nothing is left to send when the 30 seconds are up.
    act(() => vi.advanceTimersByTime(30_000));
    await settle();
    expect(answerFor).toHaveBeenCalledTimes(2);
  });

  it('flush with ids leaves the others queued for their pause', async () => {
    show();
    act(() => api().queue(['pg_a', 'pg_b']));
    await act(() => api().flush(['pg_a']));
    expect(answerFor).toHaveBeenLastCalledWith(['pg_a']);
    act(() => vi.advanceTimersByTime(30_000));
    await settle();
    expect(answerFor).toHaveBeenLastCalledWith(['pg_b']);
    expect(answerFor).toHaveBeenCalledTimes(2);
  });

  it('sends at most 50 ids a call', async () => {
    show();
    act(() => api().queue(ids(120)));
    await act(() => api().flush());
    expect(answerFor.mock.calls.map(([sent]) => (sent as string[]).length)).toEqual([50, 50, 20]);
    expect(answerFor.mock.calls.flatMap(([sent]) => sent as string[])).toEqual(ids(120));
  });

  it('exposes what failed and tries it again on the next trigger', async () => {
    const { getByTestId } = show();
    answerFor.mockResolvedValueOnce({ failed: ['pg_b'], refused: [] });
    await act(() => api().flush(['pg_a', 'pg_b']));
    expect(api().failed).toEqual(['pg_b']);
    expect(getByTestId('failed')).toHaveTextContent('pg_b');

    await act(() => api().flush(['pg_c']));
    expect(answerFor).toHaveBeenLastCalledWith(['pg_c', 'pg_b']);
    expect(api().failed).toEqual([]);
  });

  it('counts a refused call and a thrown one as failed for every id sent', async () => {
    show();
    answerFor.mockResolvedValueOnce({ status: 500 });
    await act(() => api().flush(['pg_a']));
    expect(api().failed).toEqual(['pg_a']);
    answerFor.mockRejectedValueOnce(new Error('offline'));
    await act(() => api().flush(['pg_b']));
    expect(api().failed).toEqual(['pg_b', 'pg_a']);
  });

  it('shows a refused program as failed, but sends it again only when asked for it (its screen opens, or it is saved)', async () => {
    const { unmount } = show();
    answerFor.mockResolvedValueOnce({ failed: [], refused: ['pg_bad'] });
    await act(() => api().flush(['pg_ok', 'pg_bad']));
    expect(api().failed).toEqual(['pg_bad']);

    // Another program's rewrite, the 30 second timer and leaving the tab don't send it.
    await act(() => api().flush(['pg_c']));
    expect(answerFor).toHaveBeenLastCalledWith(['pg_c']);
    act(() => api().queue(['pg_d']));
    act(() => vi.advanceTimersByTime(30_000));
    await settle();
    expect(answerFor).toHaveBeenLastCalledWith(['pg_d']);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(api().failed).toEqual(['pg_bad']);

    // Its screen opening sends it.
    answerFor.mockResolvedValueOnce({ failed: [], refused: ['pg_bad'] });
    await act(() => api().flush(['pg_bad']));
    expect(answerFor).toHaveBeenLastCalledWith(['pg_bad']);
    expect(api().failed).toEqual(['pg_bad']);

    // A save of it sends it, and once it goes through it is no longer failed.
    act(() => api().queue(['pg_bad']));
    act(() => vi.advanceTimersByTime(30_000));
    await settle();
    expect(answerFor).toHaveBeenLastCalledWith(['pg_bad']);
    expect(api().failed).toEqual([]);
    unmount();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('cleared: a program whose outputs were rewritten another way is no longer failed, and not sent again', async () => {
    show();
    answerFor.mockResolvedValueOnce({ failed: ['pg_a'], refused: ['pg_b'] });
    await act(() => api().flush(['pg_a', 'pg_b']));
    expect(api().failed).toEqual(['pg_a', 'pg_b']);
    act(() => api().cleared(['pg_a', 'pg_b']));
    expect(api().failed).toEqual([]);
    await act(() => api().flush(['pg_c']));
    expect(answerFor).toHaveBeenLastCalledWith(['pg_c']);
  });

  it('missed: a program whose outputs a screen couldn’t rewrite is shown as failed and sent with the next rewrite', async () => {
    show();
    act(() => api().missed(['pg_a']));
    expect(api().failed).toEqual(['pg_a']);
    await act(() => api().flush(['pg_b']));
    expect(answerFor).toHaveBeenLastCalledWith(['pg_b', 'pg_a']);
    expect(api().failed).toEqual([]);
  });

  it('never runs two rewrites at once', async () => {
    show();
    let release: () => void = () => {};
    answerFor.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ failed: [], refused: [] }); }));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => { first = api().flush(['pg_a']); });
    await settle(); // pg_a is in flight
    act(() => { second = api().flush(['pg_b']); });
    await settle();
    expect(answerFor).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await first; await second; });
    expect(answerFor).toHaveBeenCalledTimes(2);
    expect(answerFor).toHaveBeenLastCalledWith(['pg_b']);
  });

  it('sends what is queued with sendBeacon when the tab is left, at most 50 ids a beacon', async () => {
    show();
    act(() => api().queue(ids(60)));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect(sendBeacon).toHaveBeenNthCalledWith(1, '/api/programs/outputs', JSON.stringify({ programIds: ids(60).slice(0, 50) }));
    expect(sendBeacon).toHaveBeenNthCalledWith(2, '/api/programs/outputs', JSON.stringify({ programIds: ids(60).slice(50) }));
    act(() => vi.advanceTimersByTime(30_000));
    await settle();
    expect(answerFor).not.toHaveBeenCalled();
  });

  it('beacons ids waiting behind the rewrite in flight, but not the batch in flight', async () => {
    show();
    let release: () => void = () => {};
    answerFor.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ failed: [], refused: [] }); }));
    act(() => { void api().flush(['pg_a']); });
    await settle();
    expect(answerFor).toHaveBeenCalledTimes(1);
    act(() => api().queue(['pg_b']));
    act(() => vi.advanceTimersByTime(30_000)); // the timer's send now waits behind pg_a
    act(() => { void api().flush(['pg_c']); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith('/api/programs/outputs', JSON.stringify({ programIds: ['pg_b', 'pg_c'] }));
    // Beaconed ids are not sent again: not by the run once pg_a returns, not when the designer closes.
    await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(answerFor).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('beacons the later batches of a run over 50 ids while its first batch is in flight', async () => {
    show();
    let release: () => void = () => {};
    answerFor.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ failed: [], refused: [] }); }));
    act(() => api().queue(ids(120)));
    act(() => { void api().flush(); });
    await settle();
    expect(answerFor).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(sendBeacon.mock.calls.flatMap(([, body]) => JSON.parse(body as string).programIds)).toEqual(ids(120).slice(50));
    await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
    expect(answerFor).toHaveBeenCalledTimes(1);
  });

  it('beacons failed ids once, then not again on unmount', async () => {
    const { unmount } = show();
    answerFor.mockResolvedValueOnce({ failed: ['pg_a'], refused: [] });
    await act(() => api().flush(['pg_a']));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(sendBeacon).toHaveBeenCalledWith('/api/programs/outputs', JSON.stringify({ programIds: ['pg_a'] }));
    unmount();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the tab is left with nothing queued', () => {
    show();
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('sends what is queued when the designer closes (another company, Settings)', () => {
    const { unmount } = show();
    act(() => api().queue(['pg_a']));
    unmount();
    expect(sendBeacon).toHaveBeenCalledWith('/api/programs/outputs', JSON.stringify({ programIds: ['pg_a'] }));
  });

  it('forgets a deleted program: queued or failed, it is never sent again', async () => {
    answerFor.mockResolvedValueOnce({ failed: [], refused: ['pg_gone'] });
    const { unmount } = show();
    await act(() => api().flush(['pg_gone']));
    expect(api().failed).toEqual(['pg_gone']);
    act(() => api().queue(['pg_gone', 'pg_b']));
    act(() => api().forget(['pg_gone']));
    expect(api().failed).toEqual([]);
    act(() => vi.advanceTimersByTime(30_000));
    await settle();
    expect(answerFor).toHaveBeenLastCalledWith(['pg_b']);
    act(() => api().queue(['pg_gone']));
    act(() => api().forget(['pg_gone']));
    unmount();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  describe('open: a program or one of its outputs opens', () => {
    it('rewrites once when the program and its Program Sheet open together, and again after a save', async () => {
      show();
      const first = api().open(['pg_a']);
      const second = api().open(['pg_a']);
      await act(() => Promise.all([first, second]));
      expect(answerFor).toHaveBeenCalledTimes(1);
      // Opened again a moment later, nothing saved since: nothing to rewrite.
      await act(() => api().open(['pg_a']));
      expect(answerFor).toHaveBeenCalledTimes(1);
      // A save since: the next opening rewrites.
      act(() => api().queue(['pg_a']));
      await act(() => api().open(['pg_a']));
      expect(answerFor).toHaveBeenCalledTimes(2);
      act(() => vi.advanceTimersByTime(30_000));
      await settle();
      expect(answerFor).toHaveBeenCalledTimes(2);
    });

    it('rewrites again once a few seconds have passed, and always when the last rewrite failed', async () => {
      show();
      await act(() => api().open(['pg_a']));
      act(() => vi.advanceTimersByTime(OPEN_FRESH_MS));
      await act(() => api().open(['pg_a']));
      expect(answerFor).toHaveBeenCalledTimes(2);
      answerFor.mockResolvedValueOnce({ failed: ['pg_b'], refused: [] });
      await act(() => api().open(['pg_b']));
      await act(() => api().open(['pg_b']));
      expect(answerFor.mock.calls.map(([sent]) => sent)).toEqual([['pg_a'], ['pg_a'], ['pg_b'], ['pg_b']]);
    });
  });
});
