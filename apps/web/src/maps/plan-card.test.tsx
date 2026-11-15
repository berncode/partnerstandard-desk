// @vitest-environment jsdom
import { planInfoFor, type MapPlan, type MapRecord } from '@partner-desk/core';
import { MAP_TODAY } from '@partner-desk/core/test-builders';
import { buildSamplePlan, buildSampleRecord } from '@partner-desk/method';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { PlanCardView } = await import('./plan-card');
const { PendingCards, PlanCards, PlanProblems } = await import('./plan-cards');
const { summarizePlan } = await import('./view-model');

const TODAY = MAP_TODAY;
const plan = buildSamplePlan(TODAY) as MapPlan;
const sample = summarizePlan('map_sample', 'Brightwave Systems as reseller', { ...plan, info: planInfoFor(plan.info, buildSampleRecord(TODAY) as MapRecord, TODAY) }, TODAY);

describe('PlanCardView', () => {
  it('summarizes the MAP and links to it', () => {
    render(<PlanCardView card={sample} today={TODAY} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/plans/map_sample');
    expect(link).toHaveTextContent('Brightwave Systems as reseller');
    expect(link).toHaveTextContent('At risk');
    expect(link).toHaveTextContent('Onboarding · Horizon 1 · Day 35 of 90');
    expect(link).toHaveTextContent('Day 60: First joint opportunity');
    expect(screen.getByTestId('overdue-count')).toHaveTextContent('1');
  });

  it('shows "Nothing planned yet" in place of the health for an empty MAP (owner, 2026-10-31)', () => {
    render(<PlanCardView card={{ ...sample, health: 'empty' }} today={TODAY} />);
    expect(screen.getByRole('link')).toHaveTextContent('Nothing planned yet');
    expect(screen.getByRole('link')).not.toHaveTextContent('On track');
  });

  it('shows "Not signed" in place of the health once a recruitment ended', () => {
    render(<PlanCardView card={{ ...sample, ended: true, health: null }} today={TODAY} />);
    expect(screen.getByRole('link')).toHaveTextContent('Not signed');
    expect(screen.getByRole('link')).not.toHaveTextContent('At risk');
  });
});

describe('PlanCards, PendingCards and PlanProblems', () => {
  it('lists the cards, the names while loading, and the MAPs that couldn’t be read', () => {
    const { unmount } = render(<PlanCards cards={[sample, { ...sample, mapId: 'map_b', displayName: 'Acme as referral partner' }]} today={TODAY} />);
    expect(within(screen.getByRole('list', { name: 'Your MAPs' })).getAllByRole('listitem')).toHaveLength(2);
    unmount();
    const pending = render(<PendingCards names={[{ mapId: 'map_b', displayName: 'Acme as referral partner' }]} />);
    expect(screen.getByRole('list', { name: 'Your MAPs, loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('link', { name: 'Acme as referral partner' })).toHaveAttribute('href', '/plans/map_b');
    pending.unmount();
    render(<PlanProblems problems={[{ mapId: 'map_c', displayName: 'Globex as reseller', message: 'We can’t reach this file.' }]} />);
    expect(screen.getByRole('region', { name: 'We couldn’t read these MAPs' })).toHaveTextContent('Globex as reseller: We can’t reach this file.');
  });

  it('offers Delete for a MAP that couldn’t be read, asking first, then reads the page again; never for a broken sign-in', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue({ ok: true, mapId: 'map_c' });
    render(<PlanProblems remove={remove} problems={[
      { mapId: 'map_c', displayName: 'Globex as reseller', message: 'We can’t reach this file.', deletable: true },
      { mapId: 'map_d', displayName: 'Initech as reseller', message: 'Reconnect Google.', deletable: false },
    ]} />);
    expect(screen.queryByRole('button', { name: 'Delete the MAP with Initech as reseller' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete the MAP with Globex as reseller' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete the MAP with Globex as reseller?' });
    expect(dialog).toHaveTextContent('Its file goes to the trash in your Google Drive.');
    expect(dialog).toHaveTextContent('Every link to it stops working');
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete MAP' }));
    expect(remove).toHaveBeenCalledWith({ mapId: 'map_c' });
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows nothing for no problems', () => {
    const { container } = render(<PlanProblems problems={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
