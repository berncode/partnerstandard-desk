// @vitest-environment jsdom
import type { MapActor } from '@partner-desk/core';
import { makeActivity, makeMapPlan, makePerson, makeReview, MAP_TODAY } from '@partner-desk/core/test-builders';
import { exampleObjectives } from '@partner-desk/method';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWorkspace, SAMPLE_PLAN, SAMPLE_RECORD } from '@/test/map-workspace';

const LINK_PARTNER: MapActor = { kind: 'link', personId: 'p_sample3', side: 'partner', name: 'Priya Shah' };
const UNSIGNED = { ...SAMPLE_RECORD, stage: 'recruitment' as const, signedDate: null };
const row = (title: string) => screen.getByRole('button', { name: `Activity: ${title}` }).closest('li') as HTMLElement;
const group = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('[data-group]') as HTMLElement;

describe('the MAP page header', () => {
  it('names the MAP "Acme as reseller", with its health, stage and horizon from the partner record', () => {
    renderWorkspace();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Brightwave Systems as reseller');
    expect(within(screen.getByRole('banner')).getByText('At risk')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Onboarding')).toBeInTheDocument();
    expect(screen.getByText('Horizon 1 · Day 35 of 90')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Plan horizon' })).toHaveAttribute('aria-valuenow', '35');
    expect(screen.getByText(/is 14 days overdue/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Present' })).toHaveAttribute('href', '/plans/map_test/present');
  });

  it('says "Nothing planned yet" in place of a health for an empty MAP (owner, 2026-10-31)', () => {
    renderWorkspace(makeMapPlan({ objectives: SAMPLE_PLAN.objectives }), SAMPLE_RECORD);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('Nothing planned yet')).toBeInTheDocument();
    expect(within(banner).queryByText('On track')).toBeNull();
  });

  it('has no stage select, no signing and no end of recruitment: the partner page does those (spec 5.3)', () => {
    renderWorkspace(SAMPLE_PLAN, UNSIGNED);
    expect(screen.queryByRole('combobox', { name: 'Stage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agreement signed|Ended without signing|End recruitment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start next horizon' })).not.toBeInTheDocument();
    expect(screen.getByText('Before signing · horizon 1 starts when the agreement is signed')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('lets the owner choose the onboarding length before signing, with undo', async () => {
    const { remote, notify, user } = renderWorkspace(SAMPLE_PLAN, UNSIGNED);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Onboarding length' }), '60');
    await waitFor(() => expect(remote).toHaveBeenCalledWith({ kind: 'updateInfo', patch: { horizonDays: 60 } }));
    expect(notify.undo).toHaveBeenCalledWith('Onboarding length changed', expect.any(Function));
  });

  it('shows a recruitment closed without signing as ended, with its reason', () => {
    renderWorkspace(SAMPLE_PLAN, { ...UNSIGNED, closed: 'not_now', closedReason: 'Budget next year' });
    expect(screen.getByText('Not signed')).toBeInTheDocument();
    expect(screen.getByText('Ended without signing: Not now')).toBeInTheDocument();
    expect(screen.getByText(/Budget next year/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Onboarding length' })).not.toBeInTheDocument();
  });

  it('gives each activity row a stable id, so This week can open the MAP at it', () => {
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD);
    const first = SAMPLE_PLAN.activities[0]!;
    expect(row(first.title)).toHaveAttribute('id', `activity-${first.id}`);
  });

  it('links the sheet when there is one', () => {
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { fileUrl: 'https://docs.google.com/spreadsheets/d/f1/edit' });
    expect(screen.getByRole('link', { name: 'Open sheet' })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/f1/edit');
  });

  it('lists the sheet’s row issues together', () => {
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { issues: [{ tab: 'Activities', row: 4, message: 'Due date: write it as YYYY-MM-DD' }] });
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Some of this MAP’s sheet needs attention');
    expect(note).toHaveTextContent('Activities: Due date: write it as YYYY-MM-DD');
  });

  it('points an owner whose company has no name to Settings, and not once it has one', () => {
    const { unmount } = renderWorkspace();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    unmount();
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { ourName: 'Halden' });
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('objectives-us')).getByRole('heading', { level: 3 })).toHaveTextContent('Halden’s objectives');
  });
});

describe('Start next horizon', () => {
  it('starts the next horizon in the partner record’s stage, with the suggested milestones', async () => {
    const { remote, user } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Start next horizon' }));
    const dialog = screen.getByRole('dialog', { name: 'Start next horizon' });
    expect(within(dialog).queryByRole('combobox', { name: 'Stage' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Start horizon' }));
    await waitFor(() => expect(remote).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'startHorizon', expectedStartDate: SAMPLE_RECORD.signedDate, expectedHorizon: 0, startDate: MAP_TODAY, horizonDays: 90,
    })));
    expect(screen.getByText('Horizon 2 · Day 1 of 90')).toBeInTheDocument();
  });

  it('is not offered to a person with a link', () => {
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { actor: LINK_PARTNER });
    expect(screen.queryByRole('button', { name: 'Start next horizon' })).not.toBeInTheDocument();
  });

  it('points to the review once its prep has started: closing the review starts the next horizon (reviews spec 5.3)', () => {
    renderWorkspace({ ...SAMPLE_PLAN, reviews: [makeReview({ id: 'rv_1', horizon: 1, state: 'prep' })] });
    expect(screen.queryByRole('button', { name: 'Start next horizon' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the review' })).toHaveAttribute('href', '/plans/map_test/review');
  });

  it('a held review, or a prep of another horizon, doesn’t replace it', () => {
    renderWorkspace({ ...SAMPLE_PLAN, reviews: [makeReview({ id: 'rv_0', horizon: 1, state: 'held' }), makeReview({ id: 'rv_2', horizon: 2, state: 'prep' })] });
    expect(screen.getByRole('button', { name: 'Start next horizon' })).toBeInTheDocument();
  });
});

describe('the review on the MAP page (reviews spec 5.1, 6)', () => {
  it('the header shows the review date, linking the review, for the owner only', () => {
    const { unmount } = renderWorkspace();
    // The sample MAP's Next review.
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Review on 11 Dec' })).toHaveAttribute('href', '/plans/map_test/review');
    unmount();
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { actor: LINK_PARTNER, reviewHref: '/plans/map_test/review' });
    expect(screen.queryByText(/^Review on/)).not.toBeInTheDocument();
  });

  it('the header shows no review date before signing', () => {
    renderWorkspace(SAMPLE_PLAN, UNSIGNED);
    expect(screen.queryByText(/^Review on/)).not.toBeInTheDocument();
  });

  it('"Business review coming up" links the owner to the review, and a person with a link to Present', () => {
    const late = '2026-12-01';
    const { unmount } = renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { today: late });
    expect(screen.getByText(/Business review coming up/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Prepare the review' })).toHaveAttribute('href', '/plans/map_test/review');
    unmount();
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { today: late, actor: LINK_PARTNER });
    expect(screen.queryByRole('link', { name: 'Prepare the review' })).not.toBeInTheDocument();
    expect(screen.getByText(/Business review coming up: present the plan from/)).toBeInTheDocument();
  });
});

describe('Objectives', () => {
  it('shows both sides, named, and adds an example with one click', async () => {
    const { remote, user } = renderWorkspace(makeMapPlan(), SAMPLE_RECORD);
    expect(within(screen.getByTestId('objectives-partner')).getByRole('heading', { level: 3 })).toHaveTextContent('Brightwave Systems’ objectives');
    const example = exampleObjectives('reseller').us[0]!;
    await user.click(within(screen.getByTestId('objectives-us')).getByRole('button', { name: example }));
    expect(screen.getByRole('button', { name: `Objective: ${example}` })).toBeInTheDocument();
    await waitFor(() => expect(remote).toHaveBeenCalledWith({ kind: 'add', entity: 'objective', values: { side: 'us', statement: example } }));
  });

  it('keeps editing and shows the error when an objective is cleared', async () => {
    const { remote, user } = renderWorkspace();
    await user.click(screen.getAllByRole('button', { name: /^Objective: / })[0]!);
    const box = screen.getByRole('textbox', { name: 'Objective' });
    await user.clear(box);
    await user.type(box, '{Control>}{Enter}{/Control}');
    expect(screen.getByRole('textbox', { name: 'Objective' })).toHaveAttribute('aria-invalid', 'true');
    expect(remote).not.toHaveBeenCalled();
  });
});

describe('Activities', () => {
  it('groups activities by milestone, unscheduled last', () => {
    renderWorkspace();
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).filter((t) => t?.startsWith('Day') || t === 'Unscheduled');
    expect(groups).toEqual(['Day 30: Partner enabled', 'Day 60: First joint opportunity', 'Day 90: First business review', 'Unscheduled']);
  });

  it('cycles the status with one click, and offers undo', async () => {
    const { remote, notify, user } = renderWorkspace();
    const target = row('Register the first joint opportunity');
    await user.click(within(target).getByRole('button', { name: 'Status: Not started. Change to In progress' }));
    expect(within(target).getByRole('button', { name: 'Status: In progress. Change to Done' })).toBeInTheDocument();
    await waitFor(() => expect(remote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update', id: 'a_sample7', patch: { status: 'in_progress' } })));
    expect(notify.undo).toHaveBeenCalledWith('Marked in progress', expect.any(Function));
  });

  it('filters by side, owner and status, and clears the filters when nothing matches', async () => {
    const { user } = renderWorkspace();
    const filters = within(screen.getByRole('group', { name: 'Filter activities' }));
    await user.selectOptions(filters.getByRole('combobox', { name: 'Status' }), 'blocked');
    expect(screen.queryByRole('button', { name: 'Activity: Register the first joint opportunity' })).not.toBeInTheDocument();
    await user.selectOptions(filters.getByRole('combobox', { name: 'Side' }), 'joint');
    expect(screen.getByText('No activities match these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Activity: Register the first joint opportunity' })).toBeInTheDocument();
  });

  it('keeps a just-added activity in view under filters it doesn’t match', async () => {
    const { remote, user } = renderWorkspace();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'blocked');
    const day60 = group('Day 60: First joint opportunity');
    await user.click(within(day60).getByRole('button', { name: 'Add activity' }));
    await user.type(within(day60).getByRole('textbox', { name: 'Add activity' }), 'Chase the API key{Enter}');
    await waitFor(() => expect(remote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'add', values: expect.objectContaining({ title: 'Chase the API key' }) })));
    expect(screen.getByRole('button', { name: 'Activity: Chase the API key' })).toBeInTheDocument();
  });

  it('sets an owner and a due date', async () => {
    const plan = makeMapPlan({ people: [makePerson({ id: 'p_anna', name: 'Anna Keller' })], activities: [makeActivity({ id: 'a_1', title: 'Kickoff', updatedAt: '2026-10-01T09:00:00.000Z' })] });
    const { remote, user } = renderWorkspace(plan);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Owner of Kickoff' }), 'p_anna');
    await waitFor(() => expect(remote).toHaveBeenCalledWith(expect.objectContaining({ id: 'a_1', patch: { ownerId: 'p_anna' } })));
    await user.click(screen.getByRole('button', { name: 'Due date: No date' }));
    const input = screen.getByLabelText('Due date');
    await user.type(input, '2026-11-20');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(remote).toHaveBeenCalledWith(expect.objectContaining({ id: 'a_1', patch: { dueDate: '2026-11-20' } })));
    expect(screen.getByRole('button', { name: 'Due date: 20 Nov' })).toBeInTheDocument();
  });

  it('titles the starter suggestions with the partner type and the stage', () => {
    renderWorkspace(makeMapPlan(), SAMPLE_RECORD);
    expect(screen.getByText('Suggested for a Reseller in onboarding:')).toBeInTheDocument();
  });
});

