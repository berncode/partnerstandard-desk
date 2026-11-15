// @vitest-environment jsdom
// The page the API's error answers point to: https://desk.partnerstandard.com/problems/<code> (question 26).
import { API_PROBLEMS } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { statusFor, type RestCode } from '@/agents/rest';
import { problemsDoc } from './doc';

// Every code the API answers: the commands' own (`StoreErrorCode` and 'forbidden'), and the REST layer's.
const CODES: Record<RestCode | 'unauthorized' | 'too_large', true> = {
  invalid: true, unauthorized: true, forbidden: true, not_found: true, file_not_found: true, not_found_route: true,
  conflict: true, structure: true, old_version: true, too_large: true, auth: true, rate_limited: true, unavailable: true, quota: true,
};

describe('the API problems page', () => {
  it('has one entry per code the API answers, each with the status the API sends', () => {
    expect(API_PROBLEMS.entries.map((e) => e.code).sort()).toEqual(Object.keys(CODES).sort());
    const own: Record<string, number> = { unauthorized: 401, too_large: 413 };
    for (const entry of API_PROBLEMS.entries) {
      expect(entry.status, entry.code).toBe(own[entry.code] ?? statusFor(entry.code as RestCode));
      expect(entry.text, entry.code).not.toContain("—");
    }
  });

  it('shows each code as a heading with its own anchor, and no effective date', async () => {
    const { LegalDocument } = await import('@/ui/legal-document');
    render(<LegalDocument doc={problemsDoc()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(API_PROBLEMS.title);
    const conflict = screen.getByRole('heading', { level: 2, name: 'conflict' });
    expect(conflict.id).toBe('conflict');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(API_PROBLEMS.entries.length);
    expect(document.body.textContent).not.toContain('Effective date');
    expect(document.body.textContent).toContain('Status 409.');
  });
});
