// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LegalDoc } from '@/content/legal/types';
import { anchorOf, LegalDocument } from './legal-document';
import { LegalPage } from './legal-page';

// PartnerStandard Desk's own legal text arrives in task 8; this is a small document in the same shape.
const DOC: LegalDoc = {
  title: 'Sample Policy',
  effective: '2026-10-28',
  intro: ['Read **this** first.'],
  sections: [
    {
      heading: '1. Who we are',
      blocks: [
        'Operator: **PartnerStandard**, see [the hub](https://pro.partnerstandard.com) and [our terms](/terms).',
        { subheading: '1.1 Limited Use' },
        { list: ['One `code.value` item', 'Two'] },
        'Address line one\nAddress line two',
      ],
    },
    { heading: '2. Data', blocks: [{ table: { head: ['Item', 'Why'], rows: [['Cookie', 'Sign-in']] } }] },
  ],
};

describe('LegalDocument', () => {
  it('renders one h1, every section as an h2 and subheadings as h3 with anchors', () => {
    render(<LegalDocument doc={DOC} />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Sample Policy']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['1. Who we are', '2. Data']);
    expect(screen.getByRole('heading', { level: 3, name: '1.1 Limited Use' })).toHaveAttribute('id', '1-1-limited-use');
    expect(screen.getByText('Effective date: 2026-10-28')).toBeInTheDocument();
  });

  it('renders links, bold, code and tables with no raw markup left', () => {
    const { container } = render(<LegalDocument doc={DOC} />);
    const external = screen.getByRole('link', { name: 'the hub' });
    expect(external).toHaveAttribute('href', 'https://pro.partnerstandard.com');
    expect(external).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByRole('link', { name: 'our terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByText('PartnerStandard').tagName).toBe('STRONG');
    expect(container.querySelector('code')?.textContent).toBe('code.value');
    expect(screen.getByRole('columnheader', { name: 'Why' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Sign-in' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\*\*|\]\(|`/);
  });

  it('keeps line breaks in a paragraph', () => {
    render(<LegalDocument doc={DOC} />);
    const address = screen.getByText(/^Address line one/);
    expect(address).toHaveClass('whitespace-pre-line');
    expect(address.textContent).toBe('Address line one\nAddress line two');
  });

  it('makes anchors from headings', () => {
    expect(anchorOf('6.6 Limited Use')).toBe('6-6-limited-use');
  });
});

describe('LegalPage', () => {
  it('wraps the document in the static header and the footer', () => {
    render(<LegalPage doc={DOC} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByRole('contentinfo')).toHaveTextContent('© PartnerStandard Desk');
  });
});
