// @vitest-environment jsdom
// The tabs and their addresses. The case layout keeps one editor, so there are no leave or reload tests.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CaseNav, caseTabOf, caseTabPath } from './case-nav';

describe('CaseNav', () => {
  it('links the four tabs of a case, with their subtitles, the partner named in the first two', () => {
    render(<CaseNav id="case_1" partner="Northwind" current="offer" />);

    const nav = screen.getByRole('navigation', { name: 'Case' });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['1. Offer to Northwind Products and partner terms', '/business-cases/case_1/offer'],
      ['2. Partner case What Northwind gets out of it', '/business-cases/case_1'],
      ['3. Our case Internal: what it’s worth to us', '/business-cases/case_1/ours'],
      ['4. Share The one-pagers, ready to send', '/business-cases/case_1/share'],
    ]);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links.slice(1).every((l) => !l.hasAttribute('aria-current'))).toBe(true);
    // Our case is internal: its subtitle is in the warning color, and a divider sets Share apart.
    expect(screen.getByText('Internal: what it’s worth to us')).toHaveClass('text-warn');
    expect(screen.getByText('What Northwind gets out of it')).not.toHaveClass('text-warn');
    expect(nav.querySelector('[data-divider]')?.previousElementSibling).toBe(links[2]);
  });

  it('marks the page it is on, and none on another address', () => {
    const { rerender } = render(<CaseNav id="case_1" partner="Northwind" current="ours" />);
    expect(screen.getByRole('link', { current: 'page' })).toHaveAttribute('href', '/business-cases/case_1/ours');
    rerender(<CaseNav id="case_1" partner="Northwind" current={null} />);
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });
});

describe('caseTabOf', () => {
  it('reads the tab from the address, the partner case at the case’s own', () => {
    expect(caseTabOf('/business-cases/case_1', 'case_1')).toBe('case');
    expect(caseTabOf('/business-cases/case_1/offer', 'case_1')).toBe('offer');
    expect(caseTabOf('/business-cases/case_1/ours', 'case_1')).toBe('ours');
    expect(caseTabOf('/business-cases/case_1/share', 'case_1')).toBe('share');
    expect(caseTabOf('/business-cases/case_1/other', 'case_1')).toBeNull();
    expect(caseTabOf('/business-cases/case_2/offer', 'case_1')).toBeNull();
    expect(caseTabPath('case_1', 'offer')).toBe('/business-cases/case_1/offer');
  });
});
