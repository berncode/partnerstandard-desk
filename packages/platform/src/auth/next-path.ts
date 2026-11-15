const BASE = 'http://app.invalid';

/** A post-login destination that stays inside the app: any other value (absolute, protocol-relative, backslash tricks) gives `fallback`. */
export function safeNextPath(value: unknown, fallback = '/this-week'): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    const path = url.pathname + url.search + url.hash;
    // Dot segments can leave a path like '//evil.test', which a later resolve treats as another host.
    if (path.startsWith('//') || path.includes('\\')) return fallback;
    return new URL(path, BASE).origin === BASE ? path : fallback;
  } catch {
    return fallback;
  }
}
