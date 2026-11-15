// @vitest-environment jsdom
// Open in Google Sheets is a link to the program's file, and Review Focus 4 (empty Company facts) on the Program Sheet.
import { newCompanyFacts, programSheet, publicBlocks, publicPlain } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NORTHWIND, RESELLER, rewritten, showProgram, STAMP, stubOutputs } from './test-harness';

const nav = vi.hoisted(() => ({ pathname: '/programs/pg_resellerdd/sheet', push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
}));

const { ProgramSheetScreen } = await import('./program-sheet');
const { StorageProvider } = await import('@/storage-context');
const { PublicPageScreen } = await import('./public-page');

let outputs: ReturnType<typeof stubOutputs>;

describe('Program Sheet', () => {
  beforeEach(() => {
    nav.pathname = '/programs/pg_resellerdd/sheet';
    outputs = stubOutputs();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the sheet of the program on screen and rewrites the stored copy when it opens', async () => {
    showProgram(<ProgramSheetScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Program Sheet' })).toBeInTheDocument();
    expect(screen.getByText('Reseller program')).toBeInTheDocument();
    const sheet = screen.getByRole('article', { name: RESELLER.name });
    const content = programSheet(NORTHWIND, RESELLER, 'Northwind Security');
    expect(sheet).toHaveTextContent(content.money[1]!);
    expect(sheet).toHaveTextContent('Northwind Security · internal, not for partners');
    expect(within(screen.getByRole('navigation', { name: COPY.PROG_SCREENS })).getByRole('link', { name: 'Program Sheet' })).toHaveAttribute('aria-current', 'page');
    // The program and its Program Sheet open together: one rewrite, not two.
    await waitFor(() => expect(rewritten(outputs)).toEqual([['pg_resellerdd']]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rewritten(outputs)).toEqual([['pg_resellerdd']]);
  });

  it('Download PDF opens the browser’s print dialog; the sheet alone prints', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { user } = showProgram(<ProgramSheetScreen />);
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(print).toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: COPY.PROG_SCREENS })).toHaveClass('print:hidden');
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveClass('print:hidden');
  });

  it('Open in Google Sheets links to the program’s file; a test user has no file to open', () => {
    const view = showProgram(<ProgramSheetScreen />, { fileUrl: 'https://docs.google.com/spreadsheets/d/abc' });
    expect(screen.getByRole('link', { name: 'Open in Google Sheets' })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/abc');
    view.unmount();
    showProgram(<ProgramSheetScreen />);
    expect(screen.queryByRole('link', { name: 'Open in Google Sheets' })).not.toBeInTheDocument();
  });

  it('on a company server downloads the file in place, only after the save and the rewrite (task 12’s review)', async () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.getAttribute('href')} ${this.hasAttribute('download')}`);
    });
    const { user } = showProgram(<StorageProvider storage="database"><ProgramSheetScreen /></StorageProvider>, { fileUrl: '/files/wf_aaaaaaaaaaaaaaaaaaaa/download' });
    await waitFor(() => expect(rewritten(outputs)).toEqual([['pg_resellerdd']]));
    const link = screen.getByRole('link', { name: 'Download as a spreadsheet' });
    expect(link).toHaveAttribute('download', '');
    expect(link).not.toHaveAttribute('target');
    await user.click(link);
    await waitFor(() => expect(downloads).toEqual([expect.stringMatching(/\/files\/wf_a{20}\/download true$/)]));
    vi.restoreAllMocks();
  });

  it('Review Focus 4: with empty Company facts the sheet says what to fill in, never NaN, 0 or Infinity', () => {
    showProgram(<ProgramSheetScreen />, { facts: { ...newCompanyFacts('co_aaaaaaaaaa'), updatedAt: STAMP } });
    const sheet = screen.getByRole('article', { name: RESELLER.name });
    expect(sheet).toHaveTextContent(COPY.FACTS_DIRECT_UNKNOWN);
    expect(sheet).toHaveTextContent(COPY.PROGRAM_CUSTOMER_UNKNOWN);
    expect(sheet.textContent).not.toMatch(/NaN|Infinity|€0(?![.,\d])|€0\.00/);
  });

  it('says so when the stored copy couldn’t be rewritten', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ failed: ['pg_resellerdd'], refused: [] })));
    showProgram(<ProgramSheetScreen />);
    expect(await screen.findByText(COPY.PROG_REWRITE_FAILED)).toBeInTheDocument();
  });
});

describe('Public page', () => {
  beforeEach(() => {
    nav.pathname = '/programs/pg_resellerdd/public';
    stubOutputs();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the draft and copies it as plain text', async () => {
    const { user } = showProgram(<PublicPageScreen />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    expect(screen.getByRole('heading', { level: 1, name: 'Public page' })).toBeInTheDocument();
    expect(screen.getByText(COPY.PROG_PUBLIC_HINT)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: `The ${RESELLER.name}` })).toHaveTextContent('Why partners join');
    await user.click(screen.getByRole('button', { name: 'Copy text' }));
    expect(writeText).toHaveBeenCalledWith(publicPlain(publicBlocks(NORTHWIND, RESELLER)));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says how to copy by hand when the browser blocks it', async () => {
    const { user } = showProgram(<PublicPageScreen />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('blocked'));
    await user.click(screen.getByRole('button', { name: 'Copy text' }));
    expect(await screen.findByText(COPY.PROG_COPY_BLOCKED)).toBeInTheDocument();
  });
});
