import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE_PAGES } from '@partner-desk/copy';
import { describe, expect, it } from 'vitest';

describe('the guide’s page links', () => {
  it.each([...GUIDE_PAGES])('%s is a page of the app', (page) => {
    expect(existsSync(join(__dirname, '..', 'app', '(signed-in)', page, 'page.tsx'))).toBe(true);
  });
});
