// @vitest-environment jsdom
// New for PartnerStandard Desk: the case page's header names the partner, links back, and links to the case's spreadsheet.
import { EXAMPLES, type BusinessCase } from '@partner-desk/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { CaseEditor } = await import('./case-editor');
const { CaseHeader } = await import('./case-header');
const { StorageProvider } = await import('@/storage-context');

const save = vi.fn();
const show = (fileUrl: string | null) =>
  render(
    <CaseEditor initial={structuredClone(EXAMPLES.saas.case) as BusinessCase} save={save}>
      <CaseHeader heading="Acme as reseller" back={{ href: '/partners/x', label: 'Back to Acme' }} typeGone={false} fileUrl={fileUrl} />
    </CaseEditor>,
  );

describe('CaseHeader', () => {
  it('Open in Google Sheets links to the case’s file', () => {
    show('https://docs.google.com/spreadsheets/d/abc');
    const link = screen.getByRole('link', { name: 'Open in Google Sheets' });
    expect(link).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/abc');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('on a company server, the link downloads the case as a spreadsheet, in the same tab (plan 13, task 12)', () => {
    render(
      <StorageProvider storage="database">
        <CaseEditor initial={structuredClone(EXAMPLES.saas.case) as BusinessCase} save={save}>
          <CaseHeader heading="Acme as reseller" back={{ href: '/partners/x', label: 'Back to Acme' }} typeGone={false} fileUrl="https://desk.test/files/wf_0123456789abcdef0123/download" />
        </CaseEditor>
      </StorageProvider>,
    );
    const link = screen.getByRole('link', { name: 'Download as a spreadsheet' });
    expect(link).toHaveAttribute('href', 'https://desk.test/files/wf_0123456789abcdef0123/download');
    expect(link).not.toHaveAttribute('target');
    expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
  });

  it('a test account has no file to open, so no link', () => {
    show(null);
    expect(screen.queryByRole('link', { name: 'Open in Google Sheets' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Acme' })).toBeInTheDocument();
  });

  it('a company server’s viewer reads the title as text, with no way to rename it (owner, 2026-11-14)', () => {
    const title = (EXAMPLES.saas.case as BusinessCase).title;
    render(
      <StorageProvider storage="database" viewer>
        <CaseEditor initial={structuredClone(EXAMPLES.saas.case) as BusinessCase} save={save}>
          <CaseHeader heading="Acme as reseller" back={{ href: '/partners/x', label: 'Back to Acme' }} typeGone={false} fileUrl={null} />
        </CaseEditor>
      </StorageProvider>,
    );
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Title: / })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('an admin or a partner manager renames the title in place', () => {
    show(null);
    expect(screen.getByRole('button', { name: /^Title: / })).toBeInTheDocument();
  });
});
