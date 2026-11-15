import { describe, expect, it } from 'vitest';
import { changeMap, changePartner, readPartners, startMap, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { MemoryMailer } from './mailer';
import { mailMapLink, type LinkMailDeps } from './map-link-mail';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup(mailer: MemoryMailer | null = new MemoryMailer()) {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
  await readPartners(deps, owner, { companyId });
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }));
  const partnerId = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller', whyItFits: 'Fits' } },
  })).entityId!;
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const lena = value(await changeMap(deps, owner, {
    mapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'sales_lead' } },
  })).entityId!;
  const logged: unknown[] = [];
  const mail: LinkMailDeps = {
    mailer, owner: async (id) => (id === 'u1' ? { contact: { userId: 'u1', name: 'Ruth', email: 'ruth@example.com', recipients: [{ name: 'Ruth', email: 'ruth@example.com' }], team: false }, deps } : null),
    ourName: async () => 'Northwind', linkUrl: (token) => `https://desk.test/c/${token}`, log: (e, ids) => { logged.push([e, ids]); },
  };
  return { deps, mail, mailer, mapId, lena, logged };
}

describe('mailMapLink', () => {
  it('emails the person their link on the owner’s behalf, replies going to the owner', async () => {
    const { mail, mailer, mapId, lena } = await setup();
    expect(await mailMapLink(mail, { ownerUserId: 'u1', mapId, personId: lena, side: 'partner', email: 'lena@example.com' }, 'tok')).toBe(true);
    expect(mailer!.outbox).toHaveLength(1);
    expect(mailer!.outbox[0]).toMatchObject({ to: 'lena@example.com', replyTo: 'ruth@example.com', subject: 'Ruth shared a mutual action plan with you: Acme' });
    expect(mailer!.outbox[0]!.text).toContain('https://desk.test/c/tok');
    expect(mailer!.outbox[0]!.text).toContain('Hi Lena Ortiz,');
  });

  it('sends nothing without a mailer, an owner, or the person', async () => {
    const none = await setup(null);
    expect(await mailMapLink(none.mail, { ownerUserId: 'u1', mapId: none.mapId, personId: none.lena, side: 'partner', email: 'lena@example.com' }, 'tok')).toBe(false);
    const { mail, mailer, mapId } = await setup();
    expect(await mailMapLink(mail, { ownerUserId: 'u2', mapId, personId: 'pe_x', side: 'partner', email: 'x@example.com' }, 'tok')).toBe(false);
    expect(await mailMapLink(mail, { ownerUserId: 'u1', mapId, personId: 'pe_gone', side: 'partner', email: 'x@example.com' }, 'tok')).toBe(false);
    expect(mailer!.outbox).toEqual([]);
  });

  it('on a company server, goes out in the name of the member who sent it, replies going to them (plan 15)', async () => {
    const { deps, mail, mailer, mapId, lena } = await setup();
    mail.owner = async (id) => (id === 'u1' ? { contact: { userId: 'u1', name: 'Halden', email: null, recipients: [], team: true }, deps } : null);
    const ben = { actor: { ...owner, displayName: 'Ben', member: { personId: 'u_ben', role: 'partnerManager' as const } }, name: 'Ben', email: 'ben@halden.example' };
    const to = { ownerUserId: 'u1', mapId, personId: lena, side: 'partner' as const, email: 'lena@example.com' };
    expect(await mailMapLink(mail, to, 'tok', ben)).toBe(true);
    expect(mailer!.outbox[0]).toMatchObject({ replyTo: 'ben@halden.example', subject: 'Ben shared a mutual action plan with you: Acme' });
    // A new link the person asked for has no sender: no reply-to on a company server.
    expect(await mailMapLink(mail, to, 'tok2')).toBe(true);
    expect(mailer!.outbox[1]!.replyTo).toBeUndefined();
  });
});
