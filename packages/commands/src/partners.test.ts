import { describe, expect, it } from 'vitest';
import { fillEmpty, type PartnerBook } from '@partner-desk/core';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { StoreFailure } from '@partner-desk/storage';
import { withProposal, type Actor } from './actor';
import { changePartner, importPartners, readPartners, recreatePartnerBook, removePartnerType } from './partners';
import { FORBIDDEN } from './result';
import { makeTestDeps, TEST_NOW } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';
/** A partner add the parser accepts. The account does not have to exist until the change is applied. */
const add = { kind: 'add', entity: 'partner', values: { accountId: 'a_acme', partnerType: 'reseller', whyItFits: 'Acme' } } as const;

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  await readPartners(deps, owner, { companyId });
  deps.events.events.length = 0;
  return deps;
}

type TestDeps = Awaited<ReturnType<typeof setup>>;

async function addAccount(deps: TestDeps, company = 'Acme') {
  const added = await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company } } });
  if (!added.ok || !added.value.entityId) throw new Error('setup');
  const account = added.value.snapshot.value.accounts.find((a) => a.id === added.value.entityId);
  if (!account) throw new Error('setup');
  return account;
}

async function addSection(deps: TestDeps, whyItFits = 'Acme') {
  const account = await addAccount(deps);
  const added = await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.id, partnerType: 'reseller', whyItFits } },
  });
  if (!added.ok || !added.value.entityId) throw new Error('setup');
  return { account, partnerId: added.value.entityId };
}