describe('People, milestones and exit triggers', () => {
  it('adds a person on a side with a role, a milestone and an exit trigger', async () => {
    const { remote, user } = renderWorkspace(makeMapPlan(), SAMPLE_RECORD);
    const people = within(screen.getByTestId('people-partner'));
    await user.click(people.getByRole('button', { name: 'Add person' }));
    await user.type(people.getByRole('textbox', { name: 'Add person' }), 'Priya Shah{Enter}');
    await waitFor(() => expect(remote).toHaveBeenCalledWith({ kind: 'add', entity: 'person', values: { side: 'partner', name: 'Priya Shah', role: 'partner_manager' } }));
    const milestones = within(screen.getByRole('region', { name: 'Milestones' }));
    await user.click(milestones.getByRole('button', { name: 'Add milestone' }));
    await user.type(milestones.getByRole('textbox', { name: 'Add milestone' }), 'Day 45: First deal{Enter}');
    await waitFor(() => expect(remote).toHaveBeenCalledWith({ kind: 'add', entity: 'milestone', values: { name: 'Day 45: First deal' } }));
    const triggers = within(screen.getByRole('region', { name: 'Exit triggers' }));
    await user.click(triggers.getByRole('button', { name: 'Add exit trigger' }));
    await user.type(triggers.getByRole('textbox', { name: 'Add exit trigger' }), 'No deal in 90 days{Enter}');
    await waitFor(() => expect(remote).toHaveBeenCalledWith({ kind: 'add', entity: 'exitTrigger', values: { condition: 'No deal in 90 days' } }));
  });

  it('marks a milestone achieved today', async () => {
    const { remote, user } = renderWorkspace();
    await user.click(screen.getAllByRole('button', { name: 'Mark achieved' })[0]!);
    await waitFor(() => expect(remote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update', entity: 'milestone', patch: { achievedDate: MAP_TODAY } })));
  });
});

describe('a person with a link (task 7 builds their page)', () => {
  it('edits their own side only: no plan details, no deletes, nothing on the other side', () => {
    renderWorkspace(SAMPLE_PLAN, SAMPLE_RECORD, { actor: LINK_PARTNER });
    const us = within(screen.getByTestId('objectives-us'));
    expect(us.queryByRole('button', { name: 'Add objective' })).not.toBeInTheDocument();
    const partner = within(screen.getByTestId('objectives-partner'));
    expect(partner.getByRole('button', { name: 'Add objective' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
