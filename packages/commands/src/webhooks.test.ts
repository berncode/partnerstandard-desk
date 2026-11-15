import type { PartnerBook } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from './actor';
import { startMap } from './maps';
import { changePartner, readPartners } from './partners';
import { FORBIDDEN } from './result';
import { agentContext } from './agents/context';
import { runTool } from './agents/tools';
import { WEBHOOK_TOOLS } from './agents/webhook-tools';
import { makeTestDeps } from './testing';
import {
  createWebhook, deleteWebhook, listWebhookDeliveries, listWebhooks, partnerWebhooks, proposalWebhooks, resendWebhookDelivery, testWebhook,
  turnOffWebhook, turnOnWebhook, type ResendOutcome,
} from './webhooks';
import type { ProposalEntry } from './proposal-index';

const ANNA_CO = 'co_aaaaaaaaaa';
const BEN_CO = 'co_bbbbbbbbbb';
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const ben: Actor = { kind: 'owner', userId: 'u_ben', displayName: 'Ben' };
const annasAgent = (level: 'read' | 'change'): Actor => ({ kind: 'agent', userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level, via: { kind: 'key', keyId: 'k_n8n' } });
const URL_IN = 'https://hooks.example.com/in';

type TestDeps = ReturnType<typeof makeTestDeps>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup() {
  const deps = makeTestDeps({ companies: { u_anna: ANNA_CO, u_ben: BEN_CO } });
  await readPartners(deps, anna, { companyId: ANNA_CO });
  await readPartners(deps, ben, { companyId: BEN_CO });
  deps.events.events.length = 0;
  return deps;
}