describe('changePartner', () => {
  it('records an event with ids only', async () => {
    const deps = await setup();
    const account = await addAccount(deps);
    deps.events.events.length = 0;
    const r = await changePartner(deps, owner, {
      companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.id, partnerType: 'reseller', whyItFits: 'Acme' } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(deps.events.events);
    expect(json).toContain(r.value.entityId);
    expect(json).toContain(deps.directory.books.get(companyId)!.fileId);
    expect(json).not.toContain('Acme');
    expect(deps.events.events).toHaveLength(1);
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.change', actorKind: 'owner', actorUserId: 'u1', at: TEST_NOW });
  });

  it('a setStep change records an event with change setStep and the partner id only', async () => {
    const deps = await setup();
    const { partnerId } = await addSection(deps, 'Secret reason');
    deps.events.events.length = 0;
    const r = await changePartner(deps, owner, { companyId, change: { kind: 'setStep', partnerId, to: 'discovery_call' } });
    expect(r.ok).toBe(true);
    expect(deps.events.events).toHaveLength(1);
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.change', change: 'setStep', entityIds: [partnerId] });
    expect(JSON.stringify(deps.events.events)).not.toContain('discovery_call');
    expect(JSON.stringify(deps.events.events)).not.toContain('Secret reason');
    expect(await deps.events.latestByEntity(deps.directory.books.get(companyId)!.fileId, 'setStep')).toEqual({ [partnerId]: TEST_NOW });
  });

  it('stamps the actor', async () => {
    const deps = await setup();
    const account = await addAccount(deps);
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
    const r = await changePartner(deps, agent, {
      companyId, change: { kind: 'add', entity: 'person', values: { accountId: account.id, name: 'Lena Ortiz' } },
    });
    expect(r.ok && r.value.snapshot.value.people[0]).toMatchObject({ updatedBy: 'Desk Agent for Ruth', updatedAt: TEST_NOW });
    // Adding a partner is a decision: an agent proposes it, and the person accepting it is stamped with the agent's name.
    const add = { kind: 'add', entity: 'partner', values: { accountId: account.id, partnerType: 'reseller' } } as const;
    expect(await changePartner(deps, agent, { companyId, change: add })).toEqual(FORBIDDEN);
    const accepting = withProposal({ kind: 'owner', userId: 'u1', displayName: 'Ruth' }, { id: 'pr_1', agentName: 'Claude' });
    const accepted = await changePartner(deps, accepting, { companyId, change: add });
    expect(accepted.ok && accepted.value.snapshot.value.partners[0]).toMatchObject({ updatedBy: 'Ruth, proposed by Desk Agent', updatedAt: TEST_NOW });
  });

  it('refuses malformed input as invalid without touching the store', async () => {
    const deps = await setup();
    let touched = false;
    deps.partnerBooks.apply = async () => { touched = true; throw new Error('no'); };
    const r = await changePartner(deps, owner, { companyId: 'co_aaaaaaaaaa', change: { kind: 'nonsense' } });
    expect(r).toMatchObject({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS });
    const r2 = await changePartner(deps, owner, { companyId: '', change: add });
    expect(r2).toMatchObject({ ok: false, error: 'invalid' });
    expect(touched).toBe(false);
    expect(deps.events.events).toHaveLength(0);
  });

  it('passes a conflict through', async () => {
    const deps = await setup();
    const { partnerId } = await addSection(deps);
    deps.events.events.length = 0;
    const r = await changePartner(deps, owner, {
      companyId,
      change: { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'x' }, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(r).toMatchObject({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    expect(deps.events.events).toHaveLength(0);
  });

  it('refuses another user the company and records nothing', async () => {
    const deps = await setup();
    const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    const r = await changePartner(deps, other, { companyId: 'co_aaaaaaaaaa', change: add });
    expect(r).toEqual({ ok: false, error: 'forbidden', message: COPY.FORBIDDEN });
    expect(await readPartners(deps, other, { companyId: 'co_aaaaaaaaaa' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deps.events.events).toHaveLength(0);
  });

  it('refuses an agent that may only read, and an agent signing', async () => {
    const deps = await setup();
    const reader: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } };
    expect(await changePartner(deps, reader, { companyId: 'co_aaaaaaaaaa', change: add })).toMatchObject({ ok: false, error: 'forbidden' });
    const changer: Actor = { ...reader, level: 'change' };
    const sign = { kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-01-01' } as const;
    expect(await changePartner(deps, changer, { companyId: 'co_aaaaaaaaaa', change: sign })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deps.events.events).toHaveLength(0);
  });

  it('refuses an agent undoing a signing or correcting an exit, and writes nothing', async () => {
    const deps = await setup();
    const signed = await addSection(deps);
    const exited = await addSection(deps, 'Beta');
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: signed.partnerId, signedDate: '2026-01-01' } })).ok).toBe(true);
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: exited.partnerId, signedDate: '2026-01-01' } })).ok).toBe(true);
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'markExited', partnerId: exited.partnerId, exitedDate: '2026-02-01', reason: 'Went direct' } })).ok).toBe(true);
    deps.events.events.length = 0;
    const fileId = deps.directory.books.get(companyId)!.fileId;
    const before = await deps.partnerBooks.read({ fileId });
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
    expect(await changePartner(deps, agent, { companyId, change: { kind: 'undoSigned', partnerId: signed.partnerId } })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await changePartner(deps, agent, {
      companyId, change: { kind: 'correctExit', partnerId: exited.partnerId, exitedDate: '2026-03-01', reason: 'Chose another vendor' },
    })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await deps.partnerBooks.read({ fileId })).toEqual(before);
    expect(deps.events.events).toHaveLength(0);
  });

  it('lets the owner undo a signing and correct an exit', async () => {
    const deps = await setup();
    const { partnerId } = await addSection(deps);
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-01-01' } })).ok).toBe(true);
    const undone = await changePartner(deps, owner, { companyId, change: { kind: 'undoSigned', partnerId } });
    expect(undone.ok && undone.value.snapshot.value.partners[0]).toMatchObject({ signedDate: null, stage: 'recruitment', step: 'map' });
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-01-01' } })).ok).toBe(true);
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'markExited', partnerId, exitedDate: '2026-02-01', reason: 'Went direct' } })).ok).toBe(true);
    deps.events.events.length = 0;
    const corrected = await changePartner(deps, owner, {
      companyId, change: { kind: 'correctExit', partnerId, exitedDate: '2026-03-01', reason: 'Chose another vendor' },
    });
    expect(corrected.ok && corrected.value.snapshot.value.partners[0]).toMatchObject({ exitedDate: '2026-03-01', exitReason: 'Chose another vendor' });
    expect(deps.events.events).toHaveLength(1);
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.change', entityIds: [partnerId] });
  });

  it('keeps an add\'s own id, and refuses a second add with that id', async () => {
    const deps = await setup();
    const added = await changePartner(deps, owner, {
      companyId, change: { kind: 'add', entity: 'account', values: { id: 'a_kept', company: 'Kept' } },
    });
    expect(added.ok && added.value.entityId).toBe('a_kept');
    expect(added.ok && added.value.snapshot.value.accounts.map((a) => a.id)).toEqual(['a_kept']);
    const section = await changePartner(deps, owner, {
      companyId, change: { kind: 'add', entity: 'partner', values: { id: 'p_kept', accountId: 'a_kept', partnerType: 'reseller' } },
    });
    expect(section.ok && section.value.entityId).toBe('p_kept');
    expect(section.ok && section.value.snapshot.value.partners.map((p) => p.id)).toEqual(['p_kept']);
    const again = await changePartner(deps, owner, {
      companyId, change: { kind: 'add', entity: 'account', values: { id: 'a_kept', company: 'Other' } },
    });
    expect(again).toMatchObject({ ok: false, error: 'invalid', message: COPY.ID_TAKEN, fieldErrors: { id: COPY.ID_TAKEN } });
  });

  it('says the file is missing for a company with no book', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    const r = await changePartner(deps, owner, { companyId: 'co_aaaaaaaaaa', change: add });
    expect(r).toEqual({ ok: false, error: 'file_not_found', message: COPY.NOT_FOUND_FILE });
  });
});

describe('events for update and delete', () => {
  it('holds the deleted row id and no content', async () => {
    const deps = await setup();
    const { partnerId } = await addSection(deps);
    deps.events.events.length = 0;
    const upd = await changePartner(deps, owner, { companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'secret' } } });
    expect(upd.ok).toBe(true);
    const del = await changePartner(deps, owner, { companyId, change: { kind: 'delete', entity: 'partner', id: partnerId } });
    expect(del.ok).toBe(true);
    expect(deps.events.events.map((e) => e.entityIds)).toEqual([[partnerId], [partnerId]]);
    expect(JSON.stringify(deps.events.events)).not.toMatch(/Acme|secret/);
  });
});

describe('market links', () => {
  const link = (marketId: string) => ({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_x', marketId, hypothesisId: null } }) as const;
  it('refuses a single link to a market of another company or owner, or one that is unknown', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_other', companyId: 'co_bbbbbbbbbb', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    await deps.directory.addMarket({ marketId: 'm_theirs', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u2', fileId: 'f', displayName: 'x' });
    for (const m of ['m_other', 'm_theirs', 'm_unknown']) {
      expect(await changePartner(deps, owner, { companyId: 'co_aaaaaaaaaa', change: link(m) })).toMatchObject({ ok: false, error: 'file_not_found' });
    }
    expect(deps.events.events).toHaveLength(0);
  });
  it('refuses an import that links to a market other than its own, writing nothing', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const r = await importPartners(deps, owner, { companyId: 'co_aaaaaaaaaa', marketId: 'm_1', changes: [add, link('m_other')] });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
    expect(deps.events.events).toHaveLength(0);
    const book = await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' });
    expect(book.ok && book.value.value.partners).toEqual([]);
  });
});

