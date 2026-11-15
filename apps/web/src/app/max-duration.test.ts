import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A save to Google can take up to 25 seconds plus the lock, so a page that saves must be allowed 60 (Recruitment's rule).
// Add each page that uses the editor here.
const SAVING_PAGES = [
  '(signed-in)/markets/page.tsx', '(signed-in)/markets/new/page.tsx', '(signed-in)/markets/copy/page.tsx','(signed-in)/partners/page.tsx', '(signed-in)/partners/[accountId]/page.tsx',
  '(signed-in)/markets/[marketId]/page.tsx', '(signed-in)/settings/page.tsx', '(signed-in)/company-facts/page.tsx',
  '(signed-in)/programs/new/page.tsx', '(signed-in)/programs/[programId]/[step]/page.tsx',
  '(signed-in)/programs/[programId]/sheet/page.tsx', '(signed-in)/programs/[programId]/public/page.tsx',
  '(signed-in)/business-cases/page.tsx', '(signed-in)/business-cases/new/page.tsx', '(signed-in)/business-cases/[caseId]/offer/page.tsx'];

describe('pages that save', () => {
  it.each(SAVING_PAGES)('%s allows 60 seconds', (page) => {
    expect(readFileSync(join(__dirname, page), 'utf8')).toMatch(/^export const maxDuration = 60;$/m);
  });
});