/** A reseller of Acme for Anna, not signed yet. */
async function addPartner(deps: TestDeps) {
  const change = async (c: Record<string, unknown>) => value(await changePartner(deps, anna, { companyId: ANNA_CO, change: c })).entityId!;
  const accountId = await change({ kind: 'add', entity: 'account', values: { company: 'SECRET Acme' } });
  const partnerId = await change({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller', whyItFits: 'SECRET fit' } });
  return { accountId, partnerId };
}

const sign = (deps: TestDeps, partnerId: string) =>
  changePartner(deps, anna, { companyId: ANNA_CO, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-01' } });

describe('webhook events from the commands', () => {
  it('markSigned enqueues partner.signed with ids only for each subscribed webhook', async () => {
    const deps = await setup();
    const first = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    const second = value(await createWebhook(deps, anna, { url: 'https://other.example.com/in', events: ['partner.signed', 'review.due'] }));
    const { accountId, partnerId } = await addPartner(deps);
    const { mapId } = value(await startMap(deps, anna, { companyId: ANNA_CO, partnerId }));
    expect((await sign(deps, partnerId)).ok).toBe(true);

    expect(deps.webhooks.deliveries.map((d) => ({ webhookId: d.webhookId, type: d.type, data: d.data })).sort((a, b) => a.webhookId.localeCompare(b.webhookId)))
      .toEqual([first.webhook.id, second.webhook.id].sort().map((webhookId) => ({ webhookId, type: 'partner.signed', data: { accountId, partnerId, mapId } })));
    expect(JSON.stringify(deps.webhooks.deliveries)).not.toContain('SECRET');
  });

  it('a partner type without a MAP sends no mapId', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] });
    const { accountId, partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    expect(deps.webhooks.deliveries.map((d) => d.data)).toEqual([{ accountId, partnerId }]);
  });

  it('setStage enqueues partner.stage_changed', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.stage_changed'] });
    const { accountId, partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    deps.webhooks.deliveries.length = 0;
    expect((await changePartner(deps, anna, { companyId: ANNA_CO, change: { kind: 'setStage', partnerId, to: 'growth' } })).ok).toBe(true);
    expect(deps.webhooks.deliveries.map((d) => ({ type: d.type, data: d.data }))).toEqual([{ type: 'partner.stage_changed', data: { accountId, partnerId } }]);
  });

  it('a signing sends both partner.signed and partner.stage_changed (recruitment to onboarding), with ids only', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed', 'partner.stage_changed'] });
    const { accountId, partnerId } = await addPartner(deps);
    const { mapId } = value(await startMap(deps, anna, { companyId: ANNA_CO, partnerId }));
    expect((await sign(deps, partnerId)).ok).toBe(true);
    expect(deps.webhooks.deliveries.map((d) => ({ type: d.type, data: d.data }))).toEqual([
      { type: 'partner.signed', data: { accountId, partnerId, mapId } },
      { type: 'partner.stage_changed', data: { accountId, partnerId, mapId } },
    ]);
    expect(JSON.stringify(deps.webhooks.deliveries)).not.toContain('SECRET');
  });

  it('an exit sends partner.stage_changed, with ids only', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.stage_changed'] });
    const { accountId, partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    deps.webhooks.deliveries.length = 0;
    const exited = await changePartner(deps, anna, {
      companyId: ANNA_CO, change: { kind: 'markExited', partnerId, exitedDate: '2026-10-20', reason: 'SECRET reason' },
    });
    expect(exited.ok && exited.value.snapshot.value.partners[0]).toMatchObject({ stage: 'exit' });
    expect(deps.webhooks.deliveries.map((d) => ({ type: d.type, data: d.data }))).toEqual([{ type: 'partner.stage_changed', data: { accountId, partnerId } }]);
    expect(JSON.stringify(deps.webhooks.deliveries)).not.toContain('SECRET');
  });

  it('undoing a signing sends partner.stage_changed (onboarding back to recruitment)', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.stage_changed'] });
    const { accountId, partnerId } = await addPartner(deps);
    const { mapId } = value(await startMap(deps, anna, { companyId: ANNA_CO, partnerId }));
    await sign(deps, partnerId);
    deps.webhooks.deliveries.length = 0;
    const undone = await changePartner(deps, anna, { companyId: ANNA_CO, change: { kind: 'undoSigned', partnerId } });
    expect(undone.ok && undone.value.snapshot.value.partners[0]).toMatchObject({ stage: 'recruitment' });
    expect(deps.webhooks.deliveries.map((d) => ({ type: d.type, data: d.data }))).toEqual([{ type: 'partner.stage_changed', data: { accountId, partnerId, mapId } }]);
  });

  it('a change that leaves the stage alone sends nothing', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed', 'partner.stage_changed'] });
    const { partnerId } = await addPartner(deps);
    const change = (c: Record<string, unknown>) => changePartner(deps, anna, { companyId: ANNA_CO, change: c });
    expect((await change({ kind: 'setStep', partnerId, to: 'discovery_call' })).ok).toBe(true);
    expect((await change({ kind: 'close', partnerId, as: 'not_now', reason: 'Later' })).ok).toBe(true);
    expect((await change({ kind: 'reopen', partnerId })).ok).toBe(true);
    expect(deps.webhooks.deliveries).toEqual([]);
  });

  it('a partner row the answer doesn’t hold sends no accountId, never an empty one', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] });
    await partnerWebhooks(deps, 'u_anna', ANNA_CO, 'partner.signed', 'ptn_gone', { partners: [] } as unknown as PartnerBook);
    expect(deps.webhooks.deliveries.map((d) => d.data)).toEqual([{ partnerId: 'ptn_gone' }]);
  });

  it('a webhook not subscribed to the type gets nothing', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['review.due', 'activity.overdue'] });
    const { partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    expect(deps.webhooks.deliveries).toEqual([]);
  });

  it('Ben’s webhooks get nothing of Anna’s signing', async () => {
    const deps = await setup();
    await createWebhook(deps, ben, { url: URL_IN, events: ['partner.signed'] });
    const { partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    expect(deps.webhooks.deliveries).toEqual([]);
  });

  it('a refused change enqueues nothing', async () => {
    const deps = await setup();
    await createWebhook(deps, anna, { url: URL_IN, events: ['partner.stage_changed'] });
    const { partnerId } = await addPartner(deps);
    // Not signed yet: the stage can't move.
    expect((await changePartner(deps, anna, { companyId: ANNA_CO, change: { kind: 'setStage', partnerId, to: 'onboarding' } })).ok).toBe(false);
    expect(deps.webhooks.deliveries).toEqual([]);
  });

  it('a failing enqueue never fails the signing', async () => {
    const deps = await setup();
    const lines: Array<{ event: string; ids: Record<string, string> }> = [];
    deps.log = (event, ids) => { lines.push({ event, ids }); };
    deps.webhooks.enqueue = async () => { throw new Error('SECRET database text https://hooks.example.com/in'); };
    const { accountId, partnerId } = await addPartner(deps);
    const signed = await sign(deps, partnerId);
    expect(signed.ok).toBe(true);
    expect(signed.ok && signed.value.snapshot.value.partners[0]).toMatchObject({ signedDate: '2026-10-01', stage: 'onboarding' });
    expect(lines).toEqual([
      { event: 'webhook_enqueue_failed', ids: { type: 'partner.signed', userId: 'u_anna', accountId } },
      { event: 'webhook_enqueue_failed', ids: { type: 'partner.stage_changed', userId: 'u_anna', accountId } },
    ]);
  });

  it('a failing enqueue never fails an exit or an undone signing', async () => {
    const deps = await setup();
    const { accountId, partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    const lines: Array<{ event: string; ids: Record<string, string> }> = [];
    deps.log = (event, ids) => { lines.push({ event, ids }); };
    deps.webhooks.enqueue = async () => { throw new Error('SECRET database text'); };
    const undone = await changePartner(deps, anna, { companyId: ANNA_CO, change: { kind: 'undoSigned', partnerId } });
    expect(undone.ok && undone.value.snapshot.value.partners[0]).toMatchObject({ stage: 'recruitment', signedDate: null });
    await sign(deps, partnerId);
    lines.length = 0;
    const exited = await changePartner(deps, anna, {
      companyId: ANNA_CO, change: { kind: 'markExited', partnerId, exitedDate: '2026-10-20', reason: 'Ended' },
    });
    expect(exited.ok && exited.value.snapshot.value.partners[0]).toMatchObject({ stage: 'exit' });
    expect(lines).toEqual([{ event: 'webhook_enqueue_failed', ids: { type: 'partner.stage_changed', userId: 'u_anna', accountId } }]);
  });
});

