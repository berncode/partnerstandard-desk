// @vitest-environment jsdom
import { EXAMPLES, type BusinessCase } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteResult } from '@/editor/remote';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { CaseEditor, PartnerCaseTab } = await import('./case-editor');
const { RecalculateDialog } = await import('./recalculate-dialog');
const { StorageProvider } = await import('@/storage-context');
type Recalculate = import('./recalculate-dialog').Recalculate;

const PROGRAMS = [
  { programId: 'pg_aaaaaaaaaa', label: 'Reseller', partnerType: 'reseller' as const, title: 'Reseller' },
  { programId: 'pg_bbbbbbbbbb', label: 'Reseller · DACH', partnerType: 'reseller' as const, title: 'Reseller · DACH' },
];
const initial = (): BusinessCase => structuredClone(EXAMPLES.saas.case);
const snapshot = (value: BusinessCase) => ({ value, issues: [] }) as unknown as Snapshot<BusinessCase>;
const LATER = '2026-10-25T10:00:00.000Z';

function show(recalculate: Recalculate, { gone = false, programs = PROGRAMS } = {}) {
  const save = vi.fn(async ({ case: c }: { case: BusinessCase }): Promise<RemoteResult<BusinessCase>> =>
    ({ ok: true, snapshot: snapshot({ ...c, updatedAt: LATER }), entityId: null }));
  render(
    <CaseEditor initial={initial()} save={save}>
      <RecalculateDialog caseId="case_saas" programs={programs} gone={gone} recalculate={recalculate} />
      <PartnerCaseTab />
    </CaseEditor>,
  );
  return { save };
}
const dialog = () => screen.getByRole('dialog', { name: COPY.CASE_UPDATE_TITLE });
const open = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: COPY.CASE_UPDATE }));
const confirm = (user: ReturnType<typeof userEvent.setup>) => user.click(within(dialog()).getByRole('button', { name: COPY.CASE_UPDATE_ACTION }));
const updated = (programId: string | null): Awaited<ReturnType<Recalculate>> => ({ ok: true, snapshot: snapshot(initial()), programId });

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
});

describe('RecalculateDialog', () => {
  it('asks first and names what changes; Cancel changes nothing', async () => {
    const user = userEvent.setup();
    const recalculate = vi.fn(async () => updated(null));
    show(recalculate);
    await open(user);
    expect(dialog()).toHaveTextContent(COPY.CASE_UPDATE_TEXT);
    expect(dialog()).toHaveTextContent('Deals, costs and everything in Our case stay.');
    await user.click(within(dialog()).getByRole('button', { name: COPY.CANCEL }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it('saves what is on screen first, then updates over the case as saved, and says it found no program', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const recalculate = vi.fn<Recalculate>(async (input) => {
      order.push(`update ${input.expectedUpdatedAt}`);
      return updated(null);
    });
    const { save } = show(recalculate);
    save.mockImplementation(async ({ case: c }) => {
      order.push('save');
      return { ok: true, snapshot: snapshot({ ...c, updatedAt: LATER }), entityId: null };
    });
    const year1 = screen.getByRole('textbox', { name: 'Year 1' });
    await user.clear(year1);
    await user.type(year1, '9');
    await open(user);
    await confirm(user);
    await waitFor(() => expect(order).toEqual(['save', `update ${LATER}`]));
    expect(recalculate).toHaveBeenCalledWith({ caseId: 'case_saas', expectedUpdatedAt: LATER });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast).toHaveBeenCalledWith(COPY.CASE_UPDATED_NO_PROGRAM);
    expect(refresh).toHaveBeenCalled();
  });

  it('asks for the program when it must, the first picked already, and names the one it used', async () => {
    const user = userEvent.setup();
    const recalculate = vi.fn<Recalculate>(async (input) => (input.programId
      ? updated(input.programId)
      : { ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { programId: COPY.CASE_PICK_PROGRAM } }));
    show(recalculate);
    await open(user);
    expect(within(dialog()).queryByLabelText(COPY.FIELD_CASE_PROGRAM)).toBeNull();
    await confirm(user);
    expect(await within(dialog()).findByText(COPY.CASE_PICK_PROGRAM)).toBeInTheDocument();
    const program = within(dialog()).getByLabelText(COPY.FIELD_CASE_PROGRAM);
    expect(program).toHaveValue('pg_aaaaaaaaaa');
    await user.selectOptions(program, 'Reseller · DACH');
    await confirm(user);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(recalculate).toHaveBeenLastCalledWith(expect.objectContaining({ programId: 'pg_bbbbbbbbbb' }));
    expect(toast).toHaveBeenCalledWith(COPY.CASE_UPDATED_FROM('Reseller · DACH'));
  });

  it('brings the page again when it must ask for a program it doesn’t know yet', async () => {
    const user = userEvent.setup();
    show(vi.fn<Recalculate>(async () => ({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { programId: COPY.CASE_PICK_PROGRAM } })), { programs: [] });
    await open(user);
    await confirm(user);
    expect(await within(dialog()).findByText(COPY.CASE_PICK_PROGRAM)).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText(COPY.FIELD_CASE_PROGRAM)).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it('says why when the case changed somewhere else, with Reload, and keeps the dialog open', async () => {
    const user = userEvent.setup();
    show(vi.fn(async () => ({ ok: false as const, error: 'conflict' as const, message: COPY.CONFLICT })));
    await open(user);
    await confirm(user);
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(COPY.CHANGED_SOMEWHERE_ELSE);
    await user.click(within(dialog()).getByRole('button', { name: COPY.RELOAD }));
    expect(refresh).toHaveBeenCalled();
  });

  it('does not update while what is on screen can’t be saved', async () => {
    const user = userEvent.setup();
    const recalculate = vi.fn(async () => updated(null));
    show(recalculate);
    const year2 = screen.getByRole('textbox', { name: 'Year 2' });
    await user.clear(year2);
    await user.type(year2, '2.5');
    await open(user);
    await confirm(user);
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Not saved: Deals in year 2 must be a whole number.');
    expect(recalculate).not.toHaveBeenCalled();
  });

  it('is off, and says why, when the partner type is gone from Partners', () => {
    show(vi.fn(async () => updated(null)), { gone: true });
    const button = screen.getByRole('button', { name: COPY.CASE_UPDATE });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(COPY.CASE_TYPE_GONE);
  });
});

describe('Update for a company server’s viewer (owner, 2026-11-14)', () => {
  it('shows a viewer no Update button, and an admin or a partner manager one', () => {
    const save = vi.fn();
    const tree = (viewer: boolean) => (
      <StorageProvider storage="database" viewer={viewer}>
        <CaseEditor initial={initial()} save={save}>
          <RecalculateDialog caseId="case_saas" programs={PROGRAMS} gone={false} recalculate={vi.fn()} />
        </CaseEditor>
      </StorageProvider>
    );
    const view = render(tree(true));
    expect(screen.queryByRole('button', { name: COPY.CASE_UPDATE })).toBeNull();
    view.unmount();
    render(tree(false));
    expect(screen.getByRole('button', { name: COPY.CASE_UPDATE })).toBeEnabled();
  });
});