describe('readPartners', () => {
  it('refuses a company id of the wrong shape', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    expect(await readPartners(deps, owner, { companyId: 'co_1' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await readPartners(deps, owner, { companyId: 'CO_AAAAAAAAAA' })).toMatchObject({ ok: false, error: 'invalid' });
  });
  it('does not let an agent create the book', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
    expect(await readPartners(deps, agent, { companyId: 'co_aaaaaaaaaa' })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(deps.directory.books.size).toBe(0);
  });
  it('creates the partner book on the first read, once', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    const a = await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' });
    const first = deps.directory.books.get('co_aaaaaaaaaa')!.fileId;
    const b = await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' });
    expect(a.ok && a.value.value.partners).toEqual([]);
    expect(b.ok).toBe(true);
    expect(deps.directory.books.size).toBe(1);
    expect(deps.directory.books.get('co_aaaaaaaaaa')!.fileId).toBe(first);
    expect(deps.directory.books.get('co_aaaaaaaaaa')!.ownerUserId).toBe('u1');
  });
});

describe('importPartners', () => {
  it('applies the batch as one write and records the new ids', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1',
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'tmp_a', company: 'Acme' } },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_p1', accountId: 'tmp_a', partnerType: 'reseller', whyItFits: 'Acme' } },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_p2', accountId: 'tmp_a', partnerType: 'referral' } },
      ],
    });
    expect(r.ok && r.value.entityIds).toHaveLength(3);
    expect(r.ok && r.value.snapshot.value.partners).toHaveLength(2);
    const json = JSON.stringify(deps.events.events);
    expect(json).not.toContain('Acme');
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.import' });
  });

  it('refuses a market of another company or an empty batch', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_bbbbbbbbbb', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    expect(await importPartners(deps, owner, { companyId: 'co_aaaaaaaaaa', marketId: 'm_1', changes: [add] })).toMatchObject({ ok: false, error: 'file_not_found' });
    await deps.directory.addMarket({ marketId: 'm_2', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    expect(await importPartners(deps, owner, { companyId: 'co_aaaaaaaaaa', marketId: 'm_2', changes: [] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(deps.events.events).toHaveLength(0);
  });

  it('says how many changes came before one it couldn’t read, writing nothing', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1',
      changes: [
        { kind: 'add', entity: 'account', values: { company: 'Acme' } },
        { kind: 'add', entity: 'account', values: { company: '' } },
      ],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid', valid: 1, fieldErrors: { company: expect.any(String) } });
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.accounts).toHaveLength(0);
    expect(book.ok && book.value.value.partners).toHaveLength(0);
    expect(deps.events.events.filter((e) => e.command === 'partners.import')).toHaveLength(0);
  });

  it('refuses a batch that holds a decision or a delete, and a read-only agent', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
    const r = await importPartners(deps, agent, {
      companyId: 'co_aaaaaaaaaa', marketId: 'm_1', changes: [add, { kind: 'close', partnerId: 'p_1', as: 'no', reason: 'x' }],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
    const del = await importPartners(deps, agent, {
      companyId: 'co_aaaaaaaaaa', marketId: 'm_1', changes: [add, { kind: 'delete', entity: 'partner', id: 'p_1' }],
    });
    expect(del).toMatchObject({ ok: false, error: 'invalid' });
    const reader: Actor = { ...agent, level: 'read' };
    expect(await importPartners(deps, reader, { companyId: 'co_aaaaaaaaaa', marketId: 'm_1', changes: [add] })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deps.events.events).toHaveLength(0);
  });

  it('never records a caller-chosen provisional id in the event', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const r = await importPartners(deps, owner, {
      companyId: 'co_aaaaaaaaaa', marketId: 'm_1',
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'Acme GmbH', company: 'Acme GmbH' } },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_p', accountId: 'Acme GmbH', partnerType: 'reseller' } },
        { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_p', marketId: 'm_1', hypothesisId: null } },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.entityIds).toHaveLength(3);
    expect(r.ok && r.value.entityIds.every((e) => e !== null && e !== 'Acme GmbH' && e !== 'tmp_p')).toBe(true);
    expect(JSON.stringify(deps.events.events)).not.toContain('Acme GmbH');
  });

  it('refuses a partner update, a delete or a decision in a batch, writing nothing', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const { partnerId } = await addSection(deps);
    deps.events.events.length = 0;
    for (const other of [
      { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'x' } },
      { kind: 'delete', entity: 'partner', id: partnerId },
      { kind: 'close', partnerId, as: 'no', reason: 'x' },
    ]) {
      expect(await importPartners(deps, owner, { companyId, marketId: 'm_1', changes: [add, other] })).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(deps.events.events).toHaveLength(0);
    const book = await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' });
    expect(book.ok && book.value.value.partners).toHaveLength(1);
  });

  it('passes the count of valid changes through on a refused batch', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId: 'co_aaaaaaaaaa', ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    // The same provisional id twice: the store refuses the third change, after two good ones.
    const partner = (partnerType: 'reseller' | 'referral') => ({
      kind: 'add', entity: 'partner', values: { id: 'tmp_a', accountId: 'tmp_acct', partnerType },
    });
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1',
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'tmp_acct', company: 'A' } },
        partner('reseller'),
        partner('referral'),
      ],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid', valid: 2 });
    expect(deps.events.events).toHaveLength(0);
  });

  it('refuses an account update that goes beyond filling empty fields', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId, ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const account = await addAccount(deps);
    const filled = await changePartner(deps, owner, {
      companyId, change: { kind: 'update', entity: 'account', id: account.id, patch: { country: 'Austria' } },
    });
    if (!filled.ok) throw new Error('setup');
    const current = filled.value.snapshot.value.accounts.find((a) => a.id === account.id);
    if (!current) throw new Error('setup');
    deps.events.events.length = 0;
    const patch = { country: 'Germany', website: 'acme.com' };
    expect(fillEmpty(current, patch)).toEqual({ website: 'acme.com' });
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1', changes: [{ kind: 'update', entity: 'account', id: account.id, patch }],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
    expect(deps.events.events).toHaveLength(0);
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.accounts[0]).toMatchObject({ country: 'Austria', website: '' });
  });

  it('refuses an account update when that company is not in the book', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId, ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1',
      changes: [{ kind: 'update', entity: 'account', id: 'a_missing', patch: { website: 'acme.com' } }],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
    expect(deps.events.events).toHaveLength(0);
  });

  it('applies an account update that only fills empty fields, in one write', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId, ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const account = await addAccount(deps);
    deps.events.events.length = 0;
    const patch = fillEmpty(account, { website: 'acme.com', country: 'Austria', targetCustomerType: 'smb' });
    expect(patch).toEqual({ website: 'acme.com', country: 'Austria', targetCustomerType: 'smb' });
    const real = deps.partnerBooks;
    let many = 0;
    let single = 0;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      apply: async (...args) => { single++; return real.apply(...args); },
      applyMany: async (...args) => { many++; return real.applyMany(...args); },
    };
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1',
      changes: [{ kind: 'update', entity: 'account', id: account.id, patch, expectedUpdatedAt: account.updatedAt }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(many).toBe(1);
    expect(single).toBe(0);
    expect(r.value.snapshot.value.accounts[0]).toMatchObject({
      company: 'Acme', website: 'acme.com', country: 'Austria', targetCustomerType: 'smb',
    });
    expect(deps.events.events).toHaveLength(1);
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.import', entityIds: ['m_1', account.id] });
    expect(JSON.stringify(deps.events.events)).not.toContain('acme.com');
  });

  it('fills empty fields and adds the new partner type in the same write', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId, ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const { account } = await addSection(deps);
    deps.events.events.length = 0;
    const patch = fillEmpty(account, { website: 'acme.com' });
    const real = deps.partnerBooks;
    let many = 0;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      applyMany: async (...args) => { many++; return real.applyMany(...args); },
    };
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1',
      changes: [
        { kind: 'update', entity: 'account', id: account.id, patch, expectedUpdatedAt: account.updatedAt },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_p', accountId: account.id, partnerType: 'referral' } },
        { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_p', marketId: 'm_1', hypothesisId: null } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(many).toBe(1);
    expect(r.value.snapshot.value.accounts[0]).toMatchObject({ website: 'acme.com' });
    expect(r.value.snapshot.value.partners.map((p) => p.partnerType).sort()).toEqual(['referral', 'reseller']);
    expect(r.value.snapshot.value.marketLinks).toHaveLength(1);
    const json = JSON.stringify(deps.events.events);
    expect(json).not.toContain('tmp_p');
    expect(json).not.toContain('acme.com');
    expect(r.value.entityIds[1]).toEqual(expect.any(String));
    expect(deps.events.events[0]!.entityIds).toEqual(['m_1', account.id, r.value.entityIds[1], r.value.entityIds[2]]);
  });

  it('refuses the fill when the company was saved since the preview, and writes nothing', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId, ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const account = await addAccount(deps);
    deps.events.events.length = 0;
    const patch = fillEmpty(account, { website: 'acme.com' });
    const r = await importPartners(deps, owner, {
      companyId, marketId: 'm_1',
      changes: [{ kind: 'update', entity: 'account', id: account.id, patch, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }],
    });
    expect(r).toMatchObject({ ok: false, error: 'conflict' });
    expect(deps.events.events).toHaveLength(0);
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.accounts[0]).toMatchObject({ website: '' });
  });

  it('adds a company and its partner type in one write without a market, with no market in the event', async () => {
    const deps = await setup();
    const r = await importPartners(deps, owner, {
      companyId,
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'tmp_a', company: 'Acme' } },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_p', accountId: 'tmp_a', partnerType: 'reseller' } },
      ],
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.value.snapshot.value.accounts).toHaveLength(1);
    expect(r.value.snapshot.value.partners).toMatchObject([{ accountId: r.value.entityIds[0] }]);
    expect(deps.events.events).toHaveLength(1);
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.import', entityIds: [r.value.entityIds[0], r.value.entityIds[1]] });
    expect(JSON.stringify(deps.events.events)).not.toContain('Acme');
  });

  it('refuses a market link in a batch that names no market, writing nothing', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId, ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const r = await importPartners(deps, owner, {
      companyId,
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'tmp_a', company: 'Acme' } },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_p', accountId: 'tmp_a', partnerType: 'reseller' } },
        { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_p', marketId: 'm_1', hypothesisId: null } },
      ],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
    expect(deps.events.events).toHaveLength(0);
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.accounts).toEqual([]);
  });
});

