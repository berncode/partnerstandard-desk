// The proposal index's contract (agent proposals spec 7.2): every ProposalIndex (our database, and the one in memory)
// must pass this suite. Ids, codes and times only.
import { describe, expect, it } from 'vitest';
import { makerKey, type ProposalEntry, type ProposalIndex, type ProposalMaker } from './proposal-index';

/** What a test needs around an index: the person's agent apps and keys, to turn on and off. */
export interface ProposalIndexFixture {
  index: ProposalIndex;
  /** The person allows an app (a grant that is on). */
  allowApp(userId: string, clientId: string, appName: string): Promise<void>;
  /** The person turns the app off (Settings, Turn off). */
  turnOffApp(userId: string, clientId: string): Promise<void>;
  /** The person makes a key. */
  addKey(userId: string, keyId: string, name: string): Promise<void>;
  /** The person turns the key off. */
  turnOffKey(userId: string, keyId: string): Promise<void>;
}

const T0 = '2026-11-04T10:00:00.000Z';
const LATER = '2026-11-04T11:00:00.000Z';
const EXPIRES = '2026-12-04T10:00:00.000Z';
const DAY_MS = 24 * 60 * 60_000;
const daysAfter = (at: string, days: number): string => new Date(Date.parse(at) + days * DAY_MS).toISOString();

const CLAUDE: ProposalMaker = { kind: 'app', agentName: 'Claude', clientId: 'c_claude' };
const CLAUDE_AGAIN: ProposalMaker = { kind: 'app', agentName: 'Claude', clientId: 'c_claude_2' };
const CURSOR: ProposalMaker = { kind: 'app', agentName: 'Cursor', clientId: 'c_cursor' };
const N8N: ProposalMaker = { kind: 'key', keyId: 'ak_n8n' };

type NewEntry = Parameters<ProposalIndex['add']>[0];
/** The Partners file the entries below are of. */
const BOOK = 'file-book-anna';
const entry = (overrides: Partial<NewEntry> = {}): NewEntry => ({
  id: 'prp_aaaaaaaaaa', userId: 'u_anna', kind: 'fourC', accountId: 'a_1', partnerId: 'p_1', marketId: null, hypothesisId: null,
  createdAt: T0, expiresAt: EXPIRES, madeBy: CLAUDE, fileId: BOOK, ...overrides,
});
const target = { accountId: 'a_1', partnerId: 'p_1', marketId: null, hypothesisId: null };