describe('proposal webhooks', () => {
  const entry = (over: Partial<ProposalEntry> = {}): ProposalEntry => ({
    id: 'prp_aaaaaaaaaa', userId: 'u_anna', kind: 'fourC', status: 'waiting', accountId: 'a_1', partnerId: 'p_1', marketId: null, hypothesisId: null,
    createdAt: '2026-10-28T10:00:00.000Z', answeredAt: null, expiresAt: '2026-11-27T10:00:00.000Z',
    madeBy: { kind: 'app', agentName: 'Claude', clientId: 'c_1' }, fileId: 'f_1', agentName: 'Claude', makerOn: true, ...over,
  });

  it('proposal.created and proposal.answered carry the proposal id, the kind and the target ids it has, to subscribed webhooks only', async () => {
    const deps = await setup();
    const created = await deps.webhooks.create({ userId: 'u_anna', url: URL_IN, events: ['proposal.created'] });
    const answered = await deps.webhooks.create({ userId: 'u_anna', url: 'https://other.example.com/in', events: ['proposal.answered', 'partner.signed'] });
    await deps.webhooks.create({ userId: 'u_ben', url: URL_IN, events: ['proposal.created', 'proposal.answered'] });
    await proposalWebhooks(deps, 'u_anna', 'proposal.created', entry());
    await proposalWebhooks(deps, 'u_anna', 'proposal.answered', entry({ kind: 'partners', accountId: null, partnerId: null, marketId: 'm_1', hypothesisId: 'h_1' }));
    expect(deps.webhooks.deliveries.map((d) => [d.webhookId, d.type, d.data])).toEqual([
      [created.webhook.id, 'proposal.created', { proposalId: 'prp_aaaaaaaaaa', kind: 'fourC', accountId: 'a_1', partnerId: 'p_1' }],
      [answered.webhook.id, 'proposal.answered', { proposalId: 'prp_aaaaaaaaaa', kind: 'partners', marketId: 'm_1', hypothesisId: 'h_1' }],
    ]);
  });

  it('a failing enqueue is logged by ids and never throws', async () => {
    const deps = await setup();
    const lines: Array<{ event: string; ids: Record<string, string> }> = [];
    deps.log = (event, ids) => { lines.push({ event, ids }); };
    deps.webhooks.enqueue = async () => { throw new Error('SECRET database text'); };
    await proposalWebhooks(deps, 'u_anna', 'proposal.created', entry());
    expect(lines).toEqual([{ event: 'webhook_enqueue_failed', ids: { type: 'proposal.created', userId: 'u_anna', proposalId: 'prp_aaaaaaaaaa' } }]);
  });

  it('a webhook may subscribe to the two proposal events', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['proposal.created', 'proposal.answered'] }));
    expect(made.webhook.events).toEqual(['proposal.created', 'proposal.answered']);
    expect(WEBHOOK_TOOLS.find((t) => t.name === 'add_webhook')!.description).toContain('proposal.created, proposal.answered');
  });
});

