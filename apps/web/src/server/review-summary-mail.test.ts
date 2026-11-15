import { changeMap } from '@partner-desk/commands';
import { describe, expect, it, vi } from 'vitest';
import { MemoryMailer } from './mailer';
import { mailReviewSummary, type SummaryMailDeps } from './review-summary-mail';
import { heldReviewWithLink, OURS_ONLY, SUMMARY_OWNER } from '@/test/review-summary';

async function setup(mailer: MemoryMailer | null = new MemoryMailer()) {
  const made = await heldReviewWithLink({ includeScorecard: false });
  const logged: unknown[] = [];
  const mail: SummaryMailDeps = {
    mailer,
    owner: async (id) => (id === 'u1' ? { contact: { userId: 'u1', name: 'Ruth', email: 'ruth@example.com', recipients: [{ name: 'Ruth', email: 'ruth@example.com' }], team: false }, deps: made.deps } : null),
    ourName: async () => 'Halden', summaryUrl: (token) => `https://desk.test/r/${token}`, log: (e, ids) => { logged.push([e, ids]); },
  };
  const lenaTo = { personId: made.lena, email: 'lena@example.com' };
  const send = { ownerUserId: 'u1', mapId: made.mapId, reviewId: made.reviewId, to: [lenaTo] };
  return { ...made, mail, mailer, logged, send, lenaTo };
}

describe('mailReviewSummary', () => {
  it('emails the person the link on the owner’s behalf, replies going to the owner', async () => {
    const { mail, mailer, send, token } = await setup();
    expect(await mailReviewSummary(mail, send, token)).toEqual([send.to[0]!.personId]);
    expect(mailer!.outbox).toHaveLength(1);
    expect(mailer!.outbox[0]).toMatchObject({
      to: 'lena@example.com', replyTo: 'ruth@example.com', subject: 'Ruth sent you the summary of your review on 28 Oct 2026',
    });
    expect(mailer!.outbox[0]!.text).toContain(`https://desk.test/r/${token}`);
    expect(mailer!.outbox[0]!.text).toContain('Hi Lena Ortiz,');
    // The email carries the link, never the review's content.
    for (const hidden of [...Object.values(OURS_ONLY), 'Train five sellers']) expect(mailer!.outbox[0]!.html, hidden).not.toContain(hidden);
  });

  it('on a company server, goes out in the name of the member who sent it, replies going to them (plan 15)', async () => {
    const { mail, mailer, send, token, deps } = await setup();
    mail.owner = async (id) => (id === 'u1' ? { contact: { userId: 'u1', name: 'Halden', email: null, recipients: [], team: true }, deps } : null);
    const ben = {
      actor: { kind: 'owner' as const, userId: 'u1', displayName: 'Ben', member: { personId: 'u_ben', role: 'partnerManager' as const } },
      name: 'Ben', email: 'ben@halden.example',
    };
    expect(await mailReviewSummary(mail, send, token, ben)).toEqual([send.to[0]!.personId]);
    expect(mailer!.outbox[0]).toMatchObject({ replyTo: 'ben@halden.example', subject: 'Ben sent you the summary of your review on 28 Oct 2026' });
  });

  it('reads the MAP once for a send to several people, and checks each person against it', async () => {
    const { mail, mailer, send, token, deps, mapId, lenaTo } = await setup();
    const added = await changeMap(deps, SUMMARY_OWNER, {
      mapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Omar Haddad', title: '', email: 'omar@example.com', role: 'other' } },
    });
    if (!added.ok) throw new Error('setup');
    const omar = { personId: added.value.entityId!, email: 'omar@example.com' };
    const reads = vi.spyOn(deps.maps, 'read');
    const owners = vi.spyOn(mail, 'owner');
    // Answers who it reached: the review is stamped with their names (`shareSummary`).
    expect(await mailReviewSummary(mail, { ...send, to: [lenaTo, omar, { personId: 'pe_gone', email: 'gone@example.com' }] }, token))
      .toEqual([lenaTo.personId, omar.personId]);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(owners).toHaveBeenCalledTimes(1);
    expect(mailer!.outbox.map((m) => m.to)).toEqual(['lena@example.com', 'omar@example.com']);
    expect(mailer!.outbox[1]!.text).toContain('Hi Omar Haddad,');
  });

  it('sends nothing without a mailer, an owner, the person or the held review, and logs ids only', async () => {
    const none = await setup(null);
    expect(await mailReviewSummary(none.mail, none.send, none.token)).toEqual([]);
    const { mail, mailer, send, token, logged, lenaTo } = await setup();
    expect(await mailReviewSummary(mail, { ...send, ownerUserId: 'u2' }, token)).toEqual([]);
    expect(await mailReviewSummary(mail, { ...send, to: [{ ...lenaTo, personId: 'pe_gone' }] }, token)).toEqual([]);
    expect(await mailReviewSummary(mail, { ...send, reviewId: 'rv_gone' }, token)).toEqual([]);
    expect(await mailReviewSummary(mail, { ...send, mapId: 'map_gone' }, token)).toEqual([]);
    expect(mailer!.outbox).toEqual([]);
    const lines = JSON.stringify(logged);
    for (const hidden of [token, 'lena@example.com', 'Lena', 'ruth@example.com']) expect(lines, hidden).not.toContain(hidden);
  });

  it('logs a failed send with ids only, and answers only the people an email went out to', async () => {
    const { mail, send, token, logged } = await setup();
    const failing: SummaryMailDeps = { ...mail, mailer: { send: async () => ({ ok: false }) } };
    expect(await mailReviewSummary(failing, send, token)).toEqual([]);
    expect(logged).toEqual([['review_summary_mail_failed', { mapId: send.mapId, reviewId: send.reviewId, error: 'send' }]]);
  });
});
