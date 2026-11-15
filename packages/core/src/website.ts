const LEGAL_FORMS = new Set(['gmbh', 'ag', 'ltd', 'inc', 'llc', 'sa', 'sas', 'srl', 'bv', 'kg', 'ug', 'plc', 'co']);

/** The lower-case host without "www.", or null when the value has no dot-containing host. */
export function domainOf(website: string): string | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** The company name in lower case, without punctuation, spaces and legal forms. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '') // "S.r.l." -> "srl"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word && !LEGAL_FORMS.has(word))
    .join('');
}

/** Same domain when both have one; otherwise the same company name. */
export function sameCompany(a: { website: string; company: string }, b: { website: string; company: string }): boolean {
  const da = domainOf(a.website);
  const db = domainOf(b.website);
  if (da && db) return da === db;
  const ka = companyKey(a.company);
  return ka !== '' && ka === companyKey(b.company);
}

/** The trimmed value if it starts with http:// or https://, else null. */
export function safeHref(website: string): string | null {
  const trimmed = website.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}
