// The text of THIRD_PARTY_LICENSES: every open source package the image hands out, with its own license and notice
// files. MIT, BSD, ISC, Apache 2.0 and others ask that their notice goes with every copy. No I/O here: the caller
// hands in how to list a folder and read a file.

const OURS = /^@partner-desk\//;
export const NOTICE_FILE = /^(licen[sc]e|copying|notice|unlicense|third-?party-?(notices?|licen[sc]es?)|copyrightnotice)([.-].*)?$/i;

/**
 * @param {Record<string, Array<{ name: string, versions: string[], paths: string[], license: string, homepage?: string }>>} listing
 *   what `pnpm licenses list --prod --json` prints
 * @param {{ list: (dir: string) => string[], read: (path: string) => string }} io
 */
export function noticesFrom(listing, io) {
  const byName = new Map();
  for (const pkg of Object.values(listing).flat()) {
    if (OURS.test(pkg.name)) continue;
    const seen = byName.get(pkg.name) ?? { ...pkg, versions: [], paths: [], licenses: [] };
    seen.versions.push(...pkg.versions);
    seen.paths.push(...pkg.paths);
    seen.licenses.push({ license: pkg.license, versions: pkg.versions });
    byName.set(pkg.name, seen);
  }
  const packages = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rule = '-'.repeat(80);
  const parts = [
    [
      'PartnerStandard Desk: licenses of the open source packages it is built with',
      '',
      `This image contains ${packages.length} packages by other authors, each under its own license, listed below.`,
      'PartnerStandard Desk itself: LICENSE (AGPL-3.0-only) and packages/method/LICENSE (CC BY 4.0).',
    ].join('\n'),
  ];
  for (const pkg of packages) {
    const inOrder = (versions) => [...new Set(versions)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const versions = inOrder(pkg.versions).join(', ');
    // One name under two licenses (an old and a new version): each license with its versions.
    const names = [...new Set(pkg.licenses.map((l) => l.license))];
    const license = names.length === 1
      ? names[0]
      : pkg.licenses.map((l) => ({ ...l, versions: inOrder(l.versions) }))
        .sort((a, b) => a.versions[0].localeCompare(b.versions[0], 'en', { numeric: true }))
        .map((l) => `${l.license} (${l.versions.join(', ')})`).join(', ');
    const head = [`${pkg.name}${versions ? ` ${versions}` : ''}`, `License: ${license}`, ...(pkg.homepage ? [pkg.homepage] : [])];
    const texts = [];
    for (const dir of pkg.paths) {
      for (const file of io.list(dir).filter((name) => NOTICE_FILE.test(name)).sort()) {
        const text = io.read(`${dir}/${file}`).trim();
        if (text && !texts.includes(text)) texts.push(text);
      }
    }
    // A license text after an empty line; the one-line note for a package without one right under its head.
    const body = texts.length > 0
      ? texts.map((text) => `\n${text}`)
      : [`(This package ships no license file. ${names.map((name) => `The text of its license: https://spdx.org/licenses/${encodeURIComponent(name)}.html`).join(' ')})`];
    parts.push([...head, ...body].join('\n'));
  }
  return `${parts.join(`\n\n${rule}\n\n`)}\n`;
}