describe('webhook commands', () => {
  it('createWebhook returns the secret once; the list never shows it', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    expect(made.secret).toMatch(/^whsec_/);
    expect(made.webhook).toEqual({ id: made.webhook.id, url: URL_IN, events: ['partner.signed'], status: 'active', createdAt: expect.any(String) });
    const list = value(await listWebhooks(deps, anna, {}));
    expect(list).toEqual([made.webhook]);
    expect(JSON.stringify(list)).not.toContain(made.secret);
    expect(deps.events.events.map((e) => ({ command: e.command, fileId: e.fileId, entityIds: e.entityIds })))
      .toEqual([{ command: 'webhooks.create', fileId: '', entityIds: [made.webhook.id] }]);
  });

  it('an http or private address is refused on the url field, and nothing is saved', async () => {
    const deps = await setup();
    const http = await createWebhook(deps, anna, { url: 'http://hooks.example.com/in', events: ['partner.signed'] });
    expect(http).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { url: 'Use an https address.' } });
    const named = await createWebhook(deps, anna, { url: 'https://n8n:secret@hooks.example.com/in', events: ['partner.signed'] });
    expect(named).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { url: 'Leave the user name and password out of the address.' } });
    const inside = await createWebhook(deps, anna, { url: 'https://10.0.0.5/in', events: ['partner.signed'] });
    expect(inside).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { url: expect.stringMatching(/private/) } });
    expect(value(await listWebhooks(deps, anna, {}))).toEqual([]);
  });

  it('needs at least one known event, each once, and nothing else in the input', async () => {
    const deps = await setup();
    for (const input of [
      { url: URL_IN, events: [] }, { url: URL_IN, events: ['partner.deleted'] }, { url: URL_IN, events: ['partner.signed', 'partner.signed'] },
      { url: URL_IN, events: ['partner.signed'], companyId: ANNA_CO }, { url: URL_IN, events: ['partner.signed'], secret: 'whsec_mine' },
    ]) {
      expect(await createWebhook(deps, anna, input)).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(deps.webhooks.rows).toEqual([]);
  });

  it('an agent at change level may add a webhook; a read agent may not', async () => {
    const deps = await setup();
    expect(await createWebhook(deps, annasAgent('read'), { url: URL_IN, events: ['partner.signed'] })).toEqual(FORBIDDEN);
    expect(deps.webhooks.rows).toEqual([]);
    const made = value(await createWebhook(deps, annasAgent('change'), { url: URL_IN, events: ['partner.signed'] }));
    // The webhook is the person's own, whoever made it.
    expect(value(await listWebhooks(deps, annasAgent('read'), {})).map((w) => w.id)).toEqual([made.webhook.id]);
    expect(await deleteWebhook(deps, annasAgent('read'), { webhookId: made.webhook.id })).toEqual(FORBIDDEN);
    expect(await testWebhook(deps, annasAgent('read'), { webhookId: made.webhook.id })).toEqual(FORBIDDEN);
    expect(value(await deleteWebhook(deps, annasAgent('change'), { webhookId: made.webhook.id }))).toEqual({ deleted: true });
  });

  it('a person with a MAP link can do nothing with webhooks', async () => {
    const deps = await setup();
    const link: Actor = { kind: 'link', userId: 'u_anna', linkId: 'ml_1', mapId: 'map_1', personId: 'pp_1', side: 'partner', name: 'Lena' };
    expect(await listWebhooks(deps, link, {})).toEqual(FORBIDDEN);
    expect(await createWebhook(deps, link, { url: URL_IN, events: ['partner.signed'] })).toEqual(FORBIDDEN);
  });

  it('Ben can’t delete Anna’s webhook', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    // The same answer as for a webhook that doesn't exist: Ben can't tell it does.
    const missing = await deleteWebhook(deps, ben, { webhookId: 'wh_doesnotexist' });
    expect(missing).toMatchObject({ ok: false, error: 'not_found' });
    expect(await deleteWebhook(deps, ben, { webhookId: made.webhook.id })).toEqual(missing);
    expect(await testWebhook(deps, ben, { webhookId: made.webhook.id })).toEqual(missing);
    expect(value(await listWebhooks(deps, ben, {}))).toEqual([]);
    expect(value(await listWebhooks(deps, anna, {})).map((w) => w.id)).toEqual([made.webhook.id]);
  });

  it('deleting a webhook takes its waiting deliveries with it', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    const { partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    expect(deps.webhooks.deliveries).toHaveLength(1);
    expect(value(await deleteWebhook(deps, anna, { webhookId: made.webhook.id }))).toEqual({ deleted: true });
    expect(deps.webhooks.deliveries).toEqual([]);
    expect(deps.events.events.at(-1)).toMatchObject({ command: 'webhooks.delete', entityIds: [made.webhook.id] });
  });

  it('testWebhook queues one webhook.test delivery to that webhook only', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    await createWebhook(deps, anna, { url: 'https://other.example.com/in', events: ['partner.signed'] });
    const sent = value(await testWebhook(deps, anna, { webhookId: made.webhook.id }));
    expect(sent.eventId).toMatch(/^evt_/);
    expect(deps.webhooks.deliveries.map((d) => ({ id: d.id, webhookId: d.webhookId, type: d.type, data: d.data })))
      .toEqual([{ id: sent.eventId, webhookId: made.webhook.id, type: 'webhook.test', data: { webhookId: made.webhook.id } }]);
  });

  it('a malformed webhook id is invalid', async () => {
    const deps = await setup();
    expect(await deleteWebhook(deps, anna, { webhookId: '' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await deleteWebhook(deps, anna, {})).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('the add_webhook tool', () => {
  it('refuses an event listed twice with a field error, as the command does, and makes nothing', async () => {
    const deps = await setup();
    const ctx = await agentContext(deps, { userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level: 'change', via: { kind: 'key', keyId: 'k_n8n' } });
    expect(await runTool(ctx, 'add_webhook', { url: URL_IN, events: ['partner.signed', 'partner.signed'] }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { events: 'Send each event once.' } });
    expect(value(await listWebhooks(deps, anna, {}))).toEqual([]);
    expect((await runTool(ctx, 'add_webhook', { url: URL_IN, events: ['partner.signed', 'review.due'] })).ok).toBe(true);
  });

  it('tells the agent a webhook gets only what happens after it is added', () => {
    expect(WEBHOOK_TOOLS.find((t) => t.name === 'add_webhook')!.description)
      .toContain(' It gets only what happens after it is added; read what is there now with the other tools.');
  });
});

describe('the memory webhook store', () => {
  it('enqueue with an empty only makes no mark and queues nothing', async () => {
    const deps = await setup();
    value(await createWebhook(deps, anna, { url: URL_IN, events: ['activity.overdue'] }));
    await deps.webhooks.enqueue('u_anna', 'activity.overdue', { activityId: 'act_1' }, 'overdue:act_1:2026-10-30', []);
    expect(deps.webhooks.deliveries).toEqual([]);
    expect(deps.webhooks.marks.size).toBe(0);
    // The same key still goes once a webhook passes.
    await deps.webhooks.enqueue('u_anna', 'activity.overdue', { activityId: 'act_1' }, 'overdue:act_1:2026-10-30');
    expect(deps.webhooks.deliveries).toHaveLength(1);
  });
});

describe('webhook deliveries and turning a webhook off and on (Settings)', () => {
  it('turnOnWebhook drops what waited', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    const id = { webhookId: made.webhook.id };
    for (let i = 0; i < 4; i++) await testWebhook(deps, anna, id);
    const [delivered, givenUp] = deps.webhooks.deliveries;
    Object.assign(delivered!, { status: 200, doneAt: '2026-11-01T09:00:00.000Z' });
    Object.assign(givenUp!, { status: 500, givenUpAt: '2026-11-01T09:00:00.000Z' });
    deps.webhooks.deliveries[2]!.status = 0;
    value(await turnOffWebhook(deps, anna, id));
    value(await turnOnWebhook(deps, anna, id));
    expect(deps.webhooks.deliveries.map((d) => d.id)).toEqual([delivered!.id, givenUp!.id]);
    // On already: nothing more goes.
    await testWebhook(deps, anna, id);
    value(await turnOnWebhook(deps, anna, id));
    expect(deps.webhooks.deliveries).toHaveLength(3);
  });

  it('turnOnWebhook still turns it on when forgetting the health fails, and logs ids only', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['health.changed'] }));
    const id = { webhookId: made.webhook.id };
    value(await turnOffWebhook(deps, anna, id));
    const log = vi.spyOn(deps, 'log');
    vi.spyOn(deps.directory, 'forgetWebhookHealth').mockRejectedValue(new Error('maps_update_failed'));
    expect(value(await turnOnWebhook(deps, anna, id)).webhook.status).toBe('active');
    expect(log).toHaveBeenCalledWith('webhook_health_failed', { userId: 'u_anna', webhookId: made.webhook.id });
  });


  it('lists the last 10 deliveries of one webhook, newest first: time, event and answer code only', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    const other = value(await createWebhook(deps, anna, { url: 'https://other.example.com/in', events: ['partner.signed'] }));
    for (let i = 0; i < 12; i++) await testWebhook(deps, anna, { webhookId: made.webhook.id });
    await testWebhook(deps, anna, { webhookId: other.webhook.id });
    const mine = deps.webhooks.deliveries.filter((d) => d.webhookId === made.webhook.id);
    mine.at(-1)!.status = 200;
    mine.at(-2)!.status = 0;
    const list = value(await listWebhookDeliveries(deps, anna, { webhookId: made.webhook.id }));
    expect(list).toHaveLength(10);
    expect(list[0]).toEqual({ id: mine.at(-1)!.id, at: mine.at(-1)!.occurredAt, type: 'webhook.test', status: 200 });
    expect(list[1]).toEqual({ id: mine.at(-2)!.id, at: mine.at(-2)!.occurredAt, type: 'webhook.test', status: 0 });
    expect(list[2]).toEqual({ id: mine.at(-3)!.id, at: mine.at(-3)!.occurredAt, type: 'webhook.test', status: null });
    // The event id, for Send again; never the body, the webhook's id or the address.
    for (const row of list) expect(Object.keys(row).sort()).toEqual(['at', 'id', 'status', 'type']);
    expect(JSON.stringify(list)).not.toContain(URL_IN);
    expect(JSON.stringify(list)).not.toContain(made.webhook.id);
  });

  it('a read agent may list deliveries; Ben gets not_found for Anna’s webhook, like a missing one', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    expect(value(await listWebhookDeliveries(deps, annasAgent('read'), { webhookId: made.webhook.id }))).toEqual([]);
    const missing = await listWebhookDeliveries(deps, ben, { webhookId: 'wh_doesnotexist' });
    expect(missing).toMatchObject({ ok: false, error: 'not_found' });
    expect(await listWebhookDeliveries(deps, ben, { webhookId: made.webhook.id })).toEqual(missing);
    expect(await listWebhookDeliveries(deps, anna, { webhookId: '' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await listWebhookDeliveries(deps, anna, { webhookId: made.webhook.id, url: URL_IN })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('turns a webhook off and on again, with an event by ids each time', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    expect(value(await turnOffWebhook(deps, anna, { webhookId: made.webhook.id }))).toEqual({ webhook: { ...made.webhook, status: 'off' } });
    // Off: an event goes nowhere.
    const { partnerId } = await addPartner(deps);
    await sign(deps, partnerId);
    expect(deps.webhooks.deliveries).toEqual([]);
    expect(value(await turnOnWebhook(deps, anna, { webhookId: made.webhook.id }))).toEqual({ webhook: { ...made.webhook, status: 'active' } });
    expect(deps.events.events.filter((e) => e.command.startsWith('webhooks.turn')).map((e) => ({ command: e.command, entityIds: e.entityIds })))
      .toEqual([{ command: 'webhooks.turnOff', entityIds: [made.webhook.id] }, { command: 'webhooks.turnOn', entityIds: [made.webhook.id] }]);
  });

  it('turns on a webhook turned off for failures', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    await deps.webhooks.setStatus('u_anna', made.webhook.id, 'off_failing');
    expect(value(await turnOnWebhook(deps, anna, { webhookId: made.webhook.id })).webhook.status).toBe('active');
  });

  it('a change agent may turn a webhook off and on; a read agent, a link and Ben may not', async () => {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    const id = { webhookId: made.webhook.id };
    expect(await turnOffWebhook(deps, annasAgent('read'), id)).toEqual(FORBIDDEN);
    expect(await turnOnWebhook(deps, annasAgent('read'), id)).toEqual(FORBIDDEN);
    const link: Actor = { kind: 'link', userId: 'u_anna', linkId: 'ml_1', mapId: 'map_1', personId: 'pp_1', side: 'partner', name: 'Lena' };
    expect(await turnOffWebhook(deps, link, id)).toEqual(FORBIDDEN);
    expect(await listWebhookDeliveries(deps, link, id)).toEqual(FORBIDDEN);
    const missing = await turnOffWebhook(deps, ben, { webhookId: 'wh_doesnotexist' });
    expect(missing).toMatchObject({ ok: false, error: 'not_found' });
    expect(await turnOffWebhook(deps, ben, id)).toEqual(missing);
    expect(await turnOnWebhook(deps, ben, id)).toEqual(missing);
    expect(deps.webhooks.rows[0]!.status).toBe('active');
    expect(value(await turnOffWebhook(deps, annasAgent('change'), id)).webhook.status).toBe('off');
    expect(value(await turnOnWebhook(deps, annasAgent('change'), id)).webhook.status).toBe('active');
  });
});

