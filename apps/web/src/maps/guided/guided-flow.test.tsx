// @vitest-environment jsdom
import { newMapPlan, type MapRecord } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));

const { GuidedFlow } = await import('./guided-flow');
const { draftKey } = await import('./draft-storage');

const plan = newMapPlan({ partnerId: 'p_1', partnerType: 'reseller', contacts: [] });
const record: MapRecord = { partnerName: 'Litware Group', partnerType: 'reseller', stage: 'recruitment', signedDate: null, closed: null, closedReason: '' };
const contacts = [{ name: 'Lena Ortiz', title: 'Head of Partnerships', email: 'lena@example.com', role: 'exec_sponsor' as const }];

function show(onSave = vi.fn().mockResolvedValue({ ok: true, mapId: 'map_aaaaaaaaaa' }), caseBenefits: string[] = []) {
  render(<GuidedFlow mapId="map_aaaaaaaaaa" plan={plan} record={record} plannedStart="2026-10-31" ours="Halden" ownerName="Anna Berg"
    contacts={contacts} caseBenefits={caseBenefits} onSave={onSave} />);
  return onSave;
}
const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Next' }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('GuidedFlow', () => {
  it('runs the MAP app’s steps, filled from the partner record, and saves the rows, then opens the MAP', async () => {
    const user = userEvent.setup();
    const onSave = show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is the partner?' })).toBeInTheDocument();
    expect(screen.getByText('Litware Group')).toBeInTheDocument();
    expect(screen.getByText('Reseller')).toBeInTheDocument();
    expect(screen.getByText('Recruitment')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(COPY.GUIDED_HORIZON_AT_SIGNING), '60');
    await next(user);

    await user.type(screen.getByLabelText('Add our objective'), 'Close three deals together');
    await user.click(within(screen.getByTestId('draft-objectives-us')).getByRole('button', { name: 'Add' }));
    expect(screen.getByTestId('draft-objectives-us')).toHaveTextContent('Close three deals together');
    expect(screen.getByTestId('draft-objectives-us')).toHaveTextContent('Halden’s objectives');
    await next(user);

    // People: the owner is on our side already, and the partner's contacts are offered.
    expect(screen.getByTestId('draft-people-us')).toHaveTextContent('Anna Berg');
    const theirs = screen.getByTestId('draft-people-partner');
    expect(theirs).toHaveTextContent('From Litware Group’s contacts. One click adds them:');
    await user.click(within(theirs).getByRole('button', { name: 'Lena Ortiz' }));
    expect(within(theirs).getByRole('listitem')).toHaveTextContent('Lena OrtizExecutive Sponsor');
    expect(within(theirs).queryByRole('button', { name: 'Lena Ortiz' })).toBeNull();
    await next(user);

    // Activities: the starters for a reseller in recruitment.
    expect(screen.getByText('Suggested for a Reseller in recruitment. One click adds it:')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Agree on seller activation targets' }));
    await user.selectOptions(screen.getByLabelText('Owner of Agree on seller activation targets'), 'Lena Ortiz');
    await next(user);

    await user.click(screen.getByRole('button', { name: 'Day 30: Partner enabled' }));
    await user.click(screen.getByRole('button', { name: 'No qualified opportunity registered within 90 days' }));
    await user.click(screen.getByRole('button', { name: 'Save the MAP' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/plans/map_aaaaaaaaaa'));

    const sent = onSave.mock.calls[0]![0];
    expect(sent).toMatchObject({
      mapId: 'map_aaaaaaaaaa', horizonDays: 60,
      objectives: [{ side: 'us', statement: 'Close three deals together' }],
      milestones: [{ name: 'Day 30: Partner enabled', targetDate: '2026-11-29' }],
      exitTriggers: [{ condition: 'No qualified opportunity registered within 90 days', status: 'ok' }],
    });
    const lena = sent.people.find((p: { name: string }) => p.name === 'Lena Ortiz');
    expect(lena).toMatchObject({ side: 'partner', email: 'lena@example.com', role: 'exec_sponsor' });
    expect(sent.activities).toEqual([expect.objectContaining({ title: 'Agree on seller activation targets', side: 'joint', ownerId: lena.id })]);
    expect(sent.activities[0]).not.toHaveProperty('id');
    expect(sessionStorage.getItem(draftKey('map_aaaaaaaaaa'))).toBeNull();
  });

  it('keeps the answers and says why when the save fails, and lets steps be skipped', async () => {
    const user = userEvent.setup();
    show(vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', message: 'Google is slow.' }));
    await screen.findByRole('heading', { level: 1, name: 'Who is the partner?' });
    await next(user);
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('button', { name: 'Day 30: Partner enabled' }));
    await user.click(screen.getByRole('button', { name: 'Save the MAP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google is slow.');
    expect(screen.getByRole('heading', { level: 1, name: 'When do we check in, and when do we stop?' })).toBeInTheDocument();
    expect(screen.getByText('Day 30: Partner enabled')).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    // The draft is kept for a reconnect.
    expect(sessionStorage.getItem(draftKey('map_aaaaaaaaaa'))).toContain('Day 30: Partner enabled');
  });

  it('offers the business case’s benefits as the partner’s objectives, once, beside the examples', async () => {
    const user = userEvent.setup();
    const example = 'Grow deal size by selling a more complete offer';
    show(undefined, ['Recurring revenue', example]);
    await screen.findByRole('heading', { level: 1, name: 'Who is the partner?' });
    await next(user);
    const theirs = screen.getByTestId('draft-objectives-partner');
    expect(theirs).toHaveTextContent(COPY.GUIDED_FROM_CASE);
    expect(within(theirs).getAllByRole('button', { name: example })).toHaveLength(1);
    expect(within(screen.getByTestId('draft-objectives-us')).queryByText(COPY.GUIDED_FROM_CASE)).toBeNull();
    await user.click(within(theirs).getByRole('button', { name: 'Recurring revenue' }));
    expect(within(theirs).getByRole('button', { name: 'Remove Recurring revenue' })).toBeInTheDocument();
    expect(within(theirs).queryByRole('button', { name: 'Recurring revenue' })).toBeNull();
  });
});
