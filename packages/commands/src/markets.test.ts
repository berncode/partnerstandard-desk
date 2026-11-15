import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '@partner-desk/storage';
import type { Actor } from './actor';
import { archiveMarket, changeMarket, copyMarket, createMarket, importExclusions, listMarkets, readMarket } from './markets';
import { importPartners, readPartners } from './partners';
import { DuplicateEntry } from './directory';
import { FORBIDDEN } from './result';
import { makeTestDeps } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const info = { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' } as const;

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' });
  deps.events.events.length = 0;
  return deps;
}

describe('createMarket', () => {
  it('creates a market and lists it in the directory', async () => {
    const deps = await setup();
    const r = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.marketId).toMatch(/^m_[0-9a-z]{10}$/);
    expect(r.value.snapshot.value.info).toMatchObject({ marketName: 'Austria', companyId: 'co_aaaaaaaaaa', updatedBy: 'Ruth' });
    expect(await deps.directory.markets('co_aaaaaaaaaa')).toEqual([{ marketId: r.value.marketId, displayName: 'Austria · Reseller', ownerUserId: 'u1', archived: false }]);
    const read = await readMarket(deps, owner, { marketId: r.value.marketId });
    expect(read.ok && read.value.value.info.marketName).toBe('Austria');
    expect(JSON.stringify(deps.events.events)).not.toContain('Austria');
    expect(deps.events.events[0]).toMatchObject({ command: 'markets.create', entityIds: [r.value.marketId] });
  });

  it('refuses malformed info and other users', async () => {
    const deps = await setup();
    expect(await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info: { marketName: '' } })).toMatchObject({ ok: false, error: 'invalid' });
    const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    expect(await createMarket(deps, other, { companyId: 'co_aaaaaaaaaa', info })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await createMarket(deps, other, { companyId: 'co_bbbbbbbbbb', info })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.directory.markets('co_aaaaaaaaaa')).toEqual([]);
    expect(deps.events.events).toHaveLength(0);
  });
});

describe('changeMarket', () => {
  it('applies a change and stamps the actor', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
    const r = await changeMarket(deps, agent, {
      marketId: created.value.marketId,
      change: { kind: 'add', entity: 'exclusion', values: { company: 'Evil Inc', website: '', reason: 'no' } },
    });
    expect(r.ok && r.value.snapshot.value.exclusions[0]).toMatchObject({ updatedBy: 'Desk Agent for Ruth' });
    expect(JSON.stringify(deps.events.events)).not.toContain('Evil');
  });

  it('keeps the directory name in step when the market is renamed, and refuses a partner type change', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const { marketId } = created.value;
    const names = async () => (await deps.directory.markets('co_aaaaaaaaaa')).map((m) => m.displayName);
    expect(await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { marketName: 'Germany' } } })).toMatchObject({ ok: true });
    expect(await names()).toEqual(['Germany · Reseller']);
    // A market's partner type is fixed. Changing it is a new market, not a rename.
    expect(await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { partnerType: 'referral' } } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await names()).toEqual(['Germany · Reseller']);
    // Another field leaves the name as it is; the directory isn't asked.
    let renames = 0;
    const rename = deps.directory.rename.bind(deps.directory);
    deps.directory.rename = async (...args) => { renames++; return rename(...args); };
    expect(await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { statement: 'New' } } })).toMatchObject({ ok: true });
    expect(renames).toBe(0);
  });

  it('saves the change when the directory rename fails, and logs ids only', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const { marketId } = created.value;
    const logged: Array<[string, Record<string, string>]> = [];
    deps.log = (event, ids) => { logged.push([event, ids]); };
    deps.directory.rename = async () => { throw new Error('markets_rename_failed'); };
    const r = await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { marketName: 'Secret plan' } } });
    expect(r.ok && r.value.snapshot.value.info.marketName).toBe('Secret plan');
    expect(logged).toEqual([['directory_rename_failed', { marketId }]]);
    expect(JSON.stringify(logged)).not.toContain('Secret');
  });
});

