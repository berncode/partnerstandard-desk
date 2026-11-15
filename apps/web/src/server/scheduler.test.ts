import { describe, expect, it, vi } from 'vitest';
import { callTick, EVERY_MS, PAST_THE_QUARTER_MS, selfAddress, startScheduler, untilNextRun } from './scheduler';

/** A hand-driven clock and timer: `fire()` runs the one waiting timer at its time. */
function fakeTimers(start: number) {
  let clock = start;
  const pending: Array<{ fn: () => void; at: number; id: number }> = [];
  let ids = 0;
  return {
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => { const t = { fn, at: clock + ms, id: ++ids }; pending.push(t); return { unref: () => {} , id: t.id }; },
    clearTimer: (timer: unknown) => { const i = pending.findIndex((t) => t.id === (timer as { id: number }).id); if (i >= 0) pending.splice(i, 1); },
    pending,
    fire() {
      const t = pending.shift();
      if (!t) throw new Error('no timer');
      clock = t.at;
      t.fn();
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('untilNextRun', () => {
  it('waits for the next quarter hour on the clock, and a moment past it', () => {
    expect(untilNextRun(Date.UTC(2026, 10, 9, 8, 7))).toBe(8 * 60_000 + PAST_THE_QUARTER_MS);
    // Just before the boundary (a timer that fired early): this quarter's run, not one 2 ms later.
    expect(untilNextRun(Date.UTC(2026, 10, 9, 8, 15) - 3)).toBe(3 + PAST_THE_QUARTER_MS);
    // Right at its own run time: the next quarter, never 0.
    expect(untilNextRun(Date.UTC(2026, 10, 9, 8, 15) + PAST_THE_QUARTER_MS)).toBe(EVERY_MS);
    // A timer that fired 5 ms early: this run happens now, and the next one is a quarter hour on, not 5 ms.
    expect(untilNextRun(Date.UTC(2026, 10, 9, 8, 15) + PAST_THE_QUARTER_MS - 5)).toBe(EVERY_MS + 5);
  });
});

describe('startScheduler', () => {
  it('runs once a quarter hour, from the next quarter on', async () => {
    const t = fakeTimers(Date.UTC(2026, 10, 9, 8, 7));
    const run = vi.fn(async () => {});
    startScheduler({ run, log: () => {}, ...t });
    expect(run).not.toHaveBeenCalled();
    expect(t.pending).toHaveLength(1);
    t.fire();
    expect(t.now()).toBe(Date.UTC(2026, 10, 9, 8, 15) + PAST_THE_QUARTER_MS);
    await flush();
    t.fire();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(t.now()).toBe(Date.UTC(2026, 10, 9, 8, 30) + PAST_THE_QUARTER_MS);
  });

  it('skips a run while one is going, and says so', async () => {
    const t = fakeTimers(0);
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((done) => { finish = done; }));
    const logged: string[] = [];
    startScheduler({ run, log: (e) => { logged.push(e); }, ...t });
    t.fire();
    t.fire();
    expect(run).toHaveBeenCalledTimes(1);
    expect(logged).toEqual(['scheduler_skipped']);
    finish();
    await flush();
    expect(logged).toEqual(['scheduler_skipped', 'scheduler_ran']);
    t.fire();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a failed run is logged, and the next one still comes', async () => {
    const t = fakeTimers(0);
    const run = vi.fn(async () => { throw new Error('tick_status_500'); });
    const logged: Array<[string, Record<string, string>]> = [];
    startScheduler({ run, log: (e, ids) => { logged.push([e, ids]); }, ...t });
    t.fire();
    await flush();
    expect(logged).toEqual([['scheduler_run_failed', { reason: 'tick_status_500' }]]);
    t.fire();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stop: no more runs, and it waits for the one going', async () => {
    const t = fakeTimers(0);
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((done) => { finish = done; }));
    const scheduler = startScheduler({ run, log: () => {}, ...t });
    t.fire();
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await flush();
    expect(stopped).toBe(false);
    expect(t.pending).toHaveLength(0);
    finish();
    await stopping;
    expect(stopped).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('selfAddress', () => {
  it('this computer when the server listens everywhere, its own address otherwise', () => {
    expect(selfAddress({ PORT: '3000', HOSTNAME: '0.0.0.0' })).toBe('http://127.0.0.1:3000');
    expect(selfAddress({})).toBe('http://127.0.0.1:3000');
    expect(selfAddress({ PORT: '8080', HOSTNAME: '10.0.0.5' })).toBe('http://10.0.0.5:8080');
    expect(selfAddress({ PORT: '3000', HOSTNAME: '::1' })).toBe('http://[::1]:3000');
  });
});

describe('callTick', () => {
  it('calls the job with its secret', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await callTick('http://127.0.0.1:3000', 's3cret', fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/cron/tick', expect.objectContaining({ headers: { authorization: 'Bearer s3cret' } }));
  });

  it('throws when the job does not answer 200', async () => {
    const fetcher = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    await expect(callTick('http://x', 's', fetcher as unknown as typeof fetch)).rejects.toThrow('tick_status_401');
  });
});