describe('Send again (resendWebhookDelivery)', () => {
  /** Anna's webhook with one test delivery that failed: given up after a 500. */
  async function failed() {
    const deps = await setup();
    const made = value(await createWebhook(deps, anna, { url: URL_IN, events: ['partner.signed'] }));
    const { eventId } = value(await testWebhook(deps, anna, { webhookId: made.webhook.id }));
    Object.assign(deps.webhooks.deliveries[0]!, { status: 500, givenUpAt: '2026-11-01T09:00:00.000Z' });
    deps.events.events.length = 0;
    return { deps, webhookId: made.webhook.id, deliveryId: eventId };
  }

  it('resendWebhookDelivery queues one failed delivery again and records webhooks.resend with the two ids', async () => {
    const { deps, webhookId, deliveryId } = await failed();
    expect(value(await resendWebhookDelivery(deps, anna, { webhookId, deliveryId }))).toEqual({ eventId: deliveryId });
    expect(deps.webhooks.deliveries).toEqual([expect.objectContaining({ id: deliveryId, status: null, givenUpAt: null, doneAt: null })]);
    expect(deps.events.events.map((e) => ({ command: e.command, fileId: e.fileId, entityIds: e.entityIds })))
      .toEqual([{ command: 'webhooks.resend', fileId: '', entityIds: [webhookId, deliveryId] }]);
    // Waiting again: nothing to send again until it fails.
    expect(await resendWebhookDelivery(deps, anna, { webhookId, deliveryId }))
      .toEqual({ ok: false, error: 'invalid', message: COPY.WEBHOOK_SEND_AGAIN_NOT_FAILED });
  });

  it('refusals keep to their words', async () => {
    const { deps, webhookId, deliveryId } = await failed();
    const words: Record<Exclude<ResendOutcome, 'queued'>, unknown> = {
      not_found: { ok: false, error: 'not_found', message: COPY.WEBHOOK_DELIVERY_GONE },
      off: { ok: false, error: 'invalid', message: COPY.WEBHOOK_SEND_AGAIN_OFF },
      not_failed: { ok: false, error: 'invalid', message: COPY.WEBHOOK_SEND_AGAIN_NOT_FAILED },
      sending: { ok: false, error: 'conflict', message: COPY.WEBHOOK_SEND_AGAIN_BUSY },
    };
    for (const [outcome, answer] of Object.entries(words)) {
      deps.webhooks.resend = async () => outcome as ResendOutcome;
      expect(await resendWebhookDelivery(deps, anna, { webhookId, deliveryId })).toEqual(answer);
    }
    expect(deps.events.events).toEqual([]);
  });

  it('the memory store answers off, not_found and a malformed input as the table does', async () => {
    const { deps, webhookId, deliveryId } = await failed();
    expect(await resendWebhookDelivery(deps, ben, { webhookId, deliveryId })).toMatchObject({ ok: false, error: 'not_found', message: COPY.WEBHOOK_DELIVERY_GONE });
    expect(await resendWebhookDelivery(deps, anna, { webhookId, deliveryId: 'evt_missing' })).toMatchObject({ ok: false, error: 'not_found' });
    value(await turnOffWebhook(deps, anna, { webhookId }));
    expect(await resendWebhookDelivery(deps, anna, { webhookId, deliveryId })).toMatchObject({ ok: false, error: 'invalid', message: COPY.WEBHOOK_SEND_AGAIN_OFF });
    for (const input of [{ webhookId }, { webhookId, deliveryId: '' }, { webhookId, deliveryId: 'x'.repeat(65) }, { webhookId, deliveryId, url: URL_IN }]) {
      expect(await resendWebhookDelivery(deps, anna, input)).toMatchObject({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS });
    }
    expect(deps.events.events.filter((e) => e.command === 'webhooks.resend')).toEqual([]);
  });

  it('an agent can’t send again, at any level', async () => {
    const { deps, webhookId, deliveryId } = await failed();
    for (const level of ['read', 'change', 'propose'] as const) {
      const agent: Actor = { kind: 'agent', userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level, via: { kind: 'key', keyId: 'k_n8n' } };
      expect(await resendWebhookDelivery(deps, agent, { webhookId, deliveryId })).toEqual(FORBIDDEN);
    }
    const link: Actor = { kind: 'link', userId: 'u_anna', linkId: 'ml_1', mapId: 'map_1', personId: 'pp_1', side: 'partner', name: 'Lena' };
    expect(await resendWebhookDelivery(deps, link, { webhookId, deliveryId })).toEqual(FORBIDDEN);
    expect(deps.webhooks.deliveries[0]).toMatchObject({ status: 500 });
    // Not an agent tool either.
    expect(WEBHOOK_TOOLS.map((t) => t.name).join(' ')).not.toMatch(/resend|again/i);
  });
});

