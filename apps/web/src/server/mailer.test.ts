import { describe, expect, it, vi } from 'vitest';
import { AllowlistMailer, MemoryMailer, RESEND_API, ResendMailer } from './mailer';

const message = { to: 'lena@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', replyTo: 'anna@example.com' };

describe('ResendMailer', () => {
  it('posts one email to Resend with the sender, reply-to and both bodies, and keeps Resend’s id', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: 'email_1' }));
    const mailer = new ResendMailer({ apiKey: 're_test', from: 'PartnerStandard Desk <desk@example.com>', fetch });
    expect(await mailer.send(message)).toEqual({ ok: true, id: 'email_1' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(RESEND_API);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer re_test');
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'PartnerStandard Desk <desk@example.com>', to: ['lena@example.com'], subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', reply_to: 'anna@example.com',
    });
  });

  it('sends extra headers, such as List-Unsubscribe', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: 'email_2' }));
    const headers = { 'List-Unsubscribe': '<https://map.test/api/unsubscribe/t>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    await new ResendMailer({ apiKey: 're_test', from: 'x@example.com', fetch }).send({ ...message, headers });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).headers).toEqual(headers);
  });

  it('still reports a send whose reply it can’t read, without an id', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('accepted', { status: 200 }));
    expect(await new ResendMailer({ apiKey: 're_test', from: 'x@example.com', fetch }).send(message)).toEqual({ ok: true, id: null });
  });

  it('reports a refused or failed send without retrying or throwing', async () => {
    for (const outcome of [Response.json({ name: 'validation_error', message: 'bad' }, { status: 422 }), new TypeError('fetch failed')]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => { if (outcome instanceof Error) throw outcome; return outcome; });
      const mailer = new ResendMailer({ apiKey: 're_test', from: 'x@example.com', fetch });
      expect(await mailer.send(message)).toEqual({ ok: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves reply-to and headers out when there are none', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: 'email_1' }));
    await new ResendMailer({ apiKey: 're_test', from: 'x@example.com', fetch }).send({ ...message, replyTo: undefined });
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body).not.toHaveProperty('reply_to');
    expect(body).not.toHaveProperty('headers');
  });
});

describe('MemoryMailer', () => {
  it('keeps what it was asked to send, with an id per message', async () => {
    const mailer = new MemoryMailer();
    expect(await mailer.send(message)).toEqual({ ok: true, id: 'mem_1' });
    expect(await mailer.send(message)).toEqual({ ok: true, id: 'mem_2' });
    expect(mailer.outbox).toEqual([message, message]);
  });
});

describe('AllowlistMailer (staging)', () => {
  it('sends to an address on the list, drops every other one and logs the drop with ids only', async () => {
    const inner = new MemoryMailer();
    const log = vi.fn();
    const mailer = new AllowlistMailer(inner, ['ruth@example.com'], log);
    expect(await mailer.send({ ...message, to: ' Ruth@Example.com ' })).toEqual({ ok: true, id: 'mem_1' });
    expect(await mailer.send({ ...message, subject: 'SECRET plan' }, { mapId: 'map_0123456789' })).toEqual({ ok: true, id: null });
    expect(inner.outbox.map((m) => m.to)).toEqual([' Ruth@Example.com ']);
    expect(log).toHaveBeenCalledWith('email_dropped_not_allowed', { mapId: 'map_0123456789' });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/lena|example|SECRET/);
  });
});
