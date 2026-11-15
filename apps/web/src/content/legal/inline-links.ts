export type InlinePart = { text: string } | { text: string; href: string } | { text: string; strong: true } | { text: string; code: true };

/** `[text](href)`, `**bold**` or `` `code` ``. Nothing nests: the legal text never needs it. */
const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|`([^`]+)`/g;

/** Splits a legal-text string into plain, link, bold and code parts. Unmatched markers stay plain text. */
export function inlineLinks(source: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    const [whole, linkText, href, strong, code] = match;
    if (href !== undefined && linkText !== undefined) parts.push({ text: linkText, href });
    else if (strong !== undefined) parts.push({ text: strong, strong: true });
    else if (code !== undefined) parts.push({ text: code, code: true });
    last = match.index + whole.length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}
