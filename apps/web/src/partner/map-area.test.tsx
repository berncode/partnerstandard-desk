// @vitest-environment jsdom
import type { Partner } from '@partner-desk/core';
import { aPartner, sampleBook } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapAreaState, PlanCard } from '@/maps/view-model';
import type { DeleteMapAction } from '@/maps/delete-map';
import type { LoadMapArea, SignMovingDates, StartMap } from './map-area';

const mocks = vi.hoisted(() => ({ push: vi.fn(), toastError: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: mocks.toastError, dismiss: vi.fn() }) }));

const { MapArea, MapAreaProvider } = await import('./map-area');
const { Qualification } = await import('./qualification');
const { SignDialog } = await import('./sign-dialog');
const { renderPartner } = await import('./test-harness');

const book = (over: Partial<Partner> = {}) => sampleBook({ partners: [aPartner(over)], people: [], calls: [], qualifications: [], marketLinks: [] });
const area = () => screen.getByRole('region', { name: 'Mutual Action Plan' });
const TODAY = '2026-10-31';

const card = (over: Partial<PlanCard> = {}): PlanCard => ({
  mapId: 'map_aaaaaaaaaa', displayName: 'Acme GmbH as reseller', stage: 'onboarding', ended: false, health: 'at_risk', reasons: [],
  progress: { phase: 'running', horizon: 1, day: 30, total: 90, ratio: 30 / 90, endDate: '2026-12-14', label: 'Horizon 1 · Day 30 of 90' },
  nextMilestone: { name: 'Day 60: First joint opportunity', targetDate: '2026-11-15' }, overdueCount: 2, nextDue: '2026-10-20',
  lastActivityAt: '2026-10-30', ...over,
});
const ready = (over: Partial<PlanCard> = {}): MapAreaState => ({ kind: 'ready', mapId: 'map_aaaaaaaaaa', plannedStart: '2026-10-01', today: TODAY, card: card(over) });
const loaded = (state: MapAreaState) => vi.fn().mockResolvedValue({ ok: true, state });