describe('changeMarket and the decisions', () => {
  const agent = (level: 'change' | 'propose'): Actor => ({
    kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' },
  });

  it('changeMarket refuses a change-level agent\'s status change with forbidden, and still saves its text change', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const { marketId } = created.value;
    const hypothesis = await changeMarket(deps, owner, { marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'Banks' } } });
    if (!hypothesis.ok || !hypothesis.value.entityId) throw new Error('setup');
    const hypothesisId = hypothesis.value.entityId;
    deps.events.events.length = 0;
    for (const level of ['change', 'propose'] as const) {
      expect(await changeMarket(deps, agent(level), { marketId, change: { kind: 'updateInfo', patch: { status: 'validated' } } })).toEqual(FORBIDDEN);
      expect(await changeMarket(deps, agent(level), {
        marketId, change: { kind: 'update', entity: 'hypothesis', id: hypothesisId, patch: { status: 'holds' } },
      })).toEqual(FORBIDDEN);
      expect(await changeMarket(deps, agent(level), {
        marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'Insurers', status: 'holds' } },
      })).toEqual(FORBIDDEN);
    }
    expect(deps.events.events).toHaveLength(0);
    const read = await readMarket(deps, owner, { marketId });
    expect(read.ok && read.value.value.info.status).not.toBe('validated');
    expect(read.ok && read.value.value.hypotheses.map((h) => h.status)).toEqual(['draft']);

    const texts = await changeMarket(deps, agent('change'), { marketId, change: { kind: 'updateInfo', patch: { statement: 'Banks in Austria' } } });
    expect(texts.ok && texts.value.snapshot.value.info).toMatchObject({ statement: 'Banks in Austria', updatedBy: 'Desk Agent for Ruth' });
    const hypothesisText = await changeMarket(deps, agent('change'), {
      marketId, change: { kind: 'update', entity: 'hypothesis', id: hypothesisId, patch: { theirSide: 'More margin' } },
    });
    expect(hypothesisText.ok && hypothesisText.value.snapshot.value.hypotheses[0]).toMatchObject({ theirSide: 'More margin', status: 'draft' });
    expect(await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { status: 'validated' } } })).toMatchObject({ ok: true });
  });

  it('createMarket refuses a change or propose agent a market made with a status, writing nothing; without one it works', async () => {
    for (const level of ['change', 'propose'] as const) {
      const deps = await setup();
      for (const decided of [{ ...info, status: 'validated' }, { ...info, statusNote: 'Three banks said yes' }]) {
        expect(await createMarket(deps, agent(level), { companyId: 'co_aaaaaaaaaa', info: decided })).toEqual(FORBIDDEN);
      }
      expect(await deps.directory.markets('co_aaaaaaaaaa')).toEqual([]);
      expect(deps.events.events).toHaveLength(0);
      const made = await createMarket(deps, agent(level), { companyId: 'co_aaaaaaaaaa', info });
      expect(made.ok && made.value.snapshot.value.info).toMatchObject({ status: 'open', updatedBy: 'Desk Agent for Ruth' });
    }
    const deps = await setup();
    const own = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info: { ...info, status: 'validated' } });
    expect(own.ok && own.value.snapshot.value.info.status).toBe('validated');
  });

  it('importExclusions checks each change for an agent', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const { marketId } = created.value;
    const changes = [{ kind: 'add', entity: 'exclusion', values: { company: 'Evil Inc', website: '', reason: 'no' } }];
    const r = await importExclusions(deps, agent('change'), { marketId, changes });
    expect(r.ok && r.value.snapshot.value.exclusions).toHaveLength(1);
    const reader: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } };
    expect(await importExclusions(deps, reader, { marketId, changes })).toEqual(FORBIDDEN);
  });
});

describe('market event ids', () => {
  it('holds the changed row id for an update and a delete', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const marketId = created.value.marketId;
    const added = await changeMarket(deps, owner, { marketId, change: { kind: 'add', entity: 'exclusion', values: { company: 'Evil Inc', website: '', reason: 'no' } } });
    if (!added.ok || !added.value.entityId) throw new Error('setup');
    const rowId = added.value.entityId;
    deps.events.events.length = 0;
    await changeMarket(deps, owner, { marketId, change: { kind: 'update', entity: 'exclusion', id: rowId, patch: { reason: 'later' } } });
    await changeMarket(deps, owner, { marketId, change: { kind: 'delete', entity: 'exclusion', id: rowId } });
    expect(deps.events.events.map((e) => e.entityIds)).toEqual([[marketId, rowId], [marketId, rowId]]);
  });
});

