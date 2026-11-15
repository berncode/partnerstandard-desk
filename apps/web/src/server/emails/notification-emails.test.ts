// The notification emails. The reconnect email is Google only.
import { describe, expect, it } from 'vitest';
import { digestEmail, type DigestEmailSection } from './digest';
import { momentumEmail } from './momentum';
import { nudgeEmail, type NudgeEmailItem } from './nudge';
import { partnerAlertEmail } from './partner-alert';
import { reconnectEmail } from './reconnect';

const UNSUB = 'https://map.test/n/u/unsub.sig';
const PLAN_URL = 'https://map.test/plans/map_0123456789';
const urls = (n: number) => ({ done: `https://map.test/n/a/done${n}.sig`, inProgress: `https://map.test/n/a/prog${n}.sig`, update: `https://map.test/n/a/upd${n}.sig` });
const soon: NudgeEmailItem = { planName: 'Brightwave', title: 'Send the pricing sheet', when: 'Due tomorrow (21 Oct)', overdue: false, urls: urls(1) };
const late: NudgeEmailItem = { planName: 'Northwind', title: 'Book the kickoff', when: '3 days overdue (was due 17 Oct)', overdue: true, urls: urls(2) };

describe('nudgeEmail', () => {
  it('names one activity in the subject and offers its three actions and the unsubscribe link', async () => {
    const email = await nudgeEmail({ personName: 'Ben Ito', items: [soon], unsubscribeUrl: UNSUB });
    expect(email.subject).toBe('Coming up: Send the pricing sheet');
    expect(email.text).toContain('Hi Ben Ito,');
    expect(email.text).toContain('Brightwave · Due tomorrow (21 Oct)');
    expect(email.text).toContain('Mark done https://map.test/n/a/done1.sig');
    expect(email.text).toContain('In progress https://map.test/n/a/prog1.sig');
    expect(email.text).toContain('Update… https://map.test/n/a/upd1.sig');
    expect(email.text).toContain(`Unsubscribe from reminders about your activities ${UNSUB}`);
    expect(email.html).toContain(`href="${UNSUB}"`);
  });

  it('says “Overdue” for one late item, and counts several', async () => {
    expect((await nudgeEmail({ personName: 'Ben Ito', items: [late], unsubscribeUrl: UNSUB })).subject).toBe('Overdue: Book the kickoff');
    const both = await nudgeEmail({ personName: 'Ben Ito', items: [late, soon], unsubscribeUrl: UNSUB });
    expect(both.subject).toBe('2 activities need your attention');
    expect(both.text.indexOf('Book the kickoff')).toBeLessThan(both.text.indexOf('Send the pricing sheet'));
    expect(both.text).toContain('Mark done https://map.test/n/a/done2.sig');
  });

  it('keeps the subject to one bounded line, however the title was typed', async () => {
    const subject = async (title: string) => (await nudgeEmail({ personName: 'Ben Ito', items: [{ ...soon, title }], unsubscribeUrl: UNSUB })).subject;
    expect(await subject('Send the\n  pricing\r\n\tsheet  ')).toBe('Coming up: Send the pricing sheet');
    const long = await subject('x'.repeat(100));
    expect(long).toBe(`Coming up: ${'x'.repeat(79)}…`);
    expect(await subject('y'.repeat(80))).toBe(`Coming up: ${'y'.repeat(80)}`);
  });

  it('escapes what came from the sheet', async () => {
    const email = await nudgeEmail({ personName: '<b>Ben</b>', items: [{ ...soon, title: '<script>x</script>' }], unsubscribeUrl: UNSUB });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('renders the same as last time', async () => {
    const email = await nudgeEmail({ personName: 'Ben Ito', items: [late, soon], unsubscribeUrl: UNSUB });
    expect(email.text).toMatchSnapshot();
    expect(email.html).toMatchSnapshot();
  });
});

describe('digestEmail', () => {
  const section: DigestEmailSection = {
    partnerName: 'Brightwave', planUrl: PLAN_URL, health: 'At risk', healthChange: 'On track → At risk',
    done: ['Kickoff call'], dueThisWeek: ['Send the pricing sheet (due 21 Oct)'], overdue: ['Book the training (3 days overdue)'], blocked: ['Legal review'],
  };

  it('keeps every other subject on one line when a cell holds a newline', async () => {
    const partnerName = 'Bright\nwave\r\n Systems';
    const digest = await digestEmail({ recipientName: 'Anna Keller', audience: { kind: 'owner' }, sections: [{ ...section, partnerName }], unsubscribeUrl: UNSUB });
    const partnerDigest = await digestEmail({ recipientName: 'Lena Ortiz', audience: { kind: 'partner', ownerName: 'Anna\nKeller' }, sections: [{ ...section, planUrl: null }], unsubscribeUrl: UNSUB });
    const momentum = await momentumEmail({ partnerName, state: 'at_risk', days: 15, suggestion: 'x', planUrl: PLAN_URL, unsubscribeUrl: UNSUB });
    const alert = await partnerAlertEmail({ partnerName, lines: ['Lena Ortiz marked “x” done'], planUrl: PLAN_URL, unsubscribeUrl: UNSUB });
    for (const email of [digest, partnerDigest, momentum, alert]) expect(email.subject).not.toMatch(/[\r\n]/);
    expect(digest.subject).toContain('Bright wave Systems');
  });

  it('gives the owner every MAP with news, with a link to each', async () => {
    const email = await digestEmail({ recipientName: 'Anna Keller', audience: { kind: 'owner' }, sections: [section], unsubscribeUrl: UNSUB });
    expect(email.subject).toBe('Your MAP with Brightwave this week');
    for (const line of ['Health: On track → At risk', 'Done last week', '• Kickoff call', 'Due this week', '• Send the pricing sheet (due 21 Oct)', 'Overdue', '• Book the training (3 days overdue)', 'Blocked', '• Legal review', `Open the MAP ${PLAN_URL}`]) {
      expect(email.text).toContain(line);
    }
    expect(email.text).toContain(`Unsubscribe from the weekly digest ${UNSUB}`);
    const two = await digestEmail({ recipientName: 'Anna Keller', audience: { kind: 'owner' }, sections: [section, { ...section, partnerName: 'Northwind', healthChange: null, health: 'On track' }], unsubscribeUrl: UNSUB });
    expect(two.subject).toBe('Your 2 MAPs this week');
    expect(two.text).toContain('Health: On track');
  });

  it('leaves empty lists out', async () => {
    const email = await digestEmail({ recipientName: 'Anna Keller', audience: { kind: 'owner' }, sections: [{ ...section, done: [], blocked: [] }], unsubscribeUrl: UNSUB });
    expect(email.text).not.toContain('Done last week');
    expect(email.text).not.toContain('Blocked');
  });

  it('sends partners a copy from the owner, without a link to the MAP', async () => {
    const email = await digestEmail({ recipientName: 'Lena Ortiz', audience: { kind: 'partner', ownerName: 'Anna Keller' }, sections: [{ ...section, planUrl: null }], unsubscribeUrl: UNSUB });
    expect(email.subject).toBe('Anna Keller: your mutual action plan this week');
    expect(email.text).toContain('Anna Keller shares this weekly summary of your mutual action plan.');
    expect(email.text).not.toContain(PLAN_URL);
  });

  it('renders the same as last time', async () => {
    const email = await digestEmail({ recipientName: 'Anna Keller', audience: { kind: 'owner' }, sections: [section], unsubscribeUrl: UNSUB });
    expect(email.text).toMatchSnapshot();
    expect(email.html).toMatchSnapshot();
  });
});

describe('partnerAlertEmail', () => {
  it('lists what people with a link changed, links the MAP and offers its own unsubscribe', async () => {
    const email = await partnerAlertEmail({ partnerName: 'Brightwave', lines: ['Lena Ortiz marked “Register first deal” done', 'Lena Ortiz updated “Close 3 deals”'], planUrl: PLAN_URL, unsubscribeUrl: UNSUB });
    expect(email.subject).toBe('Changes to your MAP with Brightwave');
    expect(email.text).toContain('• Lena Ortiz marked “Register first deal” done');
    expect(email.text).toContain('• Lena Ortiz updated “Close 3 deals”');
    expect(email.text).toContain(`Open the MAP ${PLAN_URL}`);
    expect(email.text).toContain(`Unsubscribe from partner activity alerts ${UNSUB}`);
    expect(email.text).toMatchSnapshot();
    expect(email.html).toMatchSnapshot();
  });
});

describe('momentumEmail', () => {
  it('says how long nothing moved, what that means, and one next step', async () => {
    const email = await momentumEmail({ partnerName: 'Brightwave', state: 'at_risk', days: 15, suggestion: 'Book a check-in with both executive sponsors', planUrl: PLAN_URL, unsubscribeUrl: UNSUB });
    expect(email.subject).toBe('Brightwave: no progress for 15 days');
    expect(email.text).toContain('Nothing has moved in your MAP with Brightwave for 15 days, so it’s now at risk.');
    expect(email.text).toContain('Book a check-in with both executive sponsors');
    expect(email.text).toContain(`Unsubscribe from momentum warnings ${UNSUB}`);
    expect((await momentumEmail({ partnerName: 'Brightwave', state: 'off_track', days: 31, suggestion: 'x', planUrl: PLAN_URL, unsubscribeUrl: UNSUB })).text).toContain('so it’s now off track.');
    expect(email.text).toMatchSnapshot();
    expect(email.html).toMatchSnapshot();
  });
});

describe('reconnectEmail', () => {
  it('names Google Drive, links to sign-in, and has no unsubscribe: it is transactional', async () => {
    const google = await reconnectEmail({ ownerName: 'Anna Keller', signInUrl: 'https://map.test/sign-in' });
    expect(google.subject).toBe('Reconnect your Google account to keep your MAPs running');
    expect(google.text).toContain('PartnerStandard Desk can’t open your MAPs in Google Drive any more');
    expect(google.text).toContain('Sign in again https://map.test/sign-in');
    expect(google.text).not.toMatch(/unsubscribe/i);
    expect(google.html).not.toMatch(/unsubscribe/i);
    expect(google.text).toMatchSnapshot();
    expect(google.html).toMatchSnapshot();
  });
});

describe('every template', () => {
  it('says PartnerStandard Desk, never the MAP app’s name, and has no em dash', async () => {
    const emails = [
      await nudgeEmail({ personName: 'Ben Ito', items: [late, soon], unsubscribeUrl: UNSUB }),
      await digestEmail({ recipientName: 'Anna Keller', audience: { kind: 'partner', ownerName: 'Anna Keller' }, sections: [], unsubscribeUrl: UNSUB }),
      await momentumEmail({ partnerName: 'Brightwave', state: 'at_risk', days: 15, suggestion: 'x', planUrl: PLAN_URL, unsubscribeUrl: UNSUB }),
      await partnerAlertEmail({ partnerName: 'Brightwave', lines: ['x'], planUrl: PLAN_URL, unsubscribeUrl: UNSUB }),
      await reconnectEmail({ ownerName: 'Anna Keller', signInUrl: 'https://map.test/sign-in' }),
    ];
    for (const email of emails) {
      expect(email.text).toContain('PartnerStandard Desk');
      expect(`${email.subject}${email.text}`).not.toMatch(/—|PartnerStandard MAP/);
    }
  });
});