function withMap(ui: ReactNode, options: {
  load?: ReturnType<typeof vi.fn>; start?: ReturnType<typeof vi.fn>; sign?: ReturnType<typeof vi.fn>; remove?: ReturnType<typeof vi.fn>;
} = {}) {
  const load = (options.load ?? loaded({ kind: 'none' })) as unknown as LoadMapArea;
  const start = (options.start ?? vi.fn()) as unknown as StartMap;
  return (
    <MapAreaProvider load={load} start={start}
      {...(options.remove ? { remove: options.remove as unknown as DeleteMapAction } : {})}
      {...(options.sign ? { signMovingDates: options.sign as unknown as SignMovingDates } : {})}>{ui}</MapAreaProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('MapArea', () => {
  it('without a MAP, from the MAP step on: the question and Start the MAP; no MAP link field, no link to the MAP app', async () => {
    const user = userEvent.setup();
    const start = vi.fn().mockResolvedValue({ ok: true, mapId: 'map_bbbbbbbbbb' });
    const load = loaded({ kind: 'none' });
    const { dispatched } = renderPartner(withMap(<MapArea />, { load, start }), book({ step: 'map', mapLink: 'https://map.example/acme' }));
    expect(await within(area()).findByText(COPY.MAP_AREA_EMPTY)).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ partnerId: 'p_abc123' });

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(dispatched.at(-1)).toEqual({
      change: { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { mapFilled: true } }, options: { label: 'Mutual Action Plan updated' },
    });
    // The old field and the MAP app's link are gone (owner, 2026-10-31); the record keeps its link, unshown.
    expect(within(area()).queryByText('MAP link')).toBeNull();
    expect(within(area()).queryByRole('button', { name: /MAP link/ })).toBeNull();
    expect(within(area()).queryByRole('link', { name: 'Open this MAP' })).toBeNull();
    expect(within(area()).queryByRole('link', { name: 'Open the Mutual Action Plan tool' })).toBeNull();

    await user.click(within(area()).getByRole('button', { name: 'Start the MAP' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/plans/map_bbbbbbbbbb/start'));
    expect(start).toHaveBeenCalledWith({ partnerId: 'p_abc123' });
  });

  it('with a MAP: health, the horizon and its days left, the next milestone, overdue activities and Open the MAP; no old link', async () => {
    renderPartner(withMap(<MapArea />, { load: loaded(ready()) }), book({ stage: 'onboarding', step: null, signedDate: '2026-09-15' }));
    expect(await within(area()).findByText('At risk')).toBeInTheDocument();
    expect(area()).toHaveTextContent('Horizon 1 · 61 days left');
    expect(area()).toHaveTextContent('Day 60: First joint opportunity');
    expect(area()).toHaveTextContent('15 Nov');
    expect(within(area()).getByTestId('overdue-count')).toHaveTextContent('2');
    expect(within(area()).getByRole('link', { name: 'Open the MAP' })).toHaveAttribute('href', '/plans/map_aaaaaaaaaa');
    expect(within(area()).queryByRole('button', { name: 'Start the MAP' })).toBeNull();
    expect(within(area()).queryByText('MAP link')).toBeNull();
    expect(screen.getByRole('group', { name: COPY.MAP_QUESTION })).toBeInTheDocument();
    expect(screen.getByText('Signed on 15 Sep 2026')).toBeInTheDocument();
  });

  it('shows "Not signed" for a MAP whose recruitment ended, and "Before signing" before the signing', async () => {
    const ended = card({ ended: true, health: null, progress: { ...card().progress, phase: 'recruitment', label: 'Ended without signing' } });
    renderPartner(withMap(<MapArea />, { load: loaded({ kind: 'ready', mapId: 'map_aaaaaaaaaa', plannedStart: '2026-10-01', today: TODAY, card: ended }) }),
      book({ step: 'map', closed: 'no', closedReason: 'Not a fit' }));
    expect(await within(area()).findByText('Not signed')).toBeInTheDocument();
    expect(area()).toHaveTextContent('Ended without signing');
  });

  it('keeps a MAP that can’t be read, with what Partners last kept of it and why', async () => {
    const unread: MapAreaState = {
      kind: 'unread', mapId: 'map_aaaaaaaaaa', displayName: 'Acme GmbH as reseller', plannedStart: '2026-10-01', today: TODAY, health: 'off_track',
      nextMilestone: '2026-11-15', message: 'Google Sheets isn’t responding right now.', deletable: true,
    };
    renderPartner(withMap(<MapArea />, { load: loaded(unread) }), book({ step: 'map' }));
    expect(await within(area()).findByText('Google Sheets isn’t responding right now.')).toBeInTheDocument();
    expect(area()).toHaveTextContent('Off track');
    expect(area()).toHaveTextContent('Next milestone 15 Nov');
    expect(within(area()).getByRole('link', { name: 'Open the MAP' })).toBeInTheDocument();
    expect(within(area()).queryByRole('button', { name: 'Start the MAP' })).toBeNull();
  });

  it('says "Nothing planned yet" for an empty MAP read now; a MAP that can’t be read with no health kept shows no badge', async () => {
    const { unmount } = renderPartner(withMap(<MapArea />, { load: loaded(ready({ health: 'empty', nextMilestone: null, overdueCount: 0 })) }),
      book({ stage: 'onboarding', step: null, signedDate: '2026-09-15' }));
    expect(await within(area()).findByText('Nothing planned yet')).toBeInTheDocument();
    expect(area()).not.toHaveTextContent('On track');
    unmount();
    const unread: MapAreaState = {
      kind: 'unread', mapId: 'map_aaaaaaaaaa', displayName: 'Acme GmbH as reseller', plannedStart: '2026-10-01', today: TODAY, health: null,
      nextMilestone: null, message: 'Google Sheets isn’t responding right now.', deletable: true,
    };
    renderPartner(withMap(<MapArea />, { load: loaded(unread) }), book({ step: 'map' }));
    expect(await within(area()).findByText('Google Sheets isn’t responding right now.')).toBeInTheDocument();
    // The empty cell may be an empty MAP or a summary not written yet: nothing is claimed.
    expect(area()).not.toHaveTextContent('Nothing planned yet');
    expect(area()).not.toHaveTextContent('On track');
    expect(area()).not.toHaveTextContent(COPY.MAP_AREA_KEPT);
    expect(within(area()).getByRole('link', { name: 'Open the MAP' })).toBeInTheDocument();
  });

  it('offers Delete for a MAP that can’t be read, asking first; once deleted, the area offers Start the MAP again', async () => {
    const user = userEvent.setup();
    const unread: MapAreaState = {
      kind: 'unread', mapId: 'map_aaaaaaaaaa', displayName: 'Acme GmbH as reseller', plannedStart: '2026-10-01', today: TODAY, health: 'off_track',
      nextMilestone: null, message: 'This file is no longer in your Google Drive.', deletable: true,
    };
    const load = vi.fn().mockResolvedValueOnce({ ok: true, state: unread }).mockResolvedValue({ ok: true, state: { kind: 'none' } });
    const remove = vi.fn().mockResolvedValue({ ok: true, mapId: 'map_aaaaaaaaaa' });
    renderPartner(withMap(<MapArea />, { load, remove }), book({ step: 'map' }));
    await user.click(await within(area()).findByRole('button', { name: 'Delete MAP' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete the MAP with Acme GmbH as reseller?' });
    expect(dialog).toHaveTextContent('Its file goes to the trash in your Google Drive.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete MAP' }));
    expect(remove).toHaveBeenCalledWith({ mapId: 'map_aaaaaaaaaa' });
    expect(await within(area()).findByRole('button', { name: 'Start the MAP' })).toBeInTheDocument();
    expect(within(area()).getByText(COPY.MAP_AREA_EMPTY)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('offers no Delete when the sign-in broke, or on a read-only page', async () => {
    const unread: MapAreaState = {
      kind: 'unread', mapId: 'map_aaaaaaaaaa', displayName: 'Acme GmbH as reseller', plannedStart: '2026-10-01', today: TODAY, health: null,
      nextMilestone: null, message: 'Reconnect Google.', deletable: false,
    };
    const { unmount } = renderPartner(withMap(<MapArea />, { load: loaded(unread), remove: vi.fn() }), book({ step: 'map' }));
    expect(await within(area()).findByText('Reconnect Google.')).toBeInTheDocument();
    expect(within(area()).queryByRole('button', { name: 'Delete MAP' })).toBeNull();
    unmount();
    renderPartner(withMap(<MapArea />, { load: loaded({ ...unread, message: 'Gone.', deletable: true }), remove: vi.fn() }), book({ step: 'map' }), { readOnly: true });
    expect(await within(area()).findByText('Gone.')).toBeInTheDocument();
    expect(within(area()).queryByRole('button', { name: 'Delete MAP' })).toBeNull();
  });

  it('shows nothing before the MAP step without a MAP, and the area once the partner type has one', async () => {
    const load = loaded({ kind: 'none' });
    const { unmount } = renderPartner(withMap(<MapArea />, { load }), book({ step: 'qualification' }));
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Mutual Action Plan' })).toBeNull();
    unmount();
    renderPartner(withMap(<MapArea />, { load: loaded(ready()) }), book({ step: 'qualification' }));
    expect(await screen.findByRole('region', { name: 'Mutual Action Plan' })).toHaveTextContent('At risk');
  });

  it('says why a MAP can’t be started or read, and offers no start read-only', async () => {
    const user = userEvent.setup();
    const start = vi.fn().mockResolvedValue({ ok: false, error: 'invalid', message: COPY.MAP_ALREADY, fieldErrors: { partnerId: COPY.MAP_ALREADY } });
    const { unmount } = renderPartner(withMap(<MapArea />, { start }), book({ step: 'map' }));
    await user.click(await within(area()).findByRole('button', { name: 'Start the MAP' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(COPY.MAP_ALREADY));
    expect(mocks.push).not.toHaveBeenCalled();
    unmount();
    const failing = vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', message: 'Not now.' });
    const second = renderPartner(withMap(<MapArea />, { load: failing }), book({ step: 'map' }));
    expect(await within(area()).findByRole('alert')).toHaveTextContent('Not now.');
    second.unmount();
    renderPartner(withMap(<MapArea />), book({ step: 'map' }), { readOnly: true });
    expect(await within(area()).findByText(COPY.MAP_AREA_EMPTY)).toBeInTheDocument();
    expect(within(area()).queryByRole('button', { name: 'Start the MAP' })).toBeNull();
  });
});

describe('Proceed to MAP', () => {
  it('offers to start the MAP now, once the partner is at MAP and has none', async () => {
    const user = userEvent.setup();
    const start = vi.fn().mockResolvedValue({ ok: true, mapId: 'map_bbbbbbbbbb' });
    renderPartner(withMap(<Qualification />, { start }), book({ step: 'qualification' }));
    await user.click(screen.getByRole('button', { name: 'Proceed to MAP' }));
    await user.click(screen.getByRole('button', { name: 'Go ahead anyway' }));
    const offer = await screen.findByRole('status');
    expect(offer).toHaveTextContent('Acme GmbH is at MAP now. Start the MAP?');
    await user.click(within(offer).getByRole('button', { name: 'Start the MAP now' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/plans/map_bbbbbbbbbb/start'));
  });

  it('offers nothing when the partner type has a MAP already', async () => {
    const user = userEvent.setup();
    const load = loaded(ready());
    renderPartner(withMap(<Qualification />, { load }), book({ step: 'qualification' }));
    await waitFor(() => expect(load).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Proceed to MAP' }));
    await user.click(screen.getByRole('button', { name: 'Go ahead anyway' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Mark signed with a MAP (spec 5.3)', () => {
  const signed = { kind: 'markSigned', partnerId: 'p_abc123' } as const;

  it('offers to move the MAP’s open dates by the days from its planned start, checked, and sends the signing with the move', async () => {
    const user = userEvent.setup();
    const sign = vi.fn().mockReturnValue({ ok: true });
    const { dispatched } = renderPartner(withMap(<SignDialog open onOpenChange={() => {}} />, { load: loaded(ready()), sign }),
      book({ step: 'map', mapFilled: true }));
    const dialog = await screen.findByRole('dialog');
    const date = within(dialog).getByLabelText('Date signed');
    await user.clear(date);
    await user.type(date, '2026-10-11');
    const box = await within(dialog).findByRole('checkbox', {
      name: 'Move the dates of the MAP’s open activities and milestones by 10 days so the agreed schedule keeps its timing',
    });
    expect(box).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Mark signed' }));
    expect(sign).toHaveBeenCalledWith({ ...signed, signedDate: '2026-10-11' });
    expect(dispatched.some((d) => d.change.kind === 'markSigned')).toBe(false);
  });

  it('says "earlier" for a signing before the planned start, and signs without the move when the box is cleared', async () => {
    const user = userEvent.setup();
    const sign = vi.fn().mockReturnValue({ ok: true });
    const { dispatched } = renderPartner(withMap(<SignDialog open onOpenChange={() => {}} />, { load: loaded(ready()), sign }),
      book({ step: 'map', mapFilled: true }));
    const dialog = await screen.findByRole('dialog');
    const date = within(dialog).getByLabelText('Date signed');
    await user.clear(date);
    await user.type(date, '2026-09-30');
    const box = await within(dialog).findByRole('checkbox', {
      name: 'Move the dates of the MAP’s open activities and milestones 1 day earlier so the agreed schedule keeps its timing',
    });
    await user.click(box);
    await user.click(within(dialog).getByRole('button', { name: 'Mark signed' }));
    expect(sign).not.toHaveBeenCalled();
    expect(dispatched.at(-1)?.change).toEqual({ ...signed, signedDate: '2026-09-30' });
  });

  it('has no box without a MAP, or when the signing is on the planned start', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPartner(withMap(<SignDialog open onOpenChange={() => {}} />, { sign: vi.fn() }), book({ step: 'map' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    unmount();
    renderPartner(withMap(<SignDialog open onOpenChange={() => {}} />, { load: loaded(ready()), sign: vi.fn() }), book({ step: 'map' }));
    const date = within(await screen.findByRole('dialog')).getByLabelText('Date signed');
    await user.clear(date);
    await user.type(date, '2026-10-01');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
