// Where a webhook may send (agents spec 7.4): hosted, only https and only to public addresses, so nobody can make
// PartnerStandard Desk call into Vercel's or anyone's inside network. Self-hosted may allow http and local addresses
// (WEBHOOKS_ALLOW_PRIVATE=1, never on Vercel).
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { TargetCheck } from '@partner-desk/commands';

export type { TargetCheck };

/**
 * Private, local and otherwise not public addresses. Node's BlockList also matches an IPv6 address that holds an IPv4
 * one (`::ffff:127.0.0.1`, `::ffff:7f00:1`) against the IPv4 rules. Multicast, reserved (240.0.0.0/4 and the broadcast
 * address, both inside 224.0.0.0/3), benchmarking (198.18.0.0/15), IETF (192.0.0.0/24) and documentation ranges
 * (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, `2001:db8::/32`) and IPv6 site-local (`fec0::/10`) are refused too
 * [builder's call]: no webhook receiver lives there.
 */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) PRIVATE.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32],
] as const) PRIVATE.addSubnet(network, prefix, 'ipv6');

/**
 * IPv6 ranges that carry an IPv4 address some other way, refused outright whatever the IPv4 address is: NAT64
 * (`64:ff9b::/96`, `64:ff9b:1::/48`), IPv4-compatible (`::/96`, so `[::127.0.0.1]`), SIIT's translated form
 * (`::ffff:0:0:0/96`), 6to4 (`2002::/16`) and Teredo (`2001::/32`) [builder's call: no webhook receiver needs them].
 * A list of their own, checked for IPv6 addresses only: in one list with the IPv4 rules, BlockList would match plain
 * IPv4 addresses against them.
 */
const EMBEDS_IPV4 = new BlockList();
for (const [network, prefix] of [
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['::', 96], ['::ffff:0:0:0', 96], ['2002::', 16], ['2001::', 32],
] as const) EMBEDS_IPV4.addSubnet(network, prefix, 'ipv6');

/** True for an address in a private, local or reserved range. Anything that isn't an IP address counts as private. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return PRIVATE.check(address, 'ipv4');
  return PRIVATE.check(address, 'ipv6') || EMBEDS_IPV4.check(address, 'ipv6');
}

/** How long a name may take to resolve [builder's call]. */
export const RESOLVE_TIMEOUT_MS = 5_000;

/** Every address a host resolves to, IPv4 and IPv6; a name that takes over 5 seconds throws. */
export async function resolveAll(host: string): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('resolve_timeout')), RESOLVE_TIMEOUT_MS); });
  try {
    return (await Promise.race([dnsLookup(host, { all: true, verbatim: true }), late])).map((a) => a.address);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks a webhook's address before it is saved and again before every delivery. Only http(s) ever; https only unless
 * `allowPrivate`; never a user name or password in it (nothing would send them, so every delivery would fail); then
 * every address the host resolves to must be public (one private answer is enough to refuse). `lookup` replaces DNS in
 * tests. The request itself checks the address it connects to again (`postWebhook`).
 */
export async function checkTarget(
  url: string, opts: { allowPrivate: boolean; lookup?: (host: string) => Promise<string[]> },
): Promise<TargetCheck> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'not_https' };
  }
  const httpOk = opts.allowPrivate && parsed.protocol === 'http:';
  if (parsed.protocol !== 'https:' && !httpOk) return { ok: false, reason: 'not_https' };
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'has_credentials' };
  if (opts.allowPrivate) return { ok: true };
  // The URL parser writes an IPv6 host in brackets and every IPv4 spelling (2130706433, 0x7f.1) as a.b.c.d.
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0) return isPrivateAddress(host) ? { ok: false, reason: 'private_address' } : { ok: true };
  let addresses: string[];
  try {
    addresses = await (opts.lookup ?? resolveAll)(host);
  } catch {
    return { ok: false, reason: 'unresolvable' };
  }
  if (addresses.length === 0) return { ok: false, reason: 'unresolvable' };
  return addresses.some(isPrivateAddress) ? { ok: false, reason: 'private_address' } : { ok: true };
}
