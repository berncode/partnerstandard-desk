// @vitest-environment jsdom
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recreate: vi.fn(), caseList: vi.fn(), mapCount: vi.fn(), refresh: vi.fn(), push: vi.fn(), toastError: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/app/(signed-in)/actions/partners', () => ({ recreatePartners: mocks.recreate }));
vi.mock('@/app/(signed-in)/actions/cases', () => ({ caseList: mocks.caseList }));
vi.mock('@/app/(signed-in)/actions/maps', () => ({ mapCount: mocks.mapCount }));
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

const { FileProblem } = await import('./file-problem');
const { StorageProvider } = await import('@/storage-context');
const gone = { error: 'file_not_found', message: COPY.FILE_GONE };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mapCount.mockResolvedValue({ ok: true, count: 0 });
});

describe('FileProblem', () => {
  it('says the partners file is gone and offers a new one, which reloads the page', async () => {
    mocks.recreate.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.PARTNERS_PROBLEM_GONE);
    expect(screen.getByText(COPY.PARTNERS_PROBLEM_GONE_TEXT)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reconnect Google' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.recreate).toHaveBeenCalledTimes(1);
  });

  it('goes to Partners after a new file when it was a partner’s page, since that partner is not in the new file', async () => {
    mocks.recreate.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners/pa_1" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/partners'));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('says so and stays when the new file could not be made', async () => {
    mocks.recreate.mockResolvedValue({ ok: false, error: 'unavailable', message: 'Not now.' });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Not now.'));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('says so when the server can’t be reached', async () => {
    mocks.recreate.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(COPY.ACTION_FAILED));
  });

  it('says an earlier Partners file can’t be read, and a new file reloads the page', async () => {
    mocks.recreate.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<FileProblem failure={{ error: 'old_version', message: SHEET_COPY.ISSUES.OLD_VERSION }} next="/partners" storage="memory" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(SHEET_COPY.ISSUES.OLD_VERSION);
    expect(screen.queryByText(COPY.PARTNERS_PROBLEM_GONE_TEXT)).toBeNull();
    expect(screen.getByText('Start a new Partners file to keep working. The old file goes to the trash in your Google Drive, where you can still open it.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('offers Reconnect Google, and no new file, when the Google sign-in ran out', () => {
    render(<FileProblem failure={{ error: 'auth', message: 'Sign in again.' }} next="/partners/pa_1" storage="google" />);
    expect(screen.getByRole('button', { name: 'Reconnect Google' })).toBeVisible();
    expect(document.querySelector('input[name="next"]')).toHaveValue('/partners/pa_1');
    expect(screen.queryByRole('button', { name: 'Start a new Partners file' })).toBeNull();
  });

  it('only shows the message for other trouble, with no way to replace the file', () => {
    render(<FileProblem failure={{ error: 'unavailable', message: 'Google is slow.' }} next="/partners" storage="google" />);
    expect(screen.getByText('Google is slow.')).toBeVisible();
    expect(screen.getByText(COPY.PROBLEM_WAIT)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks first what happens to the company’s business cases, saying how many, then sends the choice', async () => {
    mocks.recreate
      .mockResolvedValueOnce({ ok: false, error: 'invalid', message: COPY.CASES_CHOOSE(2), fieldErrors: { items: COPY.CASES_CHOOSE(2) } })
      .mockResolvedValueOnce({ ok: true });
    mocks.caseList.mockResolvedValue({ ok: true, cases: [{ caseId: 'case_1' }, { caseId: 'case_2' }] });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a new Partners file?' });
    expect(dialog).toHaveTextContent(COPY.NEW_PARTNERS_CASES_TEXT(2));
    expect(dialog).toHaveTextContent('What happens to the cases?');
    expect(mocks.refresh).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Move the files to the Drive trash' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.recreate).toHaveBeenNthCalledWith(1, {});
    expect(mocks.recreate).toHaveBeenNthCalledWith(2, { items: 'trash' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks about the business cases and the MAPs together, in the command’s words when the MAPs can’t be counted', async () => {
    mocks.recreate
      .mockResolvedValueOnce({ ok: false, error: 'invalid', message: COPY.ITEMS_CHOOSE(1, 1), fieldErrors: { items: COPY.ITEMS_CHOOSE(1, 1) } })
      .mockResolvedValueOnce({ ok: true });
    mocks.caseList.mockResolvedValue({ ok: true, cases: [{ caseId: 'case_1' }] });
    // The MAPs can't be counted (the directory didn't answer): the command's sentence, and the plural.
    mocks.mapCount.mockResolvedValue({ ok: false, error: 'unavailable', message: 'Not now.' });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a new Partners file?' });
    expect(dialog).toHaveTextContent(COPY.ITEMS_CHOOSE(1, 1));
    expect(dialog).toHaveTextContent('What happens to the case and the MAPs?');
    expect(dialog).toHaveTextContent('Either way, their links stop working.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep the files in Drive' }));
    await waitFor(() => expect(mocks.recreate).toHaveBeenNthCalledWith(2, { items: 'keep' }));
  });

  it('never says "the file" for several MAPs it can’t count: 0 cases, and the MAP count failing', async () => {
    mocks.recreate.mockResolvedValue({ ok: false, error: 'invalid', message: COPY.ITEMS_CHOOSE(0, 3), fieldErrors: { items: COPY.ITEMS_CHOOSE(0, 3) } });
    mocks.caseList.mockResolvedValue({ ok: true, cases: [] });
    mocks.mapCount.mockResolvedValue({ ok: false, error: 'unavailable', message: 'Not now.' });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a new Partners file?' });
    expect(dialog).toHaveTextContent(COPY.ITEMS_CHOOSE(0, 3));
    expect(dialog).toHaveTextContent('What happens to the MAPs?');
    expect(within(dialog).getByRole('button', { name: 'Move the files to the Drive trash' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep the files in Drive' })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/the file\b(?!s)/);
  });

  it('counts the MAPs in the directory while the Partners file is gone', async () => {
    mocks.recreate.mockResolvedValue({ ok: false, error: 'invalid', message: COPY.ITEMS_CHOOSE(0, 2), fieldErrors: { items: COPY.ITEMS_CHOOSE(0, 2) } });
    mocks.caseList.mockResolvedValue({ ok: true, cases: [] });
    mocks.mapCount.mockResolvedValue({ ok: true, count: 2 });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a new Partners file?' });
    expect(dialog).toHaveTextContent(COPY.NEW_PARTNERS_ITEMS_TEXT(0, 2));
    expect(dialog).toHaveTextContent('What happens to the MAPs?');
    expect(within(dialog).getByRole('button', { name: 'Move the files to the Drive trash' })).toBeInTheDocument();
    expect(mocks.mapCount).toHaveBeenCalledWith({});
  });

  it('can keep the files instead, and Cancel makes no file', async () => {
    mocks.recreate.mockResolvedValue({ ok: false, error: 'invalid', message: COPY.CASES_CHOOSE(1), fieldErrors: { items: COPY.CASES_CHOOSE(1) } });
    mocks.caseList.mockResolvedValue({ ok: true, cases: [{ caseId: 'case_1' }] });
    const user = userEvent.setup();
    render(<FileProblem failure={gone} next="/partners" storage="google" />);
    await user.click(screen.getByRole('button', { name: 'Start a new Partners file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a new Partners file?' });
    expect(within(dialog).getByRole('button', { name: 'Keep the file in Drive' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.recreate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('FileProblem for a company server’s viewer (owner, 2026-11-14)', () => {
  it('says what is wrong, with no button to start a new Partners file; an admin or a partner manager gets one', () => {
    const view = render(<StorageProvider storage="database" viewer><FileProblem failure={gone} next="/partners" storage="database" /></StorageProvider>);
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    view.unmount();
    render(<StorageProvider storage="database"><FileProblem failure={gone} next="/partners" storage="database" /></StorageProvider>);
    expect(screen.getByRole('button')).toBeVisible();
  });
});