export function describeProposalIndexContract(name: string, make: () => Promise<ProposalIndexFixture>) {
  describe(`ProposalIndex contract: ${name}`, () => {
    it('adds a proposal and gets it back, waiting, with the app’s name; another person’s id is null', async () => {
      const { index, allowApp } = await make();
      await allowApp('u_anna', 'c_claude', 'Claude');
      await index.add(entry(), null);
      const expected: ProposalEntry = {
        ...entry(), status: 'waiting', answeredAt: null, agentName: 'Claude', makerOn: true,
      };
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toEqual(expected);
      expect(await index.get('u_ben', 'prp_aaaaaaaaaa')).toBeNull();
      expect(await index.get('u_anna', 'prp_missing000')).toBeNull();
    });

    it('add with replaces sets the old one replaced in the same batch', async () => {
      const { index } = await make();
      await index.add(entry(), null);
      await index.add(entry({ id: 'prp_bbbbbbbbbb', createdAt: LATER }), 'prp_aaaaaaaaaa');
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toMatchObject({ status: 'replaced', answeredAt: LATER });
      expect(await index.get('u_anna', 'prp_bbbbbbbbbb')).toMatchObject({ status: 'waiting', answeredAt: null });
      // One batch: a new row that can't be written (its id is taken) leaves the old one waiting.
      await index.add(entry({ id: 'prp_cccccccccc' }), null);
      await expect(index.add(entry({ id: 'prp_bbbbbbbbbb' }), 'prp_cccccccccc')).rejects.toThrow();
      expect(await index.get('u_anna', 'prp_cccccccccc')).toMatchObject({ status: 'waiting' });
    });

    it('replaces only a waiting proposal of the same person', async () => {
      const { index } = await make();
      await index.add(entry({ userId: 'u_ben' }), null);
      await index.add(entry({ id: 'prp_bbbbbbbbbb', createdAt: LATER }), 'prp_aaaaaaaaaa');
      expect(await index.get('u_ben', 'prp_aaaaaaaaaa')).toMatchObject({ status: 'waiting' });
    });

    it('waiting matches the same app name under a new client id', async () => {
      const { index } = await make();
      await index.add(entry(), null);
      // claude.ai registers a new client when it reconnects (spec 5.3): still the same agent.
      expect(await index.waiting('u_anna', 'fourC', target, CLAUDE_AGAIN)).toMatchObject({ id: 'prp_aaaaaaaaaa' });
      // Another app of the same person, another kind, another target, another person: none.
      expect(await index.waiting('u_anna', 'fourC', target, CURSOR)).toBeNull();
      expect(await index.waiting('u_anna', 'stage', target, CLAUDE)).toBeNull();
      expect(await index.waiting('u_anna', 'fourC', { ...target, partnerId: 'p_2' }, CLAUDE)).toBeNull();
      expect(await index.waiting('u_ben', 'fourC', target, CLAUDE)).toBeNull();
      // A key is its own agent, even under the app's name.
      expect(await index.waiting('u_anna', 'fourC', target, N8N)).toBeNull();
      await index.answer('u_anna', 'prp_aaaaaaaaaa', 'rejected', LATER);
      expect(await index.waiting('u_anna', 'fourC', target, CLAUDE)).toBeNull();
    });

    it('waiting matches a market and hypothesis target, null ids included', async () => {
      const { index } = await make();
      const market = { accountId: null, partnerId: null, marketId: 'm_1', hypothesisId: null };
      await index.add(entry({ kind: 'partners', ...market }), null);
      expect(await index.waiting('u_anna', 'partners', market, CLAUDE)).toMatchObject({ id: 'prp_aaaaaaaaaa' });
      expect(await index.waiting('u_anna', 'partners', { ...market, hypothesisId: 'h_1' }, CLAUDE)).toBeNull();
    });

    it('keeps two unnamed apps of one person apart, by client id', async () => {
      const { index, allowApp } = await make();
      const first: ProposalMaker = { kind: 'app', agentName: '', clientId: 'c_one' };
      const second: ProposalMaker = { kind: 'app', agentName: '', clientId: 'c_two' };
      await allowApp('u_anna', 'c_one', '');
      await index.add(entry({ madeBy: first }), null);
      expect(await index.waiting('u_anna', 'fourC', target, first)).toMatchObject({ id: 'prp_aaaaaaaaaa' });
      expect(await index.waiting('u_anna', 'fourC', target, second)).toBeNull();
      expect(await index.list('u_anna', { since: T0, maker: second })).toEqual([]);
      expect(await index.countWaiting('u_anna', T0, BOOK)).toEqual({ total: 1, byMaker: { 'client:c_one': 1 } });
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toMatchObject({ madeBy: first, makerOn: true });
    });

    it('answer is compare-and-set: a second answer is false', async () => {
      const { index } = await make();
      await index.add(entry(), null);
      expect(await index.answer('u_anna', 'prp_aaaaaaaaaa', 'accepted', LATER)).toBe(true);
      expect(await index.answer('u_anna', 'prp_aaaaaaaaaa', 'rejected', daysAfter(LATER, 1))).toBe(false);
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toMatchObject({ status: 'accepted', answeredAt: LATER });
      // Another person's id is never answered.
      await index.add(entry({ id: 'prp_bbbbbbbbbb' }), null);
      expect(await index.answer('u_ben', 'prp_bbbbbbbbbb', 'withdrawn', LATER)).toBe(false);
      expect(await index.get('u_anna', 'prp_bbbbbbbbbb')).toMatchObject({ status: 'waiting' });
    });

    it('lists the person’s proposals since a time, newest first, by maker, status or id', async () => {
      const { index } = await make();
      await index.add(entry({ id: 'prp_old0000000', createdAt: '2026-08-01T10:00:00.000Z', expiresAt: '2026-08-31T10:00:00.000Z' }), null);
      await index.add(entry({ id: 'prp_aaaaaaaaaa' }), null);
      await index.add(entry({ id: 'prp_bbbbbbbbbb', createdAt: LATER, madeBy: CLAUDE_AGAIN, kind: 'stage' }), null);
      await index.add(entry({ id: 'prp_cccccccccc', createdAt: LATER, madeBy: CURSOR }), null);
      await index.add(entry({ id: 'prp_dddddddddd', createdAt: LATER, madeBy: N8N }), null);
      await index.add(entry({ id: 'prp_benbenbenb', userId: 'u_ben' }), null);
      await index.answer('u_anna', 'prp_aaaaaaaaaa', 'rejected', LATER);
      const ids = (entries: ProposalEntry[]) => entries.map((e) => e.id);
      expect(ids(await index.list('u_anna', { since: T0 }))).toEqual(['prp_dddddddddd', 'prp_cccccccccc', 'prp_bbbbbbbbbb', 'prp_aaaaaaaaaa']);
      expect(ids(await index.list('u_anna', { since: T0, maker: CLAUDE }))).toEqual(['prp_bbbbbbbbbb', 'prp_aaaaaaaaaa']);
      expect(ids(await index.list('u_anna', { since: T0, maker: N8N }))).toEqual(['prp_dddddddddd']);
      expect(ids(await index.list('u_anna', { since: T0, status: 'rejected' }))).toEqual(['prp_aaaaaaaaaa']);
      expect(ids(await index.list('u_anna', { since: T0, proposalId: 'prp_cccccccccc' }))).toEqual(['prp_cccccccccc']);
      expect(ids(await index.list('u_anna', { since: T0, proposalId: 'prp_benbenbenb' }))).toEqual([]);
      expect(ids(await index.list('u_anna', { since: '2026-07-01T00:00:00.000Z' }))).toContain('prp_old0000000');
    });

    it('countWaiting leaves out expired ones by date before the job runs', async () => {
      const { index } = await make();
      await index.add(entry(), null);
      await index.add(entry({ id: 'prp_bbbbbbbbbb', madeBy: CLAUDE_AGAIN, kind: 'stage' }), null);
      await index.add(entry({ id: 'prp_cccccccccc', madeBy: N8N }), null);
      await index.add(entry({ id: 'prp_dddddddddd', madeBy: CURSOR, expiresAt: LATER }), null);
      await index.add(entry({ id: 'prp_eeeeeeeeee', madeBy: CURSOR, kind: 'close' }), null);
      await index.answer('u_anna', 'prp_eeeeeeeeee', 'withdrawn', LATER);
      await index.add(entry({ id: 'prp_benbenbenb', userId: 'u_ben' }), null);
      expect(await index.countWaiting('u_anna', T0, BOOK)).toEqual({ total: 4, byMaker: { 'app:Claude': 2, 'key:ak_n8n': 1, 'app:Cursor': 1 } });
      // An hour later Cursor's has passed its expiry: no longer counted, though the job hasn't marked it yet.
      expect(await index.countWaiting('u_anna', LATER, BOOK)).toEqual({ total: 3, byMaker: { 'app:Claude': 2, 'key:ak_n8n': 1 } });
      expect(await index.get('u_anna', 'prp_dddddddddd')).toMatchObject({ status: 'waiting' });
      expect(await index.countWaiting('u_nobody', T0, BOOK)).toEqual({ total: 0, byMaker: {} });
    });

    it('countWaiting counts one Partners file’s', async () => {
      const { index } = await make();
      await index.add(entry(), null);
      await index.add(entry({ id: 'prp_bbbbbbbbbb', kind: 'stage', fileId: 'file-book-anna-old' }), null);
      expect(await index.countWaiting('u_anna', T0, BOOK)).toEqual({ total: 1, byMaker: { 'app:Claude': 1 } });
      expect(await index.countWaiting('u_anna', T0, 'file-book-anna-old')).toEqual({ total: 1, byMaker: { 'app:Claude': 1 } });
    });

    it('makerOn is false once the app’s grant is turned off or the key is turned off, and the entry stays', async () => {
      const { index, allowApp, turnOffApp, addKey, turnOffKey } = await make();
      await allowApp('u_anna', 'c_claude', 'Claude');
      await allowApp('u_anna', 'c_claude_2', 'Claude');
      await addKey('u_anna', 'ak_n8n', 'n8n');
      await index.add(entry(), null);
      await index.add(entry({ id: 'prp_bbbbbbbbbb', madeBy: N8N }), null);
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toMatchObject({ agentName: 'Claude', makerOn: true });
      expect(await index.get('u_anna', 'prp_bbbbbbbbbb')).toMatchObject({ agentName: 'n8n', makerOn: true });

      // The reconnected Claude is still on: its name counts, not the client id that made the proposal.
      await turnOffApp('u_anna', 'c_claude');
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toMatchObject({ makerOn: true });
      await turnOffApp('u_anna', 'c_claude_2');
      await turnOffKey('u_anna', 'ak_n8n');
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toMatchObject({ status: 'waiting', agentName: 'Claude', makerOn: false });
      expect(await index.get('u_anna', 'prp_bbbbbbbbbb')).toMatchObject({ status: 'waiting', agentName: 'n8n', makerOn: false });
      expect((await index.list('u_anna', { since: T0 })).map((e) => [e.id, e.makerOn])).toEqual([
        ['prp_bbbbbbbbbb', false], ['prp_aaaaaaaaaa', false],
      ]);
      // The person may still answer them.
      expect(await index.answer('u_anna', 'prp_aaaaaaaaaa', 'accepted', LATER)).toBe(true);
    });

    it('an app is on only for the person who allowed it', async () => {
      const { index, allowApp } = await make();
      await allowApp('u_ben', 'c_claude', 'Claude');
      await index.add(entry(), null);
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toMatchObject({ makerOn: false });
    });

    it('expire and prune keep a waiting one and drop one answered 91 days ago', async () => {
      const { index } = await make();
      const now = daysAfter(T0, 95);
      // Made 95 days ago, expired 65 days ago: the job marks it expired as of its expiry, and keeps it (not 90 days yet).
      await index.add(entry({ id: 'prp_expired000' }), null);
      // Made 100 days ago, answered 91 days ago.
      await index.add(entry({ id: 'prp_answered00', createdAt: daysAfter(T0, -5), expiresAt: daysAfter(T0, 25) }), null);
      await index.answer('u_anna', 'prp_answered00', 'accepted', daysAfter(now, -91));
      // Made yesterday: still waiting.
      await index.add(entry({ id: 'prp_waiting000', createdAt: daysAfter(now, -1), expiresAt: daysAfter(now, 29) }), null);

      expect(await index.expire(now)).toBe(1);
      expect(await index.get('u_anna', 'prp_expired000')).toMatchObject({ status: 'expired', answeredAt: EXPIRES });
      expect(await index.expire(now)).toBe(0);

      expect(await index.prune(daysAfter(now, -90))).toBe(1);
      expect(await index.get('u_anna', 'prp_answered00')).toBeNull();
      expect(await index.get('u_anna', 'prp_waiting000')).toMatchObject({ status: 'waiting' });
      expect(await index.get('u_anna', 'prp_expired000')).toMatchObject({ status: 'expired' });
      // Pruning all answered before now drops the expired one, and never a waiting one, however old.
      await index.add(entry({ id: 'prp_ancient000', createdAt: daysAfter(now, -400), expiresAt: daysAfter(now, 10) }), null);
      expect(await index.prune(now)).toBe(1);
      expect(await index.get('u_anna', 'prp_expired000')).toBeNull();
      expect(await index.get('u_anna', 'prp_ancient000')).toMatchObject({ status: 'waiting' });
    });

    it('deleteForUser removes the person’s rows and leaves another person’s', async () => {
      const { index } = await make();
      await index.add(entry(), null);
      await index.add(entry({ id: 'prp_benbenbenb', userId: 'u_ben' }), null);
      await index.deleteForUser('u_anna');
      await index.deleteForUser('u_anna');
      expect(await index.get('u_anna', 'prp_aaaaaaaaaa')).toBeNull();
      expect(await index.get('u_ben', 'prp_benbenbenb')).toMatchObject({ status: 'waiting' });
    });

    it('on a company server keeps each member’s agents apart: two members’ “Claude” are two agents (plan 15)', async () => {
      const { index, allowApp, addKey, turnOffApp } = await make();
      const WS = 'ws_aaaaaaaaaa';
      const annas: ProposalMaker = { ...CLAUDE, personId: 'u_anna' };
      const bens: ProposalMaker = { kind: 'app', agentName: 'Claude', clientId: 'c_claude_ben', personId: 'u_ben' };
      const bensKey: ProposalMaker = { kind: 'key', keyId: 'ak_ben', personId: 'u_ben' };
      await allowApp('u_anna', 'c_claude', 'Claude');
      await addKey('u_ben', 'ak_ben', 'n8n');
      await index.add(entry({ userId: WS, madeBy: annas }), null);
      await index.add(entry({ id: 'prp_bbbbbbbbbb', userId: WS, madeBy: bens }), null);
      await index.add(entry({ id: 'prp_cccccccccc', userId: WS, madeBy: bensKey }), null);

      expect((await index.waiting(WS, 'fourC', target, annas))?.id).toBe('prp_aaaaaaaaaa');
      expect((await index.waiting(WS, 'fourC', target, bens))?.id).toBe('prp_bbbbbbbbbb');
      expect((await index.list(WS, { since: T0, maker: bens })).map((e) => e.id)).toEqual(['prp_bbbbbbbbbb']);
      // Each named and on by its own member's grants and keys: Ben allowed no Claude.
      expect(await index.get(WS, 'prp_aaaaaaaaaa')).toMatchObject({ madeBy: annas, agentName: 'Claude', makerOn: true });
      expect(await index.get(WS, 'prp_bbbbbbbbbb')).toMatchObject({ madeBy: bens, agentName: 'Claude', makerOn: false });
      expect(await index.get(WS, 'prp_cccccccccc')).toMatchObject({ madeBy: bensKey, agentName: 'n8n', makerOn: true });
      expect(await index.countWaiting(WS, T0, BOOK)).toEqual({
        total: 3, byMaker: { [makerKey(annas)]: 1, [makerKey(bens)]: 1, [makerKey(bensKey)]: 1 },
      });
      await turnOffApp('u_anna', 'c_claude');
      expect(await index.get(WS, 'prp_aaaaaaaaaa')).toMatchObject({ makerOn: false });
      // A hosted maker (no member) is another agent again.
      expect(await index.waiting(WS, 'fourC', target, CLAUDE)).toBeNull();
    });
  });
}
