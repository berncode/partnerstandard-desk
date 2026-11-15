// @vitest-environment jsdom
import { aPartner, sampleBook } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseAreaRow } from '@/cases/case-rows';

const mocks = vi.hoisted(() => ({ push: vi.fn(), toastError: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: mocks.toastError }) }));

const { CaseArea } = await import('./case-area');
const { renderPartner } = await import('./test-harness');
const { StorageProvider } = await import('@/storage-context');

const book = sampleBook({ partners: [aPartner()] });
const area = () => screen.getByRole('region', { name: 'Business case' });
const row = (over: Partial<CaseAreaRow> = {}): CaseAreaRow => ({
  caseId: 'case_1', title: 'Case of 30 Oct 2026', createdAt: '2026-10-30T10:00:00.000Z',
  numbers: { stageWhenMade: 'recruitment', earnings: 12345.6, net: -800, currency: 'EUR' }, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('CaseArea', () => {
  it('lists the partner type’s cases with when each was made, the stage then and its two numbers', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, rows: [row(), row({ caseId: 'case_2', title: 'Unreadable', numbers: null })] });
    renderPartner(<CaseArea load={load} create={vi.fn()} />, book);
    const items = await within(area()).findAllByRole('listitem');
    expect(load).toHaveBeenCalledWith({ partnerId: 'p_abc123' });
    expect(within(items[0]!).getByRole('link', { name: 'Case of 30 Oct 2026' })).toHaveAttribute('href', '/business-cases/case_1/offer');
    expect(items[0]).toHaveTextContent('Made 30 Oct 2026, in Recruitment');
    expect(items[0]).toHaveTextContent('Over five years: Acme GmbH earns €12,346, and your net value is -€800.');
    expect(items[1]).toHaveTextContent('Made 30 Oct 2026');
    expect(items[1]).toHaveTextContent(COPY.CASE_NUMBERS_UNAVAILABLE);
  });

  it('says when the partner type has no case yet, and why the cases can’t be shown', async () => {
    const { unmount } = renderPartner(<CaseArea load={vi.fn().mockResolvedValue({ ok: true, rows: [] })} create={vi.fn()} />, book);
    expect(await within(area()).findByText(COPY.CASE_AREA_EMPTY)).toBeInTheDocument();
    unmount();
    renderPartner(<CaseArea load={vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', message: 'Not now.' })} create={vi.fn()} />, book);
    expect(await within(area()).findByRole('alert')).toHaveTextContent('Not now.');
  });

  it('makes a new case at once and opens it on its offer tab', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, caseId: 'case_new' });
    const user = userEvent.setup();
    renderPartner(<CaseArea load={vi.fn().mockResolvedValue({ ok: true, rows: [] })} create={create} />, book);
    await user.click(within(area()).getByRole('button', { name: 'New case' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/business-cases/case_new/offer'));
    expect(create).toHaveBeenCalledWith({ partnerId: 'p_abc123' });
  });

  it('asks for the program in a dialog when it must be picked, then makes the case with it', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'invalid', message: COPY.CASE_PICK_PROGRAM, fieldErrors: { programId: COPY.CASE_PICK_PROGRAM } })
      .mockResolvedValueOnce({ ok: true, caseId: 'case_new' });
    const user = userEvent.setup();
    renderPartner(<CaseArea load={vi.fn().mockResolvedValue({ ok: true, rows: [] })} create={create} />, book, {
      programs: [{ programId: 'pg_one', label: 'Reseller', partnerType: 'reseller', title: 'Reseller' }],
    });
    await user.click(within(area()).getByRole('button', { name: 'New case' }));
    const dialog = await screen.findByRole('dialog', { name: 'New case' });
    expect(dialog).toHaveTextContent('Acme GmbH as reseller');
    expect(within(dialog).getByLabelText('Program')).toHaveValue('pg_one');
    await user.click(within(dialog).getByRole('button', { name: 'Make the case' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/business-cases/case_new/offer'));
    expect(create).toHaveBeenLastCalledWith({ partnerId: 'p_abc123', programId: 'pg_one' });
  });

  it('says why a case wasn’t made', async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', message: 'Google isn’t answering.' });
    const user = userEvent.setup();
    renderPartner(<CaseArea load={vi.fn().mockResolvedValue({ ok: true, rows: [] })} create={create} />, book);
    await user.click(within(area()).getByRole('button', { name: 'New case' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Google isn’t answering.'));
  });

  it('offers New case for a closed or exited partner type, and none while the page is read-only', async () => {
    const exited = sampleBook({ partners: [aPartner({ stage: 'exit', exitedDate: '2026-10-21', signedDate: '2026-09-15' })] });
    const { unmount } = renderPartner(<CaseArea load={vi.fn().mockResolvedValue({ ok: true, rows: [] })} create={vi.fn()} />, exited);
    expect(within(area()).getByRole('button', { name: 'New case' })).toBeEnabled();
    unmount();
    renderPartner(<CaseArea load={vi.fn().mockResolvedValue({ ok: true, rows: [] })} create={vi.fn()} />, book, { readOnly: true });
    expect(within(area()).getByRole('button', { name: 'New case' })).toBeDisabled();
  });
});

describe('CaseArea for a company server’s viewer (owner, 2026-11-14)', () => {
  it('shows a viewer the cases with no New case, and an admin or a partner manager New case', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, rows: [row()] });
    const view = renderPartner(<StorageProvider storage="database" viewer><CaseArea load={load} create={vi.fn()} /></StorageProvider>, book, { readOnly: true });
    expect(await within(area()).findByRole('link', { name: 'Case of 30 Oct 2026' })).toBeInTheDocument();
    expect(within(area()).queryByRole('button', { name: COPY.NEW_CASE })).toBeNull();
    view.unmount();
    renderPartner(<StorageProvider storage="database"><CaseArea load={load} create={vi.fn()} /></StorageProvider>, book);
    expect(within(area()).getByRole('button', { name: COPY.NEW_CASE })).toBeEnabled();
  });
});