describe('changes beside a change (only the proposals commands pass them)', () => {
  const note = (partnerId: string) => ({ kind: 'add', entity: 'qualification', values: { partnerId, deskNotes: { credibility: 'From the web' } } }) as const;

  it('changePartner writes the change and the changes beside it in one write, all or nothing', async () => {
    const deps = await setup();
    const { partnerId } = await addSection(deps);
    let writes = 0;
    const applyMany = deps.partnerBooks.applyMany.bind(deps.partnerBooks);
    deps.partnerBooks.applyMany = async (...args) => { writes += 1; return applyMany(...args); };
    deps.partnerBooks.apply = async () => { throw new Error('one write only'); };
    const out = await changePartner(deps, owner, {
      companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch: { desk: { credibility: 2 } } },
    }, { with: [note(partnerId)] });
    expect(out).toMatchObject({ ok: true, value: { entityId: partnerId } });
    expect(writes).toBe(1);
    const book = (await readPartners(deps, owner, { companyId }));
    expect(book.ok && book.value.value.partners[0]!.desk.credibility).toBe(2);
    expect(book.ok && book.value.value.qualifications.map((q) => q.deskNotes.credibility)).toEqual(['From the web']);

    // A change the rules refuse writes nothing beside it either.
    const refused = await changePartner(deps, owner, {
      companyId, change: { kind: 'close', partnerId, as: 'no', reason: '  ' },
    }, { with: [note(partnerId)] });
    expect(refused).toMatchObject({ ok: false });
    const after = (await readPartners(deps, owner, { companyId }));
    expect(after.ok && after.value.value.qualifications).toHaveLength(1);
    expect(after.ok && after.value.value.partners[0]!.closed).toBeNull();
  });

  it('a change beside it is judged by can too: an agent can’t slip a decision in', async () => {
    const deps = await setup();
    const { partnerId } = await addSection(deps);
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c1' } };
    expect(await changePartner(deps, agent, {
      companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'x' } },
    }, { with: [{ kind: 'update', entity: 'partner', id: partnerId, patch: { desk: { credibility: 3 } } }] })).toEqual(FORBIDDEN);
  });

  it('importPartners takes more than 100 changes built by an accept; a parsed batch keeps the cap', async () => {
    const deps = await setup();
    await deps.directory.addMarket({ marketId: 'm_1', companyId, ownerUserId: 'u1', fileId: 'f', displayName: 'x' });
    const changes = Array.from({ length: 51 }, (_, i) => [
      { kind: 'add', entity: 'account', values: { id: `tmp_a${i}`, company: `Co ${i}` } },
      { kind: 'add', entity: 'partner', values: { id: `tmp_p${i}`, accountId: `tmp_a${i}`, partnerType: 'reseller' } },
    ]).flat();
    expect(changes).toHaveLength(102);
    expect(await importPartners(deps, owner, { companyId, marketId: 'm_1', changes })).toMatchObject({ ok: false, error: 'invalid' });
    const out = await importPartners(deps, owner, { companyId, marketId: 'm_1', changes }, { with: [] });
    expect(out.ok && out.value.snapshot.value.partners).toHaveLength(51);
    // Still only adds and fills in the batch itself; what goes beside it is the accept's own.
    expect(await importPartners(deps, owner, {
      companyId, marketId: 'm_1', changes: [{ kind: 'delete', entity: 'account', id: 'a_x' }],
    }, { with: [] })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('removePartnerType', () => {
  async function twoTypes(deps: TestDeps) {
    const { account, partnerId } = await addSection(deps);
    const other = await changePartner(deps, owner, {
      companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.id, partnerType: 'technology' } },
    });
    if (!other.ok || !other.value.entityId) throw new Error('setup');
    const person = await changePartner(deps, owner, {
      companyId, change: { kind: 'add', entity: 'person', values: { accountId: account.id, name: 'Eva Roth' } },
    });
    if (!person.ok || !person.value.entityId) throw new Error('setup');
    deps.events.events.length = 0;
    return { account, partnerId, otherId: other.value.entityId, personId: person.value.entityId };
  }
  /** What the screen would send: the ids of the rows it shows going. */
  const remove = (deps: TestDeps, actor: Actor, partnerId: string, expected: string[]) =>
    removePartnerType(deps, actor, { companyId, partnerId, expected });

  it('removes the last partner type, its company and the contacts in one write, and records one event with ids only', async () => {
    const deps = await setup();
    const { account, partnerId, otherId, personId } = await twoTypes(deps);
    expect((await remove(deps, owner, otherId, [otherId])).ok).toBe(true);
    deps.events.events.length = 0;
    let writes = 0;
    const applyMany = deps.partnerBooks.applyMany.bind(deps.partnerBooks);
    deps.partnerBooks.applyMany = async (...args) => { writes += 1; return applyMany(...args); };
    const r = await remove(deps, owner, partnerId, [partnerId, personId, account.id]);
    if (!r.ok) throw new Error(r.message);
    expect(writes).toBe(1);
    expect(r.value.snapshot.value.accounts).toEqual([]);
    expect(r.value.snapshot.value.partners).toEqual([]);
    expect(r.value.snapshot.value.people).toEqual([]);
    expect(r.value.entityIds).toHaveLength(3);
    expect(deps.events.events).toHaveLength(1);
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.remove', entityIds: [partnerId, personId, account.id] });
    expect(JSON.stringify(deps.events.events)).not.toContain('Eva');
  });

  it('keeps the company and its contacts when it has another partner type', async () => {
    const deps = await setup();
    const { account, partnerId, otherId, personId } = await twoTypes(deps);
    const r = await remove(deps, owner, partnerId, [partnerId]);
    if (!r.ok) throw new Error(r.message);
    expect(r.value.snapshot.value.partners.map((p) => p.id)).toEqual([otherId]);
    expect(r.value.snapshot.value.accounts.map((a) => a.id)).toEqual([account.id]);
    expect(r.value.snapshot.value.people.map((p) => p.id)).toEqual([personId]);
    expect(deps.events.events[0]).toMatchObject({ command: 'partners.remove', entityIds: [partnerId] });
  });

  it('answers a conflict and writes nothing when the file has a contact the screen didn’t show', async () => {
    const deps = await setup();
    const { account, partnerId, otherId, personId } = await twoTypes(deps);
    expect((await remove(deps, owner, otherId, [otherId])).ok).toBe(true);
    // Added by hand or in another tab after the page loaded: the screen only knows Eva.
    const extra = await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'person', values: { accountId: account.id, name: 'Max Neu' } } });
    if (!extra.ok) throw new Error('setup');
    deps.events.events.length = 0;
    const r = await remove(deps, owner, partnerId, [partnerId, personId, account.id]);
    expect(r).toEqual({ ok: false, error: 'conflict', message: COPY.SAVE_CONFLICT });
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.people).toHaveLength(2);
    expect(book.ok && book.value.value.partners.map((p) => p.id)).toEqual([partnerId]);
    expect(deps.events.events.filter((e) => e.command === 'partners.remove')).toHaveLength(0);
  });

  it('answers a conflict and writes nothing when the screen shows a contact the file no longer has', async () => {
    const deps = await setup();
    const { account, partnerId, otherId, personId } = await twoTypes(deps);
    expect((await remove(deps, owner, otherId, [otherId])).ok).toBe(true);
    const gone = await changePartner(deps, owner, { companyId, change: { kind: 'delete', entity: 'person', id: personId } });
    if (!gone.ok) throw new Error('setup');
    deps.events.events.length = 0;
    const r = await remove(deps, owner, partnerId, [partnerId, personId, account.id]);
    expect(r).toEqual({ ok: false, error: 'conflict', message: COPY.SAVE_CONFLICT });
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.accounts.map((a) => a.id)).toEqual([account.id]);
    expect(deps.events.events.filter((e) => e.command === 'partners.remove')).toHaveLength(0);
  });

  it('takes no list of changes: the command works out what goes from the file as it is now', async () => {
    const deps = await setup();
    const { partnerId } = await twoTypes(deps);
    const r = await removePartnerType(deps, owner, {
      companyId, partnerId, expected: [partnerId], changes: [{ kind: 'add', entity: 'account', values: { company: 'Sneaky' } }],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
    expect(await removePartnerType(deps, owner, { companyId, partnerId })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await removePartnerType(deps, owner, { companyId, partnerId, expected: Array.from({ length: 1001 }, (_, i) => `e_${i}`) }))
      .toMatchObject({ ok: false, error: 'invalid' });
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.partners).toHaveLength(2);
    expect(deps.events.events.filter((e) => e.command === 'partners.remove')).toHaveLength(0);
  });

  it('refuses an agent at any level, another person and an unknown partner type, writing nothing', async () => {
    const deps = await setup();
    const { partnerId } = await twoTypes(deps);
    for (const level of ['read', 'change', 'propose'] as const) {
      const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } };
      expect(await remove(deps, agent, partnerId, [partnerId])).toMatchObject({ ok: false, error: 'forbidden' });
    }
    const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    expect(await remove(deps, stranger, partnerId, [partnerId])).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await remove(deps, owner, 'p_unknown', ['p_unknown'])).toMatchObject({ ok: false, error: 'not_found' });
    const book = await readPartners(deps, owner, { companyId });
    expect(book.ok && book.value.value.partners).toHaveLength(2);
    expect(deps.events.events.filter((e) => e.command === 'partners.remove')).toHaveLength(0);
  });
});

