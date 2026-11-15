// The notices of the open source packages the image hands out (scripts/release/third-party-licenses.mjs): their
// licenses ask that the notice goes with every copy.
import { describe, expect, it } from 'vitest';
import { noticesFrom } from '../../../scripts/release/third-party-licenses-lib.mjs';

const files: Record<string, Record<string, string>> = {
  '/m/zeta': { 'package.json': '{}', LICENSE: 'MIT License\nCopyright (c) Zeta' },
  '/m/alpha': { 'index.js': '', 'LICENSE.md': 'Apache License 2.0', NOTICE: 'Alpha, by Alpha Inc.' },
  '/m/bare': { 'index.js': '' },
  '/m/twice-old': { LICENSE: 'ISC License' },
  '/m/twice-new': { 'LICENSE.md': 'Blue Oak Model License' },
  '/m/tools': { 'ThirdPartyNotices.txt': 'Parts by others', 'CopyrightNotice.txt': 'Copyright Tools', 'THIRD-PARTY-LICENSE': 'More parts' },
};
const io = {
  list: (dir: string) => Object.keys(files[dir] ?? {}),
  read: (path: string) => files[path.slice(0, path.lastIndexOf('/'))]![path.slice(path.lastIndexOf('/') + 1)]!,
};
const listing = {
  MIT: [
    { name: 'zeta', versions: ['2.0.0', '1.0.0'], paths: ['/m/zeta'], license: 'MIT', homepage: 'https://zeta.example' },
    { name: 'bare', versions: ['0.1.0'], paths: ['/m/bare'], license: 'MIT' },
    { name: '@partner-desk/core', versions: ['0.1.0'], paths: ['/m/core'], license: 'AGPL-3.0-only' },
  ],
  'Apache-2.0': [
    { name: 'alpha', versions: ['3.1.0'], paths: ['/m/alpha'], license: 'Apache-2.0' },
    { name: 'tools', versions: ['1.0.0'], paths: ['/m/tools'], license: 'Apache-2.0' },
  ],
  ISC: [{ name: 'twice', versions: ['5.1.1'], paths: ['/m/twice-old'], license: 'ISC' }],
  'BlueOak-1.0.0': [{ name: 'twice', versions: ['11.5.3'], paths: ['/m/twice-new'], license: 'BlueOak-1.0.0' }],
  'LGPL-3.0-or-later': [{ name: 'libpics', versions: ['1.2.0'], paths: ['/m/none'], license: 'LGPL-3.0-or-later' }],
};

describe('third-party licenses', () => {
  const text = noticesFrom(listing, io);

  it('lists every package once, by name, with its versions, license and address', () => {
    expect(text.indexOf('alpha 3.1.0')).toBeGreaterThan(-1);
    expect(text.indexOf('alpha 3.1.0')).toBeLessThan(text.indexOf('bare 0.1.0'));
    expect(text.indexOf('bare 0.1.0')).toBeLessThan(text.indexOf('zeta 1.0.0, 2.0.0'));
    expect(text).toContain('License: Apache-2.0');
    expect(text).toContain('https://zeta.example');
  });

  it("carries each package's own license and notice files", () => {
    expect(text).toContain('Copyright (c) Zeta');
    expect(text).toContain('Apache License 2.0');
    expect(text).toContain('Alpha, by Alpha Inc.');
  });

  it('says so when a package ships no license file, and leaves out our own packages', () => {
    expect(text).toContain('bare 0.1.0\nLicense: MIT\n(This package ships no license file. The text of its license: https://spdx.org/licenses/MIT.html)');
    expect(text).toContain('The text of its license: https://spdx.org/licenses/LGPL-3.0-or-later.html');
    expect(text).not.toContain('@partner-desk/core');
  });

  it('counts the packages on its first lines', () => {
    expect(text.split('\n').slice(0, 6).join('\n')).toContain('6 packages');
  });

  it('names each license of a package that has two versions under two licenses', () => {
    expect(text).toContain('twice 5.1.1, 11.5.3\nLicense: ISC (5.1.1), BlueOak-1.0.0 (11.5.3)');
    expect(text).toContain('ISC License');
    expect(text).toContain('Blue Oak Model License');
  });

  it('carries third-party and copyright notice files too', () => {
    for (const part of ['Parts by others', 'Copyright Tools', 'More parts']) expect(text).toContain(part);
  });
});
