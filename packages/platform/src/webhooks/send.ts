// One webhook request (agents spec 7.4), sent with node:https (node:http only for an http address that
// WEBHOOKS_ALLOW_PRIVATE lets through, self-hosted). The connection resolves the name through our own lookup, which
// refuses a private answer and hands the checked addresses to the socket: the address checked is the address connected
// to, so a name can't switch to an inside address between the check and the request (DNS rebinding).
import type { LookupAddress, LookupAllOptions, LookupOneOptions } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { isPrivateAddress, resolveAll } from './target';

export interface PostOptions {
  body: string;
  headers: Record<string, string>;
  /** The whole request at most: name lookup, connection, answer [builder's call: 10 seconds]. */
  timeoutMs: number;
  /** Self-hosted only: http, and private or local addresses. */
  allowPrivate: boolean;
  /** Replaces DNS in tests. */
  resolve?: (host: string) => Promise<string[]>;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** Thrown inside the lookup, so the request fails before any connection is made. */
const refused = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

/**
 * POSTs one delivery and answers the HTTP status, or 0 for no answer: refused (not http(s), a private address),
 * unresolvable, timed out or the connection failed. A redirect is never followed (the status, a 3xx, is the answer).
 * Only the status is read; the rest of the answer is drained unread. Never throws.
 */
export function postWebhook(url: string, options: PostOptions): Promise<number> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(0);
  }
  const isHttps = parsed.protocol === 'https:';
  if (!isHttps && !(options.allowPrivate && parsed.protocol === 'http:')) return Promise.resolve(0);
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  // An address in the URL is never looked up: it is checked here.
  if (isIP(host) !== 0 && !options.allowPrivate && isPrivateAddress(host)) return Promise.resolve(0);
  const resolve = options.resolve ?? resolveAll;

  // node:net calls this for a name (never for an address), with `all` when it tries every family.
  const lookup = (hostname: string, lookupOptions: LookupOneOptions | LookupAllOptions, callback: LookupCallback) => {
    resolve(hostname).then((addresses) => {
      if (addresses.length === 0) return callback(refused('unresolvable'), '');
      if (!options.allowPrivate && addresses.some(isPrivateAddress)) return callback(refused('private_address'), '');
      const all = addresses.map((address) => ({ address, family: isIP(address) }));
      if ((lookupOptions as LookupAllOptions).all) return callback(null, all);
      return callback(null, all[0]!.address, all[0]!.family);
    }, () => callback(refused('unresolvable'), ''));
  };

  return new Promise<number>((done) => {
    let settled = false;
    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      done(status);
    };
    const requestOptions: RequestOptions = {
      method: 'POST', protocol: parsed.protocol, hostname: host, port: parsed.port || undefined, path: `${parsed.pathname}${parsed.search}`,
      headers: { ...options.headers, 'content-length': String(Buffer.byteLength(options.body)) },
      // A connection of its own: a pooled socket would skip the lookup and its check.
      agent: false, lookup: lookup as RequestOptions['lookup'],
      // The name, for the certificate check, even though the socket connects to the checked address.
      ...(isHttps && isIP(host) === 0 ? { servername: host } : {}),
    };
    const req = (isHttps ? httpsRequest : httpRequest)(requestOptions, (res) => {
      finish(res.statusCode ?? 0);
      // Drained unread; the timer below still ends a connection that keeps sending.
      res.resume();
      res.on('end', () => clearTimeout(timer));
      res.on('error', () => {});
    });
    const timer = setTimeout(() => {
      finish(0);
      req.destroy(refused('timeout'));
    }, options.timeoutMs);
    req.on('error', () => {
      clearTimeout(timer);
      finish(0);
    });
    req.on('close', () => clearTimeout(timer));
    req.end(options.body);
  });
}
