// @vitest-environment jsdom
import { MAP_TODAY } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapSnapshot, SAMPLE_PLAN } from '@/test/map-workspace';

const actions = vi.hoisted(() => ({
  mapShiftDates: vi.fn(), mapChange: vi.fn(), mapDelete: vi.fn(), mapNotifyLoad: vi.fn(), mapNotifySave: vi.fn(),
  mapShareCopy: vi.fn(), mapShareLoad: vi.fn(), mapShareRevoke: vi.fn(), mapShareSend: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('@/app/(signed-in)/actions/maps', () => actions);
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { DatesMoveNote, MapPage } = await import('./map-page');
const { StorageProvider } = await import('@/storage-context');

beforeEach(() => {
  vi.clearAllMocks();
});

const ours = SAMPLE_PLAN.activities.find((a) => a.side === 'us' && a.status === 'not_started')!;
/** An activity's row, by its title (a button when it can be renamed, text when not). */
const rowOf = (title: string) => screen.getAllByText(title).map((el) => el.closest('li')).find((li) => li?.querySelector('[aria-label^="Status: "]'))!;

function renderMapPage(storage: 'google' | 'memory') {
  render(
    <MapPage mapId="map_1" name="Brightwave Systems as reseller" initial={mapSnapshot()} today={MAP_TODAY} actorName="Anna Keller"
      fileUrl={null} ourName="Halden" ownerName="Anna Keller" back={<span>Back</span>} deletedTo="/plans" datesMove={null} storage={storage} />,
  );
  return userEvent.setup();
}

describe('the MAP page when a save needs Google again (question 16)', () => {
  it('shows the Reconnect Google banner after a save needs Google, with the button for a Google account and none for a test account', async () => {
    actions.mapChange.mockResolvedValue({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    for (const storage of ['google', 'memory'] as const) {
      const user = renderMapPage(storage);
      expect(screen.queryByRole('alert')).toBeNull();
      await user.click(within(rowOf(ours.title)).getByRole('button', { name: /^Status: .*\. Change to/ }));
      expect(actions.mapChange).toHaveBeenCalledWith({ mapId: 'map_1', change: expect.objectContaining({ kind: 'update', id: ours.id }) });

      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent(COPY.RECONNECT_TITLE);
      expect(banner).toHaveTextContent(COPY.RECONNECT_TEXT);
      const button = within(banner).queryByRole('button', { name: COPY.RECONNECT_BUTTON });
      if (storage === 'google') {
        expect(button).toBeInTheDocument();
        expect(button).toHaveFocus();
        expect(banner.querySelector('input[type="hidden"][name="next"]')).toHaveValue('/plans/map_1');
      } else {
        expect(button).toBeNull();
      }
      // The change went back, and nothing can be changed now.
      await waitFor(() => expect(within(rowOf(ours.title)).getByRole('button', { name: /^Status: Not started/ })).toBeDisabled());
      expect(screen.queryByRole('button', { name: 'Add activity' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add objective' })).toBeNull();
      expect(actions.mapChange).toHaveBeenCalledTimes(1);
      cleanup();
      actions.mapChange.mockClear();
    }
  });
});

describe('the MAP page for a company server’s viewer (owner, 2026-11-14)', () => {
  const page = (viewer: boolean) => (
    <StorageProvider storage="database" viewer={viewer}>
      <MapPage mapId="map_1" name="Brightwave Systems as reseller" initial={mapSnapshot()} today={MAP_TODAY} actorName="Anna Keller"
        fileUrl={null} ourName="Halden" ownerName="Anna Keller" back={<span>Back</span>} deletedTo="/plans" datesMove={{ days: 3 }} storage="database" />
    </StorageProvider>
  );
  const changes = ['Share', 'Notifications', 'Delete MAP', 'Move open dates by 3 days'];

  it('shows a viewer no Share, Notifications, Delete or Move dates, and still Present and the note on the dates', () => {
    render(page(true));
    for (const name of changes) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('link', { name: 'Present' })).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('The MAP’s open dates didn’t move when the agreement was signed.');
  });

  it('shows them to an admin or a partner manager', () => {
    render(page(false));
    for (const name of changes) expect(screen.getByRole('button', { name })).toBeVisible();
  });
});

describe('DatesMoveNote (spec 5.3, ruling R4)', () => {
  it('says the open dates didn’t move, moves them with one click, then goes and reads the MAP again', async () => {
    actions.mapShiftDates.mockResolvedValue({ ok: true, days: -5 });
    const user = userEvent.setup();
    render(<DatesMoveNote mapId="map_1" days={-5} />);
    expect(screen.getByRole('note')).toHaveTextContent('The MAP’s open dates didn’t move when the agreement was signed.');
    await user.click(screen.getByRole('button', { name: 'Move open dates 5 days earlier' }));
    expect(actions.mapShiftDates).toHaveBeenCalledWith({ mapId: 'map_1' });
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument());
    expect(router.refresh).toHaveBeenCalled();
  });

  it('names a later signing, and keeps the note with why when the move fails again', async () => {
    actions.mapShiftDates.mockResolvedValue({ ok: false, error: 'unavailable', message: 'Google isn’t answering.' });
    const user = userEvent.setup();
    render(<DatesMoveNote mapId="map_1" days={1} />);
    await user.click(screen.getByRole('button', { name: 'Move open dates by 1 day' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google isn’t answering.');
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