describe('copyMarket', () => {
  it('registers the copy under the directory company, not the one in the file', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const entry = (await deps.directory.market(created.value.marketId))!;
    // A hand edit of the file's company must not move the copy.
    (deps.markets as unknown as { files: Map<string, { info: { companyId: string } }> }).files.get(entry.fileId)!.info.companyId = 'co_bbbbbbbbbb';
    const r = await copyMarket(deps, owner, { marketId: created.value.marketId, info: { marketName: 'Germany', partnerType: 'reseller' } });
    expect(r.ok && r.value.snapshot.value.info.companyId).toBe('co_aaaaaaaaaa');
    expect(await deps.directory.markets('co_bbbbbbbbbb')).toEqual([]);
  });

  it('copies a market under a new id', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const r = await copyMarket(deps, owner, { marketId: created.value.marketId, info: { marketName: 'Germany', partnerType: 'reseller' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.marketId).not.toBe(created.value.marketId);
    expect(r.value.snapshot.value.info).toMatchObject({ marketName: 'Germany', copiedFrom: 'Austria · Reseller', companyId: 'co_aaaaaaaaaa' });
    expect((await deps.directory.markets('co_aaaaaaaaaa')).map((m) => m.marketId)).toContain(r.value.marketId);
    expect(deps.events.events.at(-1)).toMatchObject({ command: 'markets.copy', entityIds: [r.value.marketId, created.value.marketId] });
  });

  it('says the file is missing for an unknown market', async () => {
    const deps = await setup();
    expect(await readMarket(deps, owner, { marketId: 'm_nope' })).toMatchObject({ ok: false, error: 'file_not_found' });
  });
});

describe('who may touch a market', () => {
  const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
  const reader: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } };
  const exclusion = { kind: 'add', entity: 'exclusion', values: { company: 'Evil Inc', website: '', reason: 'no' } } as const;

  async function withMarket() {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    deps.events.events.length = 0;
    return { deps, marketId: created.value.marketId };
  }

  it('answers a stranger as if the file did not exist, for read, change, copy and import', async () => {
    const { deps, marketId } = await withMarket();
    const gone = { ok: false, error: 'file_not_found', message: COPY.NOT_FOUND_FILE };
    expect(await readMarket(deps, stranger, { marketId })).toEqual(gone);
    expect(await changeMarket(deps, stranger, { marketId, change: exclusion })).toEqual(gone);
    expect(await copyMarket(deps, stranger, { marketId, info: { marketName: 'Germany', partnerType: 'reseller' } })).toEqual(gone);
    const add = { kind: 'add', entity: 'partner', values: { accountId: 'a_acme', partnerType: 'reseller' } };
    expect(await importPartners(deps, stranger, { companyId: 'co_bbbbbbbbbb', marketId, changes: [add] })).toEqual(gone);
    expect(await importPartners(deps, stranger, { companyId: 'co_aaaaaaaaaa', marketId, changes: [add] })).toEqual(FORBIDDEN);
    expect(deps.events.events).toHaveLength(0);
  });

  it('refuses an agent that may only read: change, copy and create', async () => {
    const { deps, marketId } = await withMarket();
    expect(await changeMarket(deps, reader, { marketId, change: exclusion })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await copyMarket(deps, reader, { marketId, info: { marketName: 'Germany', partnerType: 'reseller' } })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await createMarket(deps, reader, { companyId: 'co_aaaaaaaaaa', info })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deps.events.events).toHaveLength(0);
    expect(await deps.directory.markets('co_aaaaaaaaaa')).toHaveLength(1);
  });
});

