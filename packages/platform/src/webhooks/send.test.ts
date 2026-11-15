import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWebhook } from './send';

/** A local receiver that notes each request and answers as `answer` says. */
async function receiver(answer: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: Array<{ method?: string; url?: string; headers: IncomingMessage['headers']; body: string }> = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body }); answer(req, res); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, seen };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => { s.closeAllConnections(); s.close(resolve); })));
});

const to = (...addresses: string[]) => vi.fn(async () => addresses);
const base = { body: '{"type":"partner.signed"}', headers: { 'content-type': 'application/json', 'webhook-id': 'evt_1' }, timeoutMs: 2_000 };

describe('postWebhook', () => {
  it('connects to the address its own lookup answered, posts the body and headers, and answers the status', async () => {
    const { port, seen } = await receiver((_req, res) => { res.writeHead(204).end(); });
    const resolve = to('127.0.0.1');
    expect(await postWebhook(`http://hooks.test:${port}/in?x=1`, { ...base, allowPrivate: true, resolve })).toBe(204);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('hooks.test');
    expect(seen).toEqual([expect.objectContaining({ method: 'POST', url: '/in?x=1', body: base.body })]);
    expect(seen[0]!.headers).toMatchObject({ host: `hooks.test:${port}`, 'content-type': 'application/json', 'webhook-id': 'evt_1' });
  });

  it('refuses a name whose lookup answers a private address, before any connection, with one lookup', async () => {
    const { port, seen } = await receiver((_req, res) => { res.writeHead(200).end(); });
    const resolve = to('93.184.215.14', '127.0.0.1');
    expect(await postWebhook(`https://hooks.test:${port}/in`, { ...base, allowPrivate: false, resolve })).toBe(0);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it('refuses a private address in the URL and plain http unless allowed, without a lookup', async () => {
    const { port, seen } = await receiver((_req, res) => { res.writeHead(200).end(); });
    const resolve = to('127.0.0.1');
    expect(await postWebhook(`https://127.0.0.1:${port}/in`, { ...base, allowPrivate: false, resolve })).toBe(0);
    expect(await postWebhook(`http://hooks.test:${port}/in`, { ...base, allowPrivate: false, resolve })).toBe(0);
    expect(await postWebhook(`ftp://hooks.test:${port}/in`, { ...base, allowPrivate: true, resolve })).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('a redirect is the answer, never followed', async () => {
    const { port, seen } = await receiver((_req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/' }).end('moved'); });
    expect(await postWebhook(`http://hooks.test:${port}/in`, { ...base, allowPrivate: true, resolve: to('127.0.0.1') })).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it('a receiver that doesn’t answer in time is 0, after the timeout', async () => {
    const { port } = await receiver(() => { /* never answers */ });
    const started = Date.now();
    expect(await postWebhook(`http://hooks.test:${port}/in`, { ...base, timeoutMs: 200, allowPrivate: true, resolve: to('127.0.0.1') })).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('a name that resolves to nothing, or fails, or a refused connection is 0', async () => {
    expect(await postWebhook('http://hooks.test:9/in', { ...base, allowPrivate: true, resolve: to() })).toBe(0);
    expect(await postWebhook('http://hooks.test:9/in', { ...base, allowPrivate: true, resolve: async () => { throw new Error('ENOTFOUND'); } })).toBe(0);
    const { port } = await receiver(() => {});
    await new Promise((resolve) => servers.pop()!.close(resolve));
    expect(await postWebhook(`http://hooks.test:${port}/in`, { ...base, allowPrivate: true, resolve: to('127.0.0.1') })).toBe(0);
  });
});
