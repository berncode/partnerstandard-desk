// The checks behind public-check.mjs (plan 18, task 5), pure so a test can run them: no files, no git, no exit.

/** Domains an example or a test may use (RFC 2606 and the like); the whole domain must be one of them. */
const SAFE_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;
/** Addresses nobody reads, as written in commit trailers and git URLs. */
const SAFE_ADDRESSES = new Set(['noreply@anthropic.com', 'git@github.com']);

export const isSafeAddress = (address) => SAFE_ADDRESSES.has(address.toLowerCase()) || SAFE_DOMAIN.test(address);

/** What looks private or secret, each with the words it is reported with. */
export const CHECKS = [
  // A domain ends in letters: `pkg@1.7.15` is a version, not an address.
  ['an email address', /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g, (m) => !isSafeAddress(m)],
  ['a Google OAuth client id', /\b\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/g],
  ['a Google client secret', /\bGOCSPX-[\w-]{20,}/g],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['a Google refresh token', /\b1\/\/0[\w-]{30,}/g],
  ['a Resend key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{60,}/g],
  ['a signed token', /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
];

/** The old, private list of owner steps: the public one at the same path is short and has no Copy review. */
export const isPrivateFile = (path, text) => path === 'docs/open-items.md' && /^## Copy review$/m.test(text);

/** Files not read: pictures, fonts, documents and the lockfile. */
export const isSkipped = (path) => /\.(png|jpe?g|gif|ico|svg|woff2?|pdf|xlsx)$/i.test(path) || path === 'pnpm-lock.yaml';

/** One regular expression per line; `#` starts a comment. Throws with the line when one is not valid. */
export function parsePatterns(text, where) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    try {
      return new RegExp(l, 'gi');
    } catch {
      throw new Error(`${where}: not a regular expression: ${l}`);
    }
  });
}

const matches = (pattern, text) => {
  pattern.lastIndex = 0;
  return pattern.test(text);
};

/**
 * Every finding in one file. An allow pattern is tried on the finding as reported (`path:line: what: match`), so it can
 * name a file or a line as well as an address.
 */
export function findingsIn(path, text, { privatePatterns = [], allowed = [] } = {}) {
  if (isPrivateFile(path, text)) return [`${path}: stays in the private archive`];
  const found = [];
  const report = (line, what, match) => {
    const finding = `${path}:${line}: ${what}: ${match}`;
    if (!allowed.some((p) => matches(p, finding))) found.push(finding);
  };
  for (const pattern of privatePatterns) for (const [match] of path.matchAll(pattern)) report(0, 'a private pattern in the file name', match);
  if (isSkipped(path)) return found;
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [what, pattern, keep = () => true] of CHECKS) for (const [match] of line.matchAll(pattern)) if (keep(match)) report(i + 1, what, match);
    for (const pattern of privatePatterns) for (const [match] of line.matchAll(pattern)) report(i + 1, 'a private pattern', match);
  });
  return found;
}
