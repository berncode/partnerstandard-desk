// @vitest-environment jsdom
import { MAP_TODAY } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapSnapshot, SAMPLE_PLAN, SAMPLE_RECORD } from '@/test/map-workspace';

const actions = vi.hoisted(() => ({ mapLinkChange: vi.fn(), leaveMap: vi.fn() }));
vi.mock('@/app/m/[mapId]/actions', () => actions);

const { LinkMapPage } = await import('./link-page');

const partnerPerson = SAMPLE_PLAN.people.find((p) => p.side === 'partner')!;
const theirs = SAMPLE_PLAN.activities.find((a) => a.side === 'partner' && a.status === 'not_started')!;
const ours = SAMPLE_PLAN.activities.find((a) => a.side === 'us' && a.status === 'not_started')!;
const actor = { kind: 'link' as const, personId: partnerPerson.id, side: 'partner' as const, name: partnerPerson.name };

/** An activity's row, by its title (a button when it can be renamed, text when not). */
const rowOf = (title: string) => screen.getAllByText(title).map((el) => el.closest('li')).find((li) => li?.querySelector('[aria-label^="Status: "]'))!;

function renderPage(readOnly = false) {
  const initial = mapSnapshot();
  render(<LinkMapPage mapId="map_0123456789" initial={initial} today={MAP_TODAY} actor={actor} ownerName="Ruth" ourName="Halden" readOnly={readOnly} />);
  return userEvent.setup();
}

beforeEach(() => {
  actions.mapLinkChange.mockReset();
  actions.mapLinkChange.mockResolvedValue({ ok: false, error: 'unavailable', message: COPY.LINK_MAP_UNAVAILABLE });
});

describe('LinkMapPage', () => {
  it('says who shared the MAP and what the person may change, with Sign out, and no Share or sheet', () => {
    renderPage();
    const banner = screen.getAllByRole('note')[0]!;
    expect(banner).toHaveTextContent('Ruth shared this MAP with you.');
    expect(banner).toHaveTextContent(`You’re editing as ${partnerPerson.name}: you can update the activities and objectives on the ${SAMPLE_RECORD.partnerName} side.`);
    expect(within(banner).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open sheet' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Present' })).toHaveAttribute('href', '/m/map_0123456789/present');
  });

  it('saves their side through their own action, and keeps the other side read-only', async () => {
    const user = renderPage();
    const ourRow = rowOf(ours.title);
    expect(within(ourRow).getByRole('button', { name: /^Status: / })).toBeDisabled();
    const theirRow = rowOf(theirs.title);
    await user.click(within(theirRow).getByRole('button', { name: /^Status: .*\. Change to/ }));
    expect(actions.mapLinkChange).toHaveBeenCalledWith({ mapId: 'map_0123456789', change: expect.objectContaining({ kind: 'update', id: theirs.id }) });
  });

  it('after the exit, says the MAP can only be read and offers no change at all', () => {
    renderPage(true);
    expect(screen.getByText(COPY.MAP_READ_ONLY_AFTER_EXIT)).toBeInTheDocument();
    const theirRow = rowOf(theirs.title);
    expect(within(theirRow).getByRole('button', { name: /^Status: / })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add objective' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add activity' })).toBeNull();
  });
});