describe('webhooks on a company server are each member’s own (plan 15)', () => {
  const WS = 'ws_aaaaaaaaaa';
  const member = (personId: string, role: 'admin' | 'partnerManager' | 'viewer'): Actor => ({
    kind: 'owner', userId: WS, displayName: personId, member: { personId, role },
  });

  it('one member never lists, tests, turns off or deletes another’s webhook', async () => {
    const deps = makeTestDeps();
    const annas = value(await createWebhook(deps, member('u_anna', 'admin'), { url: URL_IN, events: ['partner.signed'] }));
    const ben = member('u_ben', 'partnerManager');
    expect(value(await listWebhooks(deps, ben, {}))).toEqual([]);
    expect(value(await listWebhooks(deps, member('u_anna', 'admin'), {})).map((w) => w.id)).toEqual([annas.webhook.id]);
    for (const result of [
      await deleteWebhook(deps, ben, { webhookId: annas.webhook.id }),
      await testWebhook(deps, ben, { webhookId: annas.webhook.id }),
      await turnOffWebhook(deps, ben, { webhookId: annas.webhook.id }),
      await listWebhookDeliveries(deps, ben, { webhookId: annas.webhook.id }),
    ]) expect(result.ok).toBe(false);
    expect(value(await listWebhooks(deps, member('u_anna', 'admin'), {}))).toHaveLength(1);
  });

  it('a viewer makes no webhook', async () => {
    const deps = makeTestDeps();
    expect(await createWebhook(deps, member('u_vera', 'viewer'), { url: URL_IN, events: ['partner.signed'] })).toEqual(FORBIDDEN);
    expect(value(await listWebhooks(deps, member('u_vera', 'viewer'), {}))).toEqual([]);
  });

  it('turning a member’s health webhook on again keeps the stored health while another member’s hears of it', async () => {
    const deps = makeTestDeps();
    deps.webhooks.members.set(WS, ['u_anna', 'u_ben']);
    const forget = vi.spyOn(deps.directory, 'forgetWebhookHealth');
    value(await createWebhook(deps, member('u_ben', 'partnerManager'), { url: URL_IN, events: ['health.changed'] }));
    const annas = value(await createWebhook(deps, member('u_anna', 'admin'), { url: URL_IN, events: ['health.changed'] }));
    value(await turnOffWebhook(deps, member('u_anna', 'admin'), { webhookId: annas.webhook.id }));
    value(await turnOnWebhook(deps, member('u_anna', 'admin'), { webhookId: annas.webhook.id }));
    expect(forget).not.toHaveBeenCalled();
    // Ben's off too: nothing kept the health current, so it is forgotten.
    const bens = (await deps.webhooks.list('u_ben'))[0]!;
    value(await turnOffWebhook(deps, member('u_ben', 'partnerManager'), { webhookId: bens.id }));
    value(await turnOffWebhook(deps, member('u_anna', 'admin'), { webhookId: annas.webhook.id }));
    value(await turnOnWebhook(deps, member('u_anna', 'admin'), { webhookId: annas.webhook.id }));
    expect(forget).toHaveBeenCalledWith(WS);
  });

  it('a viewer turns off and deletes a webhook they made in another role', async () => {
    const deps = makeTestDeps();
    const made = value(await createWebhook(deps, member('u_vera', 'partnerManager'), { url: URL_IN, events: ['partner.signed'] }));
    expect((await turnOffWebhook(deps, member('u_vera', 'viewer'), { webhookId: made.webhook.id })).ok).toBe(true);
    expect((await turnOnWebhook(deps, member('u_vera', 'viewer'), { webhookId: made.webhook.id }))).toEqual(FORBIDDEN);
    expect((await deleteWebhook(deps, member('u_vera', 'viewer'), { webhookId: made.webhook.id })).ok).toBe(true);
  });

  it('an event of the workspace’s work reaches every member’s webhook, in memory as in the database', async () => {
    const deps = makeTestDeps();
    deps.webhooks.members.set(WS, ['u_anna', 'u_ben']);
    value(await createWebhook(deps, member('u_anna', 'admin'), { url: URL_IN, events: ['partner.signed'] }));
    value(await createWebhook(deps, member('u_ben', 'partnerManager'), { url: URL_IN, events: ['partner.signed'] }));
    await deps.webhooks.enqueue(WS, 'partner.signed', { partnerId: 'p_1' });
    expect(deps.webhooks.deliveries.map((d) => d.type)).toEqual(['partner.signed', 'partner.signed']);
  });
});