describe('two first reads at once', () => {
  it('make one book and throw the other file away', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    const created: string[] = [];
    const discarded: string[] = [];
    const real = deps.partnerBooks;
    let n = 0;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      create: async (...args) => {
        const out = await real.create(...args);
        created.push(out.fileId);
        // Both creates finish before either directory write.
        n++;
        while (n < 2) await new Promise((r) => setTimeout(r, 1));
        return out;
      },
      discard: async (ref) => { discarded.push(ref.fileId); return real.discard(ref); },
    };
    const [a, b] = await Promise.all([
      readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' }),
      readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a).toEqual(b);
    expect(created).toHaveLength(2);
    expect(discarded).toHaveLength(1);
    expect(created).toContain(deps.directory.books.get('co_aaaaaaaaaa')!.fileId);
    expect(discarded[0]).not.toBe(deps.directory.books.get('co_aaaaaaaaaa')!.fileId);
  });

  it('never involve a second person: the company is not theirs', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' });
    const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    expect(await readPartners(deps, other, { companyId: 'co_aaaaaaaaaa' })).toMatchObject({ ok: false, error: 'forbidden' });
  });
});

describe('recreatePartnerBook', () => {
  it('makes a new file when the old one is gone, keeps the company and records an event', async () => {
    const deps = await setup();
    const old = deps.directory.books.get(companyId)!.fileId;
    await deps.partnerBooks.discard({ fileId: old });
    const real = deps.partnerBooks;
    const trashed: string[] = [];
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      create: real.create.bind(real),
      discard: real.discard.bind(real),
      trash: async (ref) => { trashed.push(ref.fileId); return real.trash(ref); },
    };
    expect(await readPartners(deps, owner, { companyId })).toMatchObject({ ok: false, error: 'file_not_found' });
    const r = await recreatePartnerBook(deps, owner, { companyId });
    expect(r.ok).toBe(true);
    const now = deps.directory.books.get(companyId)!;
    expect(now.fileId).not.toBe(old);
    expect(now.ownerUserId).toBe('u1');
    expect((await readPartners(deps, owner, { companyId })).ok).toBe(true);
    expect(deps.events.events.find((e) => e.command === 'partners.recreate')).toMatchObject({ fileId: now.fileId, entityIds: [] });
    expect(trashed).toEqual([]);
  });

  it('two at once make one new book and throw the loser\'s file away', async () => {
    const deps = await setup();
    const old = deps.directory.books.get('co_aaaaaaaaaa')!.fileId;
    await deps.partnerBooks.discard({ fileId: old });
    const real = deps.partnerBooks;
    const discarded: string[] = [];
    let created = 0;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      create: async (...args) => {
        const out = await real.create(...args);
        created++;
        while (created < 2) await new Promise((r) => setTimeout(r, 1));
        return out;
      },
      discard: async (ref) => { discarded.push(ref.fileId); return real.discard(ref); },
    };
    const [a, b] = await Promise.all([
      recreatePartnerBook(deps, owner, { companyId: 'co_aaaaaaaaaa' }),
      recreatePartnerBook(deps, owner, { companyId: 'co_aaaaaaaaaa' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a).toEqual(b);
    const winner = deps.directory.books.get('co_aaaaaaaaaa')!.fileId;
    expect(created).toBe(2);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).not.toBe(winner);
    expect(deps.events.events.filter((e) => e.command === 'partners.recreate')).toHaveLength(1);
  });

  it('leaves a book that still reads alone', async () => {
    const deps = await setup();
    const before = deps.directory.books.get(companyId)!.fileId;
    const real = deps.partnerBooks;
    const trashed: string[] = [];
    let created = 0;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      create: async (...args) => { created++; return real.create(...args); },
      discard: real.discard.bind(real),
      trash: async (ref) => { trashed.push(ref.fileId); return real.trash(ref); },
    };
    const r = await recreatePartnerBook(deps, owner, { companyId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.value.companyId).toBe(companyId);
    expect(deps.directory.books.get(companyId)!.fileId).toBe(before);
    expect(trashed).toEqual([]);
    expect(created).toBe(0);
  });

  it('replaces a file from an earlier version with a new empty book and trashes the old file once', async () => {
    const deps = await setup();
    await addAccount(deps);
    deps.events.events.length = 0;
    const old = deps.directory.books.get(companyId)!.fileId;
    const { real, trashed } = watchOldFile(deps, old);
    const r = await recreatePartnerBook(deps, owner, { companyId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.value).toMatchObject({ companyId, accounts: [], partners: [] });
    const now = deps.directory.books.get(companyId)!.fileId;
    expect(now).not.toBe(old);
    expect(trashed).toEqual([old]);
    expect(deps.events.events.filter((e) => e.command === 'partners.recreate')).toEqual([
      expect.objectContaining({ fileId: now, entityIds: [], actorUserId: 'u1' }),
    ]);
    expect((await real.read({ fileId: old })).ok).toBe(false);
    expect((await real.read({ fileId: now })).ok).toBe(true);
  });

  it('two at once on an old file trash it once and throw the loser\'s file away', async () => {
    const deps = await setup();
    const old = deps.directory.books.get(companyId)!.fileId;
    const real = deps.partnerBooks;
    const discarded: string[] = [];
    const trashed: string[] = [];
    let created = 0;
    deps.partnerBooks = {
      ...real,
      read: async (ref) => ref.fileId === old
        ? { ok: false, error: 'old_version', message: SHEET_COPY.ISSUES.OLD_VERSION }
        : real.read(ref),
      create: async (...args) => {
        const out = await real.create(...args);
        created++;
        while (created < 2) await new Promise((r) => setTimeout(r, 1));
        return out;
      },
      discard: async (ref) => { discarded.push(ref.fileId); return real.discard(ref); },
      trash: async (ref) => { trashed.push(ref.fileId); return real.trash(ref); },
    };
    const [a, b] = await Promise.all([
      recreatePartnerBook(deps, owner, { companyId }),
      recreatePartnerBook(deps, owner, { companyId }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const winner = deps.directory.books.get(companyId)!.fileId;
    expect(created).toBe(2);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).not.toBe(winner);
    expect(trashed).toEqual([old]);
    expect(deps.events.events.filter((e) => e.command === 'partners.recreate')).toHaveLength(1);
  });

  it('passes on any other read trouble and changes nothing', async () => {
    const deps = await setup();
    const old = deps.directory.books.get(companyId)!.fileId;
    const real = deps.partnerBooks;
    const trashed: string[] = [];
    deps.partnerBooks = {
      ...real,
      read: async () => ({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE }),
      create: real.create.bind(real),
      trash: async (ref) => { trashed.push(ref.fileId); return real.trash(ref); },
    };
    expect(await recreatePartnerBook(deps, owner, { companyId })).toEqual({
      ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE,
    });
    expect(deps.directory.books.get(companyId)!.fileId).toBe(old);
    expect(trashed).toEqual([]);
    expect(deps.events.events).toHaveLength(0);
  });

  it('refuses a stranger, an agent, another company, a company with no book and a bad id', async () => {
    const deps = await setup();
    await deps.partnerBooks.discard({ fileId: deps.directory.books.get('co_aaaaaaaaaa')!.fileId });
    const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
    expect(await recreatePartnerBook(deps, other, { companyId: 'co_aaaaaaaaaa' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await recreatePartnerBook(deps, agent, { companyId: 'co_aaaaaaaaaa' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await recreatePartnerBook(deps, owner, { companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await recreatePartnerBook(deps, other, { companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await recreatePartnerBook(deps, owner, { companyId: 'nope' })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('a Partner book Google can’t make', () => {
  for (const [code, message] of [['auth', COPY.AUTH_MESSAGE], ['quota', COPY.QUOTA_MESSAGE]] as const) {
    it(`answers the first read with the ${code} message, not an error page`, async () => {
      const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
      deps.partnerBooks.create = async () => { throw new StoreFailure(code, message); };
      expect(await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' })).toEqual({ ok: false, error: code, message });
      expect(deps.directory.books.size).toBe(0);
      expect(deps.events.events).toHaveLength(0);
    });

    it(`answers a recreate with the ${code} message and keeps the old entry`, async () => {
      const deps = await setup();
      const old = deps.directory.books.get('co_aaaaaaaaaa')!.fileId;
      await deps.partnerBooks.discard({ fileId: old });
      deps.partnerBooks.create = async () => { throw new StoreFailure(code, message); };
      expect(await recreatePartnerBook(deps, owner, { companyId: 'co_aaaaaaaaaa' })).toEqual({ ok: false, error: code, message });
      expect(deps.directory.books.get('co_aaaaaaaaaa')!.fileId).toBe(old);
      expect(deps.events.events).toHaveLength(0);
    });
  }

  it('still throws anything that is not a store failure (a bug)', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    deps.partnerBooks.create = async () => { throw new Error('bug'); };
    await expect(readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' })).rejects.toThrow('bug');
  });
});

describe('ids from the directory, not from _meta', () => {
  it('reads the company id the directory names, whatever _meta says', async () => {
    const deps = await setup();
    await addSection(deps);
    const fileId = deps.directory.books.get(companyId)!.fileId;
    // A hand edit of _meta (and the partner rows that take their company from it).
    const files = (deps.partnerBooks as unknown as { files: Map<string, PartnerBook> }).files;
    const file = files.get(fileId)!;
    file.companyId = 'co_bbbbbbbbbb';
    for (const p of file.partners) p.companyId = 'co_bbbbbbbbbb';
    const r = await readPartners(deps, owner, { companyId: 'co_aaaaaaaaaa' });
    expect(r.ok && r.value.value.companyId).toBe('co_aaaaaaaaaa');
    expect(r.ok && r.value.value.partners.map((p) => p.companyId)).toEqual(['co_aaaaaaaaaa']);
  });
});

describe('recreatePartnerBook and its event', () => {
  it('keeps the new book when recording the event fails', async () => {
    const deps = await setup();
    const old = deps.directory.books.get('co_aaaaaaaaaa')!.fileId;
    await deps.partnerBooks.discard({ fileId: old });
    const discarded: string[] = [];
    const trashed: string[] = [];
    const real = deps.partnerBooks;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      create: real.create.bind(real),
      discard: async (ref) => { discarded.push(ref.fileId); return real.discard(ref); },
      trash: async (ref) => { trashed.push(ref.fileId); return real.trash(ref); },
    };
    deps.events.record = async () => { throw new Error('event sink down'); };
    await expect(recreatePartnerBook(deps, owner, { companyId })).rejects.toThrow('event sink down');
    const now = deps.directory.books.get(companyId)!.fileId;
    expect(now).not.toBe(old);
    expect(discarded).toEqual([]);
    expect(trashed).toEqual([]);
    expect((await real.read({ fileId: now })).ok).toBe(true);
  });

  it('trashes the old file when recording the event fails, and keeps the new book', async () => {
    const deps = await setup();
    const old = deps.directory.books.get(companyId)!.fileId;
    const { real, trashed, discarded } = watchOldFile(deps, old);
    deps.events.record = async () => { throw new Error('event sink down'); };
    await expect(recreatePartnerBook(deps, owner, { companyId })).rejects.toThrow('event sink down');
    const now = deps.directory.books.get(companyId)!.fileId;
    expect(now).not.toBe(old);
    expect(trashed).toEqual([old]);
    expect(discarded).toEqual([]);
    expect((await real.read({ fileId: now })).ok).toBe(true);
  });
});

/** The old file reads as an earlier version. Trash and discard are counted; the new file reads for real. */
function watchOldFile(deps: TestDeps, old: string) {
  const real = deps.partnerBooks;
  const trashed: string[] = [];
  const discarded: string[] = [];
  deps.partnerBooks = {
    ...real,
    read: async (ref) => ref.fileId === old
      ? { ok: false, error: 'old_version', message: SHEET_COPY.ISSUES.OLD_VERSION }
      : real.read(ref),
    create: real.create.bind(real),
    discard: async (ref) => { discarded.push(ref.fileId); return real.discard(ref); },
    trash: async (ref) => { trashed.push(ref.fileId); return real.trash(ref); },
  };
  return { real, trashed, discarded };
}
