// @vitest-environment jsdom
import type { Partner } from '@partner-desk/core';
import { aPartner, sampleBook } from '@partner-desk/core/test-builders';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { Header } from './header';
import { OWNER_TODAY, renderPartner } from './test-harness';

const bookWith = (over: Partial<Partner> = {}) => sampleBook({ partners: [aPartner(over)], marketLinks: [] });
const show = (over: Partial<Partner> = {}, options = {}) => {
  const user = userEvent.setup();
  return { user, ...renderPartner(<Header />, bookWith(over), options) };
};
const steps = () => within(screen.getByRole('group', { name: 'Recruitment step' }));
const stages = () => screen.getByRole('list', { name: 'Stage' });

beforeEach(() => vi.clearAllMocks());

describe('the header', () => {
  it('shows the recommendation while the partner type is still in recruitment', () => {
    show({ partnerType: 'reseller' });
    expect(screen.getByText('Worth a discovery call')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('the recommendation chip', () => {
  it('shows while recruiting, and goes once the partner is closed or signed', () => {
    const { unmount } = show({});
    expect(screen.getByText('Worth a discovery call')).toBeInTheDocument();
    unmount();
    const closed = show({ closed: 'not_now', closedReason: 'Later' });
    expect(screen.queryByText('Worth a discovery call')).toBeNull();
    closed.unmount();
    show({ stage: 'onboarding', step: null, signedDate: '2026-09-15' });
    expect(screen.queryByText('Worth a discovery call')).toBeNull();
  });
});

describe('the stage stepper', () => {
  it('shows the five stages, with Recruitment’s steps inside Recruitment', () => {
    show({ step: 'discovery_call' });
    const items = within(stages()).getAllByRole('listitem').filter((li) => li.parentElement === stages());
    expect(items.map((li) => li.textContent?.slice(0, 11))).toEqual(['Recruitment', 'Onboarding', 'Growth', 'Expansion', 'Exit']);
    expect(steps().getAllByRole('button').map((b) => b.textContent)).toEqual(['Researched', 'Discovery call', 'Qualification', 'MAP']);
    expect(steps().getByRole('button', { name: 'Discovery call' })).toHaveAttribute('aria-current', 'step');
    expect(steps().getByRole('button', { name: 'MAP' })).toBeDisabled();
    expect(screen.getByText('Move one step at a time. Mark signed moves a partner to Onboarding.')).toBeInTheDocument();
    // Before signing, no stage after Recruitment is a button.
    expect(within(stages()).queryByRole('button', { name: 'Onboarding' })).toBeNull();
  });

  it('moves one step with an undo label, and gives Recruitment’s advice before Qualification', async () => {
    const { user, dispatched } = show({ step: 'researched' });
    await user.click(steps().getByRole('button', { name: 'Discovery call' }));
    expect(dispatched.at(-1)).toEqual({ change: { kind: 'setStep', partnerId: 'p_abc123', to: 'discovery_call' }, options: { label: 'Moved to Discovery call' } });

    await user.click(steps().getByRole('button', { name: 'Qualification' }));
    const advice = screen.getByRole('alert');
    expect(advice).toHaveTextContent("Write the partner hypothesis first. If either side can't be stated credibly, record 'not now' instead.");
    await user.click(within(advice).getByRole('button', { name: 'Cancel' }));
    expect(steps().getByRole('button', { name: 'Discovery call' })).toHaveAttribute('aria-current', 'step');

    await user.click(steps().getByRole('button', { name: 'Qualification' }));
    await user.click(screen.getByRole('button', { name: 'Go ahead anyway' }));
    expect(steps().getByRole('button', { name: 'Qualification' })).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('drops the advice once the step or the closing changes elsewhere', async () => {
    const { user } = show({ step: 'discovery_call' });
    await user.click(steps().getByRole('button', { name: 'Qualification' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close partner' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Later');
    await user.click(within(dialog).getByRole('button', { name: 'Close partner' }));
    expect(screen.queryByText(/Write the partner hypothesis first/)).toBeNull();
  });

  it('says why a move was refused', async () => {
    const { user } = show({ step: 'researched' }, { refuse: 'Reopen this partner before you move it.' });
    await user.click(steps().getByRole('button', { name: 'Discovery call' }));
    expect(toast.error).toHaveBeenCalledWith('Reopen this partner before you move it.');
  });

  it('after signing, moves a stage at a time and never back to Recruitment', async () => {
    const { user, dispatched } = show({ stage: 'onboarding', step: null, signedDate: '2026-09-15' });
    expect(within(stages()).queryByRole('button', { name: 'Recruitment' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Recruitment step' })).toBeNull();
    expect(within(stages()).getByText('Signed 15 Sep 2026')).toBeInTheDocument();
    expect(within(stages()).queryByText('MAP')).toBeNull();
    expect(within(stages()).getByRole('button', { name: 'Expansion' })).toBeDisabled();
    expect(screen.getByText("Move one stage at a time. A signed partner can't go back to recruitment.")).toBeInTheDocument();
    await user.click(within(stages()).getByRole('button', { name: 'Growth' }));
    expect(dispatched.at(-1)?.change).toEqual({ kind: 'setStage', partnerId: 'p_abc123', to: 'growth' });
    expect(within(stages()).getByRole('button', { name: 'Onboarding' })).toBeEnabled();
    expect(within(stages()).getByRole('button', { name: 'Expansion' })).toBeEnabled();
  });

  it('after the exit, shows Recruitment and Exit as done with the exit date, the stages between as plain', () => {
    show({ stage: 'exit', step: null, signedDate: '2026-09-15', exitedDate: '2026-10-21' });
    expect(within(stages()).getByText('Exited on 21 Oct 2026')).toBeInTheDocument();
    const items = within(stages()).getAllByRole('listitem').filter((li) => li.parentElement === stages());
    expect(items.map((li) => li.querySelector('svg') !== null)).toEqual([true, false, false, false, true]);
  });

  it('shows no steps for an exited partner with no signed date, and an empty signed date for a signed one', () => {
    const exited = show({ stage: 'exit', step: null, signedDate: null, exitedDate: '2026-10-21' });
    expect(screen.queryByRole('group', { name: 'Recruitment step' })).toBeNull();
    expect(within(stages()).getByText('Signed on an unknown date')).toBeInTheDocument();
    exited.unmount();
    show({ stage: 'onboarding', step: null, signedDate: '' });
    expect(screen.queryByRole('group', { name: 'Recruitment step' })).toBeNull();
    expect(within(stages()).getByText('Signed on an unknown date')).toBeInTheDocument();
  });

  it('says the exit is under way in the Exit stage, until Mark exited', () => {
    show({ stage: 'exit', step: null, signedDate: '2026-09-15' });
    expect(screen.getByText("The exit is under way. Use Mark exited when it’s done.")).toBeInTheDocument();
  });
});

describe('closing', () => {
  it('needs a reason, then shows how it was closed with Reopen, and no Mark signed', async () => {
    const { user, dispatched } = show();
    await user.click(screen.getByRole('button', { name: 'Close partner' }));
    const dialog = screen.getByRole('dialog', { name: 'Close Acme GmbH' });
    await user.click(within(dialog).getByRole('radio', { name: 'No' }));
    await user.click(within(dialog).getByRole('button', { name: 'Close partner' }));
    expect(within(dialog).getByText('Add a reason.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reason'), 'Sells only hardware');
    await user.click(within(dialog).getByRole('button', { name: 'Close partner' }));
    expect(dispatched.at(-1)?.options).toEqual({ label: 'Closed as No' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Closed as')).toBeInTheDocument();
    expect(screen.getByText('Sells only hardware')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark signed' })).toBeNull();
    expect(screen.getByText('Reopen this partner before you move it.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByRole('button', { name: 'Mark signed' })).toBeInTheDocument();
  });
});

describe('signing', () => {
  it('is offered from any step, and stands out from the MAP step on', () => {
    const { unmount } = show({ step: 'researched' });
    expect(screen.getByRole('button', { name: 'Mark signed' })).not.toHaveClass('bg-brand-strong');
    unmount();
    show({ step: 'map' });
    expect(screen.getByRole('button', { name: 'Mark signed' })).toHaveClass('bg-brand-strong');
  });

  it('gives the MAP advice first, never blocks, and moves the partner to Onboarding', async () => {
    const { user, dispatched } = show({ mapFilled: false });
    await user.click(screen.getByRole('button', { name: 'Mark signed' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark Acme GmbH signed' });
    expect(within(dialog).getByLabelText('Date signed')).toHaveValue(OWNER_TODAY);
    await user.click(within(dialog).getByRole('button', { name: 'Mark signed' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent("Don't sign the agreement before the MAP is agreed.");
    await user.click(within(dialog).getByRole('button', { name: 'Go ahead anyway' }));

    expect(dispatched.at(-1)?.change).toEqual({ kind: 'markSigned', partnerId: 'p_abc123', signedDate: OWNER_TODAY });
    expect(toast).toHaveBeenCalledWith('Marked signed');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(stages()).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step')).toHaveTextContent('Onboarding');
    expect(screen.getByRole('button', { name: 'Mark exited' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close partner' })).toBeNull();
  });

  it('signs at once when the MAP is agreed', async () => {
    const { user, dispatched } = show({ step: 'map', mapFilled: true });
    await user.click(screen.getByRole('button', { name: 'Mark signed' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark signed' }));
    expect(dispatched.at(-1)?.change.kind).toBe('markSigned');
  });
});

describe('the exit', () => {
  it('needs a reason and refuses a date before the signing date, then shows the exit', async () => {
    const { user, dispatched } = show({ stage: 'growth', step: null, signedDate: '2026-09-15' });
    expect(screen.getByText('Signed on 15 Sep 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark exited' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark Acme GmbH exited' });
    const date = within(dialog).getByLabelText('Exit date');
    await user.clear(date);
    await user.type(date, '2026-09-01');
    await user.type(within(dialog).getByLabelText('Reason'), 'They left the market');
    await user.click(within(dialog).getByRole('button', { name: 'Mark exited' }));
    expect(within(dialog).getByText("The exit date can't be before the signing date.")).toBeInTheDocument();

    await user.clear(date);
    await user.type(date, '2026-10-21');
    await user.clear(within(dialog).getByLabelText('Reason'));
    await user.click(within(dialog).getByRole('button', { name: 'Mark exited' }));
    expect(within(dialog).getByText('Add a reason.')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Reason'), 'They left the market');
    await user.click(within(dialog).getByRole('button', { name: 'Mark exited' }));
    expect(dispatched.at(-1)?.change).toEqual({ kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-10-21', reason: 'They left the market' });
    expect(screen.getAllByText('Exited on 21 Oct 2026')).toHaveLength(2); // the end area and the Exit box
    expect(screen.getByText('They left the market')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark exited' })).toBeNull();
    expect(within(stages()).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('undoing a signing', () => {
  it('asks first, then moves the partner back to Recruitment with an undo label', async () => {
    const { user, dispatched } = show({ stage: 'growth', step: null, signedDate: '2026-09-15' });
    await user.click(screen.getByRole('button', { name: 'Undo signing' }));
    const dialog = screen.getByRole('dialog', { name: 'Undo the signing of Acme GmbH?' });
    expect(dialog).toHaveTextContent('The partner goes back to Recruitment, step MAP, and its signed date is cleared.');
    expect(dispatched.some((d) => d.change.kind === 'undoSigned')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dispatched.some((d) => d.change.kind === 'undoSigned')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Undo signing' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo signing' }));
    expect(dispatched.at(-1)).toEqual({ change: { kind: 'undoSigned', partnerId: 'p_abc123' }, options: { label: 'Signing undone' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('correcting an exit', () => {
  it('shows one toast, the one with Undo, and no second one', async () => {
    const { user, dispatched } = show({ stage: 'exit', step: null, signedDate: '2026-09-15', exitedDate: '2026-10-21', exitReason: 'Left' });
    await user.click(screen.getByRole('button', { name: 'Correct exit' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Correct exit' }));
    expect(dispatched.at(-1)?.options).toEqual({ label: 'Exit corrected' });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('read-only', () => {
  it('offers no end actions and no moves', () => {
    show({}, { readOnly: true });
    expect(screen.queryByRole('button', { name: 'Close partner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark signed' })).toBeNull();
    expect(steps().getByRole('button', { name: 'Discovery call' })).toBeDisabled();
  });
});
