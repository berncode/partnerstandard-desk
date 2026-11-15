import {
  appMaker, cleanAgentName, makerKey, type ProposalEntry, type ProposalIndex, type ProposalMaker,
} from '@partner-desk/commands';
import type { IsoDateTime, ProposalKind, ProposalStatus, ProposalTarget } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { and, desc, eq, gt, gte, inArray, isNull, isNotNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from './client';
import { guarded } from './guarded';
import { apiKeys, oauthClient, oauthConsent, proposals } from './schema';

type Row = typeof proposals.$inferSelect;

const makerOfRow = (row: Pick<Row, 'makerKind' | 'makerName' | 'clientId' | 'keyId' | 'makerPersonId'>): ProposalMaker => {
  const person = row.makerPersonId !== null ? { personId: row.makerPersonId } : {};
  return row.makerKind === 'key'
    ? { kind: 'key', keyId: row.keyId ?? '', ...person }
    : { kind: 'app', agentName: row.makerName ?? '', clientId: row.clientId ?? '', ...person };
};

/** The agent alone, without the member it acts for: how a person's own grants name it. */
const agentOnly = (m: ProposalMaker): ProposalMaker => (m.kind === 'key'
  ? { kind: 'key', keyId: m.keyId }
  : { kind: 'app', agentName: m.agentName, clientId: m.clientId });

/**
 * The rows of this maker: an app by its name (an unnamed app by its client id), a key by its id (`makerKey`); on a
 * company server, of that member only (plan 15).
 */
function byMaker(maker: ProposalMaker): SQL {
  const person = maker.personId === undefined ? isNull(proposals.makerPersonId) : eq(proposals.makerPersonId, maker.personId);
  if (maker.kind === 'key') return and(eq(proposals.makerKind, 'key'), eq(proposals.keyId, maker.keyId), person)!;
  if (maker.agentName === '') return and(eq(proposals.makerKind, 'app'), eq(proposals.makerName, ''), eq(proposals.clientId, maker.clientId), person)!;
  return and(eq(proposals.makerKind, 'app'), eq(proposals.makerName, maker.agentName), person)!;
}

/** The same target: each of the four ids equal, or both empty. */
function byTarget(target: ProposalTarget): SQL {
  const same = (column: SQLiteColumn, value: string | null) => (value === null ? isNull(column) : eq(column, value));
  return and(
    same(proposals.accountId, target.accountId), same(proposals.partnerId, target.partnerId),
    same(proposals.marketId, target.marketId), same(proposals.hypothesisId, target.hypothesisId),
  )!;
}

/**
 * The proposal index (agent proposals spec 7.2): one row per proposal, with ids, codes, times and the app's name. Who
 * made it is read with the person's grants and keys as they are now: `agentName` (a key's name from api_keys) and
 * `makerOn`. Every call fails with the operation's name only.
 */
export class TursoProposals implements ProposalIndex {
  constructor(private readonly db: Db) {}

  async add(entry: Parameters<ProposalIndex['add']>[0], replaces: string | null): Promise<void> {
    const m = entry.madeBy;
    const insert = this.db.insert(proposals).values({
      id: entry.id, userId: entry.userId, kind: entry.kind, accountId: entry.accountId, partnerId: entry.partnerId, marketId: entry.marketId,
      hypothesisId: entry.hypothesisId, status: 'waiting', createdAt: entry.createdAt, answeredAt: null, expiresAt: entry.expiresAt,
      makerKind: m.kind, makerName: m.kind === 'app' ? m.agentName : null, clientId: m.kind === 'app' ? m.clientId : null,
      keyId: m.kind === 'key' ? m.keyId : null, makerPersonId: m.personId ?? null, fileId: entry.fileId,
    });
    await guarded('proposals_add_failed', async () => {
      if (replaces === null) {
        await insert;
        return;
      }
      // One batch: the old one is replaced only if the new one is written.
      await this.db.batch([
        this.db.update(proposals).set({ status: 'replaced', answeredAt: entry.createdAt })
          .where(and(eq(proposals.id, replaces), eq(proposals.userId, entry.userId), eq(proposals.status, 'waiting'))),
        insert,
      ]);
    });
  }

  async get(userId: string, id: string): Promise<ProposalEntry | null> {
    const rows = await guarded('proposals_get_failed', () => this.db.select().from(proposals)
      .where(and(eq(proposals.userId, userId), eq(proposals.id, id))).limit(1));
    return (await this.entries(userId, rows, 'proposals_get_failed'))[0] ?? null;
  }

  async list(
    userId: string, filter: { since: IsoDateTime; maker?: ProposalMaker; status?: ProposalStatus; proposalId?: string },
  ): Promise<ProposalEntry[]> {
    const rows = await guarded('proposals_list_failed', () => this.db.select().from(proposals).where(and(
      eq(proposals.userId, userId), gte(proposals.createdAt, filter.since),
      filter.maker ? byMaker(filter.maker) : undefined,
      filter.status ? eq(proposals.status, filter.status) : undefined,
      filter.proposalId !== undefined ? eq(proposals.id, filter.proposalId) : undefined,
    )).orderBy(desc(proposals.createdAt), desc(proposals.id)));
    return this.entries(userId, rows, 'proposals_list_failed');
  }

  async waiting(userId: string, kind: ProposalKind, target: ProposalTarget, maker: ProposalMaker): Promise<ProposalEntry | null> {
    const rows = await guarded('proposals_waiting_failed', () => this.db.select().from(proposals).where(and(
      eq(proposals.userId, userId), eq(proposals.status, 'waiting'), eq(proposals.kind, kind), byTarget(target), byMaker(maker),
    )).orderBy(desc(proposals.createdAt), desc(proposals.id)).limit(1));
    return (await this.entries(userId, rows, 'proposals_waiting_failed'))[0] ?? null;
  }

  async answer(userId: string, id: string, to: Exclude<ProposalStatus, 'waiting'>, at: IsoDateTime): Promise<boolean> {
    const changed = await guarded('proposals_answer_failed', () => this.db.update(proposals).set({ status: to, answeredAt: at })
      .where(and(eq(proposals.userId, userId), eq(proposals.id, id), eq(proposals.status, 'waiting'))).returning({ id: proposals.id }));
    return changed.length > 0;
  }

  async countWaiting(userId: string, now: IsoDateTime, fileId: string): Promise<{ total: number; byMaker: Record<string, number> }> {
    const rows = await guarded('proposals_count_failed', () => this.db.select({
      makerKind: proposals.makerKind, makerName: proposals.makerName, clientId: proposals.clientId, keyId: proposals.keyId,
      makerPersonId: proposals.makerPersonId, n: sql<number>`count(*)`,
    }).from(proposals).where(and(eq(proposals.userId, userId), eq(proposals.fileId, fileId), eq(proposals.status, 'waiting'), gt(proposals.expiresAt, now)))
      .groupBy(proposals.makerKind, proposals.makerName, proposals.clientId, proposals.keyId, proposals.makerPersonId));
    const byMakerKey: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const n = Number(row.n);
      const key = makerKey(makerOfRow(row));
      byMakerKey[key] = (byMakerKey[key] ?? 0) + n;
      total += n;
    }
    return { total, byMaker: byMakerKey };
  }

  async expire(now: IsoDateTime): Promise<number> {
    const changed = await guarded('proposals_expire_failed', () => this.db.update(proposals)
      .set({ status: 'expired', answeredAt: sql`${proposals.expiresAt}` })
      .where(and(eq(proposals.status, 'waiting'), lte(proposals.expiresAt, now))).returning({ id: proposals.id }));
    return changed.length;
  }

  async prune(answeredBefore: IsoDateTime): Promise<number> {
    const gone = await guarded('proposals_prune_failed', () => this.db.delete(proposals)
      .where(and(ne(proposals.status, 'waiting'), isNotNull(proposals.answeredAt), lt(proposals.answeredAt, answeredBefore)))
      .returning({ id: proposals.id }));
    return gone.length;
  }

  async deleteForUser(userId: string): Promise<void> {
    await guarded('proposals_delete_failed', () => this.db.delete(proposals).where(eq(proposals.userId, userId)));
  }

  /**
   * The rows as entries, with who made them as things are now: one read of the person's grants that are on (by the name
   * the app acts under, `appMaker`) and one of the keys named. Unknown codes would be a bug: the columns are typed lists.
   */
  private async entries(userId: string, rows: Row[], operation: string): Promise<ProposalEntry[]> {
    if (rows.length === 0) return [];
    // Whose grants and keys made each row: a company server's member (plan 15), else the proposal's person.
    const personOf = (row: Row): string => row.makerPersonId ?? userId;
    const persons = [...new Set(rows.map(personOf))];
    const keyIds = [...new Set(rows.flatMap((r) => (r.makerKind === 'key' && r.keyId ? [r.keyId] : [])))];
    const hasApps = rows.some((r) => r.makerKind === 'app');
    const [grants, keys] = await guarded(operation, () => Promise.all([
      hasApps
        ? this.db.select({ userId: oauthConsent.userId, clientId: oauthConsent.clientId, name: oauthClient.name }).from(oauthConsent)
          .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
          .where(and(inArray(oauthConsent.userId, persons), or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false))))
        : Promise.resolve([]),
      keyIds.length > 0
        ? this.db.select({ id: apiKeys.id, userId: apiKeys.userId, name: apiKeys.name, revokedAt: apiKeys.revokedAt }).from(apiKeys)
          .where(and(inArray(apiKeys.userId, persons), inArray(apiKeys.id, keyIds)))
        : Promise.resolve([]),
    ]));
    const appsOn = new Set(grants.map((g) => `${g.userId} ${makerKey(appMaker(g.name ?? '', g.clientId))}`));
    const keysById = new Map(keys.map((k) => [k.id, k]));
    return rows.map((row): ProposalEntry => {
      const madeBy = makerOfRow(row);
      const person = personOf(row);
      const found = madeBy.kind === 'key' ? keysById.get(madeBy.keyId) : undefined;
      const key = found?.userId === person ? found : undefined;
      return {
        id: row.id, userId: row.userId, kind: row.kind, accountId: row.accountId, partnerId: row.partnerId, marketId: row.marketId,
        hypothesisId: row.hypothesisId, status: row.status, createdAt: row.createdAt, answeredAt: row.answeredAt, expiresAt: row.expiresAt,
        madeBy, fileId: row.fileId,
        agentName: madeBy.kind === 'key' ? cleanAgentName(key?.name ?? '') : madeBy.agentName || COPY.AGENT_FALLBACK_NAME,
        makerOn: madeBy.kind === 'key' ? key !== undefined && key.revokedAt === null : appsOn.has(`${person} ${makerKey(agentOnly(madeBy))}`),
      };
    });
  }
}
