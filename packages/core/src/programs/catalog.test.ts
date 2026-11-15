// The program catalog's data lives in packages/method (owner, 2026-11-10: method content, CC BY 4.0). Pinned here so a
// change to it is seen and reviewed, not taken in passing.
import { describe, expect, it } from 'vitest';
import { BADGE_URL, BENEFITS, CERTIFICATE_URL, GROUPS, KIND, MODELS, OUT, PLURAL, PREF_REQ, PROGRAM_TYPES, TYPE_DESC, WHO_INVOICES } from './catalog';

describe('the program catalog', () => {
  it('holds the same data as before it moved to the method package', () => {
    expect({ TYPE_DESC, PLURAL, GROUPS, OUT, KIND, PROGRAM_TYPES, WHO_INVOICES, MODELS, BENEFITS, PREF_REQ, CERTIFICATE_URL, BADGE_URL }).toMatchSnapshot();
  });
});