describe('field errors', () => {
  it('names a typed value that is wrong, in our words', async () => {
    const deps = await setup();
    const r = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info: { ...info, marketName: ' ' } });
    expect(r).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { marketName: COPY.REQUIRED('Market') } });
  });
  it('gives no zod text or "_" key for a malformed input', async () => {
    const deps = await setup();
    const r = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info: { ...info, nonsense: 1 } });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
    expect(r.ok ? null : r.fieldErrors).toBeUndefined();
    const missing = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info: { marketName: 'x' } });
    expect(missing.ok ? null : missing.fieldErrors).toBeUndefined();
    const copy = await copyMarket(deps, owner, { marketId: 'm_x', info: { marketName: 'x', partnerType: 'nope' } });
    expect(copy.ok ? null : copy.fieldErrors).toBeUndefined();
    expect(await copyMarket(deps, owner, { info: {} })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('listMarkets', () => {
  const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });

  it('lists the owner\'s markets and records no event for the read', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    deps.events.events.length = 0;
    const r = await listMarkets(deps, owner, { companyId: 'co_aaaaaaaaaa' });
    expect(r).toEqual({ ok: true, value: [{ marketId: created.value.marketId, displayName: 'Austria · Reseller', ownerUserId: 'u1', archived: false }] });
    expect(deps.events.events).toEqual([]);
  });

  it('refuses another company’s id, gives a company with no markets none, and calls a bad id invalid', async () => {
    const deps = await setup();
    await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    expect(await listMarkets(deps, other, { companyId: 'co_aaaaaaaaaa' })).toEqual(FORBIDDEN);
    expect(await listMarkets(deps, owner, { companyId: 'co_bbbbbbbbbb' })).toEqual(FORBIDDEN);
    expect(await listMarkets(deps, other, { companyId: 'co_bbbbbbbbbb' })).toEqual({ ok: true, value: [] });
    expect(await listMarkets(deps, owner, { companyId: 'x' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('lets the owner\'s agent read at every level', async () => {
    const deps = await setup();
    await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    for (const level of ['read', 'change', 'propose'] as const) {
      const r = await listMarkets(deps, agent(level), { companyId: 'co_aaaaaaaaaa' });
      expect(r.ok && r.value).toHaveLength(1);
    }
  });
});

describe('archiveMarket', () => {
  const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };

  async function withMarket() {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    deps.events.events.length = 0;
    return { deps, marketId: created.value.marketId };
  }

  it('archives and unarchives a market in the directory, with an id-only event', async () => {
    const { deps, marketId } = await withMarket();
    expect(await archiveMarket(deps, owner, { marketId, archived: true })).toEqual({ ok: true, value: { marketId, archived: true } });
    expect(await deps.directory.markets('co_aaaaaaaaaa')).toEqual([expect.objectContaining({ marketId, archived: true })]);
    expect(deps.events.events).toEqual([expect.objectContaining({ command: 'markets.archive', entityIds: [marketId] })]);
    expect(await archiveMarket(deps, owner, { marketId, archived: false })).toEqual({ ok: true, value: { marketId, archived: false } });
    expect(await deps.directory.markets('co_aaaaaaaaaa')).toEqual([expect.objectContaining({ marketId, archived: false })]);
    expect(JSON.stringify(deps.events.events)).not.toContain('Austria');
  });

  it('archives a market whose file is gone: it never reads the file', async () => {
    const { deps, marketId } = await withMarket();
    const entry = await deps.directory.market(marketId);
    await deps.markets.discard({ fileId: entry!.fileId });
    expect(await archiveMarket(deps, owner, { marketId, archived: true })).toMatchObject({ ok: true });
  });

  it('refuses another person (as if there were no such market), an agent, an unknown id and bad input', async () => {
    const { deps, marketId } = await withMarket();
    const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    expect(await archiveMarket(deps, other, { marketId, archived: true })).toEqual({ ok: false, error: 'file_not_found', message: COPY.NOT_FOUND_FILE });
    expect(await archiveMarket(deps, agent, { marketId, archived: true })).toEqual({ ok: false, error: 'forbidden', message: COPY.FORBIDDEN });
    expect(await archiveMarket(deps, owner, { marketId: 'm_none', archived: true })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await archiveMarket(deps, owner, { marketId, archived: 'yes' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await archiveMarket(deps, owner, { marketId })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await deps.directory.markets('co_aaaaaaaaaa')).toEqual([expect.objectContaining({ archived: false })]);
    expect(deps.events.events).toEqual([]);
  });
});

describe('the memory directory', () => {
  it('refuses a second book for a company and a repeated market id', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    await deps.directory.addPartnerBook({ companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f1' });
    await expect(deps.directory.addPartnerBook({ companyId: 'co_aaaaaaaaaa', ownerUserId: 'u2', fileId: 'f2' })).rejects.toBeInstanceOf(DuplicateEntry);
    const m = { marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f3', displayName: 'A' };
    await deps.directory.addMarket(m);
    await expect(deps.directory.addMarket({ ...m, fileId: 'f4' })).rejects.toBeInstanceOf(DuplicateEntry);
    expect(deps.directory.books.get('co_aaaaaaaaaa')).toEqual({ fileId: 'f1', ownerUserId: 'u1' });
  });
});

describe('a market file Google can’t make', () => {
  for (const [code, message] of [['auth', COPY.AUTH_MESSAGE], ['quota', COPY.QUOTA_MESSAGE]] as const) {
    it(`answers create and copy with the ${code} message, not an error page`, async () => {
      const deps = await setup();
      const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
      if (!created.ok) throw new Error('setup');
      deps.events.events.length = 0;
      deps.markets.create = async () => { throw new StoreFailure(code, message); };
      expect(await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info })).toEqual({ ok: false, error: code, message });
      expect(await copyMarket(deps, owner, { marketId: created.value.marketId, info: { marketName: 'Germany', partnerType: 'reseller' } }))
        .toEqual({ ok: false, error: code, message });
      expect((await deps.directory.markets('co_aaaaaaaaaa')).map((m) => m.marketId)).toEqual([created.value.marketId]);
      expect(deps.events.events).toHaveLength(0);
    });
  }
});

describe('market ids from the directory, not from _meta', () => {
  it('reads the market and company ids the directory names, whatever _meta says', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const entry = (await deps.directory.market(created.value.marketId))!;
    const file = (deps.markets as unknown as { files: Map<string, { info: { companyId: string; marketId: string } }> }).files.get(entry.fileId)!;
    file.info.companyId = 'co_bbbbbbbbbb';
    file.info.marketId = 'm_bbbbbbbbbb';
    const r = await readMarket(deps, owner, { marketId: created.value.marketId });
    expect(r.ok && r.value.value.info).toMatchObject({ marketId: created.value.marketId, companyId: 'co_aaaaaaaaaa' });
  });
});

describe('readMarket', () => {
  it('answers the link that opens the market’s file', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const entry = (await deps.directory.market(created.value.marketId))!;
    const r = await readMarket(deps, owner, { marketId: created.value.marketId });
    expect(r.ok && r.value.fileUrl).toBe(deps.markets.urlFor({ fileId: entry.fileId }));
  });
});

describe('importExclusions', () => {
  const exclusion = (company: string) => ({ kind: 'add', entity: 'exclusion', values: { company, website: '', reason: 'Existing partner' } });

  it('adds every exclusion in one write, and the event names ids only', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const { marketId } = created.value;
    deps.events.events.length = 0;
    const r = await importExclusions(deps, owner, { marketId, changes: [exclusion('Tauern Systems'), exclusion('Murtal EDV')] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.snapshot.value.exclusions.map((x) => x.company)).toEqual(['Tauern Systems', 'Murtal EDV']);
    expect(r.value.entityIds).toHaveLength(2);
    expect(deps.events.events).toEqual([expect.objectContaining({ command: 'markets.change', entityIds: [marketId, ...r.value.entityIds] })]);
    expect(JSON.stringify(deps.events.events)).not.toContain('Tauern');
  });

  it('takes only adds of exclusions, and nothing is written when one is refused', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const { marketId } = created.value;
    const point = { kind: 'add', entity: 'valuePoint', values: { kind: 'portfolio', text: 'Fills a gap' } };
    expect(await importExclusions(deps, owner, { marketId, changes: [exclusion('A'), point] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await importExclusions(deps, owner, { marketId, changes: [] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await importExclusions(deps, owner, { marketId, changes: [exclusion('A'), exclusion('')] })).toMatchObject({ ok: false, error: 'invalid' });
    const read = await readMarket(deps, owner, { marketId });
    expect(read.ok && read.value.value.exclusions).toEqual([]);
  });

  it('refuses someone else’s market as if it weren’t there, and an agent that may only read', async () => {
    const deps = await setup();
    const created = await createMarket(deps, owner, { companyId: 'co_aaaaaaaaaa', info });
    if (!created.ok) throw new Error('setup');
    const { marketId } = created.value;
    const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    expect(await importExclusions(deps, stranger, { marketId, changes: [exclusion('A')] })).toMatchObject({ ok: false, error: 'file_not_found' });
    const reader: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } };
    expect(await importExclusions(deps, reader, { marketId, changes: [exclusion('A')] })).toMatchObject({ ok: false, error: 'forbidden' });
  });
});
