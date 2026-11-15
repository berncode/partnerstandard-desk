import { changePartner, createProposal, readPartners, type Actor } from '@partner-desk/commands';
import { makeTestDeps, TEST_NOW } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const COMPANY = 'co_aaaaaaaaaa';
const state = vi.hoisted(() => ({ session: null as OwnerSession | null, deps: null as unknown as ReturnType<typeof makeTestDeps> }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  companyFor: async () => ({ companyId: COMPANY, name: '' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { proposalAccept, proposalReject } = await import('./proposals');

const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const claude: Actor = { kind: 'agent', userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level: 'propose', via: { kind: 'app', clientId: 'c_claude' } };
const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };
const SIGNED_OUT = { ok: false, error: 'auth', message: COPY.SIGNED_OUT };

async function made(): Promise<{ partnerId: string; proposalId: string }> {
  const change = async (c: Record<string, unknown>) => {
    const out = await changePartner(state.deps, anna, { companyId: COMPANY, change: c });
    if (!out.ok || !out.value.entityId) throw new Error('setup');
    return out.value.entityId;
  };
  const accountId = await change({ kind: 'add', entity: 'account', values: { company: 'Acme GmbH' } });
  const partnerId = await change({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } });
  const proposal = await createProposal(state.deps, claude, {
    companyId: COMPANY,
    proposal: {
      kind: 'fourC', partnerId, expectedUpdatedAt: TEST_NOW,
      letters: { customerBase: { score: 3, evidence: 'Ten customers' }, credibility: { score: 2, evidence: 'Known brand' } },
    },
  });
  if (!proposal.ok) throw new Error(JSON.stringify(proposal));
  return { partnerId, proposalId: proposal.value.proposalId };
}

beforeEach(async () => {
  state.session = session;
  state.deps = makeTestDeps({ companies: { u_anna: COMPANY } });
  state.deps.proposals.allowApp('u_anna', 'c_claude', 'Claude');
  await readPartners(state.deps, anna, { companyId: COMPANY });
});

describe('proposalAccept and proposalReject', () => {
  it('accept some letters with the company from the session: the book as written and the status', async () => {
    const { partnerId, proposalId } = await made();
    const out = await proposalAccept({ proposalId, expectedUpdatedAt: TEST_NOW, letters: ['credibility'], note: 'Too early' });
    expect(out).toMatchObject({ ok: true, status: 'partly_accepted', entityIds: [] });
    if (!out.ok) return;
    expect(out.snapshot.value.partners.find((p) => p.id === partnerId)).toMatchObject({
      desk: { credibility: 2, customerBase: null }, updatedBy: 'Anna, proposed by Desk Agent',
    });
    expect(out.snapshot.value.proposalItems.map((i) => [i.status, i.answerNote])).toEqual([['rejected', 'Too early'], ['accepted', '']]);
  });

  it('reject with a note answers the book; a company id in the input is refused', async () => {
    const { proposalId } = await made();
    expect(await proposalReject({ proposalId, companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await proposalAccept({ proposalId, companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'invalid' });
    const out = await proposalReject({ proposalId, note: 'Not now' });
    expect(out).toMatchObject({ ok: true, entityId: null });
    if (!out.ok) return;
    expect(out.snapshot.value.proposalItems.map((i) => [i.status, i.answerNote])).toEqual([['rejected', 'Not now'], ['rejected', 'Not now']]);
  });

  it('proposalAccept answers auth when Google is gone, and the page shows the Reconnect Google banner', async () => {
    // The banner is the editor's answer to `auth` (partner-page.test.tsx); here, the action passes Google's refusal on.
    const { proposalId } = await made();
    state.deps.partnerBooks.read = async () => ({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    expect(await proposalAccept({ proposalId, expectedUpdatedAt: TEST_NOW })).toEqual({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    expect(await proposalReject({ proposalId })).toEqual({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    expect(state.deps.proposals.rows.find((r) => r.id === proposalId)).toMatchObject({ status: 'waiting' });
  });

  it('answer SIGNED_OUT without a session', async () => {
    state.session = null;
    expect(await proposalAccept({ proposalId: 'prp_x' })).toEqual(SIGNED_OUT);
    expect(await proposalReject({ proposalId: 'prp_x' })).toEqual(SIGNED_OUT);
  });
});
