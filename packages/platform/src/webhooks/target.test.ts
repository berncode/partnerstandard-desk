import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTarget, isPrivateAddress, RESOLVE_TIMEOUT_MS, resolveAll } from './target';

/** A DNS answer the test chooses: no network. */
const resolvesTo = (...addresses: string[]) => async () => addresses;
const PUBLIC = resolvesTo('93.184.215.14');

describe('checkTarget (Review Focus 4)', () => {
  it('http is refused', async () => {
    expect(await checkTarget('http://hooks.example.com/in', { allowPrivate: false, lookup: PUBLIC })).toEqual({ ok: false, reason: 'not_https' });
    expect(await checkTarget('ftp://hooks.example.com/in', { allowPrivate: false, lookup: PUBLIC })).toEqual({ ok: false, reason: 'not_https' });
    expect(await checkTarget('not a url', { allowPrivate: false, lookup: PUBLIC })).toEqual({ ok: false, reason: 'not_https' });
  });

  it('a public https address passes', async () => {
    expect(await checkTarget('https://hooks.example.com/in?x=1', { allowPrivate: false, lookup: PUBLIC })).toEqual({ ok: true });
    expect(await checkTarget('https://93.184.215.14/in', { allowPrivate: false })).toEqual({ ok: true });
  });

  it('169.254.169.254, 10.0.0.5, ::1, ::ffff:127.0.0.1 are private', async () => {
    const never = async () => { throw new Error('no lookup for an address'); };
    for (const host of ['169.254.169.254', '10.0.0.5', '[::1]', '[::ffff:127.0.0.1]', '127.0.0.1', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '[fd00::1]', '[fe80::1]']) {
      expect({ host, check: await checkTarget(`https://${host}/in`, { allowPrivate: false, lookup: never }) })
        .toEqual({ host, check: { ok: false, reason: 'private_address' } });
    }
    // Written another way, the same address: the URL parser makes them 127.0.0.1.
    for (const host of ['2130706433', '0x7f.1', '127.1']) {
      expect(await checkTarget(`https://${host}/in`, { allowPrivate: false, lookup: never })).toEqual({ ok: false, reason: 'private_address' });
    }
  });

  it('IPv6 forms that carry an IPv4 address are refused: NAT64, IPv4-compatible, SIIT, 6to4, Teredo', async () => {
    const never = async () => { throw new Error('no lookup for an address'); };
    for (const host of [
      '[64:ff9b::a00:5]', '[64:ff9b::808:808]', '[64:ff9b:1::a00:5]', '[::127.0.0.1]', '[::808:808]', '[::ffff:0:a00:5]',
      '[2002:a00:5::1]', '[2002:808:808::1]', '[2001:0:4136:e378::1]',
    ]) {
      expect({ host, check: await checkTarget(`https://${host}/in`, { allowPrivate: false, lookup: never }) })
        .toEqual({ host, check: { ok: false, reason: 'private_address' } });
    }
    // A name can answer them too.
    expect(await checkTarget('https://nat64.example.com/in', { allowPrivate: false, lookup: resolvesTo('64:ff9b::a9fe:a9fe') }))
      .toEqual({ ok: false, reason: 'private_address' });
  });

  it('benchmarking, IETF, documentation, reserved and broadcast ranges are refused, and site-local and documentation IPv6', () => {
    for (const address of [
      '198.18.0.1', '198.19.255.254', '192.0.0.8', '192.0.2.10', '198.51.100.7', '203.0.113.200', '240.0.0.1', '255.255.255.255',
      'fec0::1', 'feff::1', '2001:db8::1', '2001:db8:ffff::5',
    ]) {
      expect({ address, private: isPrivateAddress(address) }).toEqual({ address, private: true });
    }
    // Their neighbors are public.
    for (const address of ['198.17.255.254', '198.20.0.1', '192.0.1.1', '192.0.3.1', '198.51.101.1', '203.0.114.1', '2001:db9::1', '2001:4860::8888']) {
      expect({ address, private: isPrivateAddress(address) }).toEqual({ address, private: false });
    }
  });

  it('public addresses, IPv4 and IPv6 and a public IPv4 inside ::ffff:, still pass', () => {
    for (const address of ['8.8.8.8', '93.184.215.14', '2606:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8']) {
      expect({ address, private: isPrivateAddress(address) }).toEqual({ address, private: false });
    }
  });

  it('an address with a user name or password is refused', async () => {
    expect(await checkTarget('https://n8n:secret@hooks.example.com/in', { allowPrivate: false, lookup: PUBLIC })).toEqual({ ok: false, reason: 'has_credentials' });
    expect(await checkTarget('https://n8n@hooks.example.com/in', { allowPrivate: false, lookup: PUBLIC })).toEqual({ ok: false, reason: 'has_credentials' });
    expect(await checkTarget('http://n8n:secret@localhost:5678/in', { allowPrivate: true })).toEqual({ ok: false, reason: 'has_credentials' });
  });

  it('a host resolving to 10.0.0.5 is private', async () => {
    expect(await checkTarget('https://inside.example.com/in', { allowPrivate: false, lookup: resolvesTo('10.0.0.5') }))
      .toEqual({ ok: false, reason: 'private_address' });
    // One private answer among public ones is enough.
    expect(await checkTarget('https://mixed.example.com/in', { allowPrivate: false, lookup: resolvesTo('93.184.215.14', '::ffff:10.0.0.5') }))
      .toEqual({ ok: false, reason: 'private_address' });
  });

  it('a host that resolves to nothing, or fails to resolve, is unresolvable', async () => {
    expect(await checkTarget('https://nowhere.example.com/in', { allowPrivate: false, lookup: resolvesTo() })).toEqual({ ok: false, reason: 'unresolvable' });
    const failing = async () => { throw new Error('ENOTFOUND'); };
    expect(await checkTarget('https://nowhere.example.com/in', { allowPrivate: false, lookup: failing })).toEqual({ ok: false, reason: 'unresolvable' });
  });

  it('allowPrivate lets a local address through', async () => {
    expect(await checkTarget('http://localhost:5678/webhook', { allowPrivate: true, lookup: resolvesTo('127.0.0.1') })).toEqual({ ok: true });
    expect(await checkTarget('https://10.0.0.5/in', { allowPrivate: true })).toEqual({ ok: true });
    // Still only http and https.
    expect(await checkTarget('file:///etc/passwd', { allowPrivate: true })).toEqual({ ok: false, reason: 'not_https' });
  });
});

describe('resolveAll', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('node:dns/promises');
    vi.resetModules();
  });

  it('a name that takes over 5 seconds is unresolvable', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock('node:dns/promises', () => ({ lookup: () => new Promise(() => {}) }));
    const target = await import('./target');
    const pending = target.checkTarget('https://slow.example.com/in', { allowPrivate: false });
    await vi.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ ok: false, reason: 'unresolvable' });
  });

  it('resolves a name to every address', async () => {
    const addresses = await resolveAll('localhost');
    expect(addresses.some((a) => a === '127.0.0.1' || a === '::1')).toBe(true);
  });
});
