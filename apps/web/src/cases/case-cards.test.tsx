// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), toastError: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/app/(signed-in)/actions/cases', () => ({ caseCopy: vi.fn(), caseDelete: vi.fn() }));

const { CaseCards } = await import('./case-cards');
const { StorageProvider } = await import('@/storage-context');
import type { CaseCardRow } from './case-rows';

const rows: CaseCardRow[] = [
  {
    caseId: 'case_1', title: 'Case of 30 Oct 2026', createdAt: '2026-10-30T10:00:00.000Z', partnerType: 'reseller',
    heading: 'Acme as reseller', partner: { company: 'Acme', href: '/partners/a_1?type=reseller' }, typeGone: false,
  },
  {
    caseId: 'case_2', title: 'Expansion', createdAt: '2026-10-29T10:00:00.000Z', partnerType: 'technology',
    heading: 'Acme as technology partner', partner: { company: 'Acme', href: '/partners/a_1?type=technology' }, typeGone: false,
  },
  { caseId: 'case_3', title: 'Old idea', createdAt: '2026-10-28T10:00:00.000Z', partnerType: 'reseller', heading: 'Reseller', partner: null, typeGone: true },
];

beforeEach(() => vi.clearAllMocks());

describe('CaseCards', () => {
  it('shows each case with its partner and type, its title opening it, when it was made and a link to the partner', () => {
    render(<CaseCards rows={rows} copy={vi.fn()} remove={vi.fn()} />);
    const card = screen.getByRole('article', { name: 'Acme as reseller' });
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('Acme as reseller');
    expect(within(card).getByRole('link', { name: 'Case of 30 Oct 2026' })).toHaveAttribute('href', '/business-cases/case_1/offer');
    expect(card).toHaveTextContent('Made 30 Oct 2026');
    expect(within(card).getByRole('link', { name: 'Go to Acme' })).toHaveAttribute('href', '/partners/a_1?type=reseller');
  });

  it('shows a partner type gone from Partners by its type, says so, and links to no partner', () => {
    render(<CaseCards rows={rows} copy={vi.fn()} remove={vi.fn()} />);
    const card = screen.getByRole('article', { name: 'Reseller' });
    expect(card).toHaveTextContent(COPY.CASE_TYPE_GONE);
    expect(within(card).getAllByRole('link')).toHaveLength(1);
  });

  it('says nothing about the type when Partners couldn’t be read: no partner link and no "gone" line', () => {
    const unread: CaseCardRow = { ...rows[0]!, heading: 'Reseller', partner: null, typeGone: false };
    render(<CaseCards rows={[unread]} copy={vi.fn()} remove={vi.fn()} />);
    const card = screen.getByRole('article', { name: 'Reseller' });
    expect(card).not.toHaveTextContent(COPY.CASE_TYPE_GONE);
    expect(within(card).getAllByRole('link').map((a) => a.textContent)).toEqual(['Case of 30 Oct 2026']);
  });

  it('a partner type still in Partners links to its partner and says nothing is gone', () => {
    render(<CaseCards rows={[rows[0]!]} copy={vi.fn()} remove={vi.fn()} />);
    expect(screen.getByRole('article', { name: 'Acme as reseller' })).not.toHaveTextContent(COPY.CASE_TYPE_GONE);
  });

  it('copies once however often Copy is pressed, and stays shut while the copy opens', async () => {
    const copy = vi.fn().mockResolvedValue({ ok: true, caseId: 'case_new' });
    const user = userEvent.setup();
    render(<CaseCards rows={[rows[0]!]} copy={copy} remove={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Copy Case of 30 Oct 2026, Acme as reseller' });
    await user.click(button);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    await user.click(button);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('filters by partner type, offering only the types the cases have, in the method’s order', async () => {
    const user = userEvent.setup();
    render(<CaseCards rows={rows} copy={vi.fn()} remove={vi.fn()} />);
    const filter = screen.getByLabelText('Partner type');
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All partner types', 'Technology Partner', 'Reseller']);
    await user.selectOptions(filter, 'reseller');
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Acme as reseller', 'Reseller']);
    await user.selectOptions(filter, '');
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('has no filter while every case is of one type', () => {
    render(<CaseCards rows={[rows[0]!]} copy={vi.fn()} remove={vi.fn()} />);
    expect(screen.queryByLabelText('Partner type')).toBeNull();
  });

  it('copies a case and opens the copy, reading the page again first', async () => {
    const copy = vi.fn().mockResolvedValue({ ok: true, caseId: 'case_new' });
    const user = userEvent.setup();
    render(<CaseCards rows={rows} copy={copy} remove={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Copy Case of 30 Oct 2026, Acme as reseller' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/business-cases/case_new/offer'));
    expect(copy).toHaveBeenCalledWith({ caseId: 'case_1' });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('says why a copy was refused, and stays', async () => {
    const copy = vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', message: 'Not now.' });
    const user = userEvent.setup();
    render(<CaseCards rows={rows} copy={copy} remove={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Copy Expansion, Acme as technology partner' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Not now.'));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('asks before Delete, and the card leaves once the case is gone', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, caseId: 'case_2' });
    const user = userEvent.setup();
    render(<CaseCards rows={rows} copy={vi.fn()} remove={remove} />);
    await user.click(screen.getByRole('button', { name: 'Delete Expansion, Acme as technology partner' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Expansion?' });
    expect(dialog).toHaveTextContent(COPY.CASE_DELETE_TEXT('Expansion'));
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete case' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Acme as technology partner' })).toBeNull());
    expect(remove).toHaveBeenCalledWith({ caseId: 'case_2' });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('keeps the dialog open with the reason when Delete is refused', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', message: 'Google isn’t answering.' });
    const user = userEvent.setup();
    render(<CaseCards rows={rows} copy={vi.fn()} remove={remove} />);
    await user.click(screen.getByRole('button', { name: 'Delete Expansion, Acme as technology partner' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete case' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Google isn’t answering.');
    // The dialog hides the page from screen readers while it is open.
    expect(screen.getByRole('article', { name: 'Acme as technology partner', hidden: true })).toBeInTheDocument();
  });
});

describe('CaseCards for a company server’s viewer (owner, 2026-11-14)', () => {
  it('shows a viewer each case with no Copy and no Delete', () => {
    render(<StorageProvider storage="database" viewer><CaseCards rows={rows} copy={vi.fn()} remove={vi.fn()} /></StorageProvider>);
    const card = screen.getByRole('article', { name: 'Acme as reseller' });
    expect(within(card).getByRole('link', { name: 'Case of 30 Oct 2026' })).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('shows an admin or a partner manager Copy and Delete', () => {
    render(<StorageProvider storage="database"><CaseCards rows={rows} copy={vi.fn()} remove={vi.fn()} /></StorageProvider>);
    const card = screen.getByRole('article', { name: 'Acme as reseller' });
    expect(within(card).getByRole('button', { name: /^Copy/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^Delete/ })).toBeInTheDocument();
  });
});
