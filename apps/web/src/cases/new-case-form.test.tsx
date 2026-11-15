// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramOption } from '@/programs/title';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));

const { NewCaseForm } = await import('./new-case-form');

const partners = [
  { partnerId: 'p_acme', label: 'Acme as reseller', partnerType: 'reseller' as const },
  { partnerId: 'p_beta', label: 'Beta as technology partner', partnerType: 'technology' as const },
];
const programs: ProgramOption[] = [
  { programId: 'pg_one', label: 'Reseller', partnerType: 'reseller', title: 'Reseller' },
  { programId: 'pg_two', label: 'Reseller · DACH', partnerType: 'reseller', title: 'Reseller · DACH' },
  { programId: 'pg_ref', label: 'Referral', partnerType: 'referral', title: 'Referral' },
];
const pickFirst = { ok: false, error: 'invalid', message: COPY.CASE_PICK_PROGRAM, fieldErrors: { programId: COPY.CASE_PICK_PROGRAM } };

beforeEach(() => vi.clearAllMocks());

describe('NewCaseForm', () => {
  it('asks for the partner and type, makes the case and opens it on its offer tab', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, caseId: 'case_new' });
    const user = userEvent.setup();
    render(<NewCaseForm partners={partners} programs={programs} create={create} />);
    expect(screen.queryByLabelText('Program')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Partner'), 'p_beta');
    await user.click(screen.getByRole('button', { name: 'Make the case' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/business-cases/case_new/offer'));
    expect(create).toHaveBeenCalledWith({ partnerId: 'p_beta' });
  });

  it('starts on the partner the address names', () => {
    render(<NewCaseForm partners={partners} programs={programs} initialPartnerId="p_beta" create={vi.fn()} />);
    expect(screen.getByLabelText('Partner')).toHaveValue('p_beta');
  });

  it('asks for the program when it must be picked, with the type’s first program picked, then sends it', async () => {
    const create = vi.fn().mockResolvedValueOnce(pickFirst).mockResolvedValueOnce({ ok: true, caseId: 'case_new' });
    const user = userEvent.setup();
    render(<NewCaseForm partners={partners} programs={programs} create={create} />);
    await user.click(screen.getByRole('button', { name: 'Make the case' }));
    const program = await screen.findByLabelText('Program');
    expect(program).toHaveValue('pg_one');
    expect(Array.from((program as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Reseller', 'Reseller · DACH']);
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.CASE_PICK_PROGRAM);
    await user.selectOptions(program, 'pg_two');
    await user.click(screen.getByRole('button', { name: 'Make the case' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/business-cases/case_new/offer'));
    expect(create).toHaveBeenLastCalledWith({ partnerId: 'p_acme', programId: 'pg_two' });
  });

  it('asks again from the start when another partner is picked', async () => {
    const create = vi.fn().mockResolvedValue(pickFirst);
    const user = userEvent.setup();
    render(<NewCaseForm partners={partners} programs={programs} create={create} />);
    await user.click(screen.getByRole('button', { name: 'Make the case' }));
    await screen.findByLabelText('Program');
    await user.selectOptions(screen.getByLabelText('Partner'), 'p_beta');
    expect(screen.queryByLabelText('Program')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why a case wasn’t made', async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', message: 'Google isn’t answering.' });
    const user = userEvent.setup();
    render(<NewCaseForm partners={partners} programs={programs} create={create} />);
    await user.click(screen.getByRole('button', { name: 'Make the case' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google isn’t answering.');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('with a fixed partner type and the program asked at once, shows only the program', () => {
    render(<NewCaseForm partners={[partners[0]!]} programs={programs} fixed startAsking create={vi.fn()} />);
    expect(screen.queryByLabelText('Partner')).toBeNull();
    expect(screen.getByLabelText('Program')).toHaveValue('pg_one');
  });
});
