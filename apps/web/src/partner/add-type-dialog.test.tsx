// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import type { SaveOutcome } from '@/editor/use-editor';
import { AddTypeDialog } from './add-type-dialog';

beforeEach(() => vi.clearAllMocks());

function open(apply: (...args: unknown[]) => Promise<SaveOutcome>) {
  const onAdded = vi.fn();
  const onOpenChange = vi.fn();
  render(<AddTypeDialog open onOpenChange={onOpenChange} accountId="a_1" taken={['reseller']} apply={apply} onAdded={onAdded} today="2026-10-28" />);
  return { onAdded, onOpenChange, user: userEvent.setup() };
}

describe('adding a partner type', () => {
  it('stays open and stops adding when the save has no clear answer, and says so', async () => {
    const apply = vi.fn(async (): Promise<SaveOutcome> => ({ ok: false, unknown: true }));
    const { user, onOpenChange, onAdded } = open(apply);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.SAVE_ADD_UNKNOWN);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('shows why the add was refused, and lets the person try another type', async () => {
    const apply = vi.fn(async (): Promise<SaveOutcome> => ({ ok: false, message: 'Acme is already a referral partner.' }));
    const { user, onOpenChange } = open(apply);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Acme is already a referral partner.');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('says so when the type was added but not moved to where the person chose', async () => {
    const apply = vi.fn<(...args: unknown[]) => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: true, entityId: 'p_new' })
      .mockResolvedValueOnce({ ok: false });
    const { user, onAdded, onOpenChange } = open(apply);
    await user.selectOptions(screen.getByLabelText(COPY.FIELD_WHERE), 'qualification');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith(COPY.PARTNER_TYPE_ADDED_NOT_MOVED);
    expect(onAdded).toHaveBeenCalled();
  });
});
