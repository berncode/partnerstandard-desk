// @vitest-environment jsdom
// The steps in PartnerStandard Desk's tab row, saves that send the program as read (`base`), and the sheet's unreadable rows.
import { BADGE_URL, CERTIFICATE_URL, levelCheck, newCompanyFacts, newProgram, WHO_INVOICES, type Program } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoveProgram, SaveProgram } from './program-editor';
import { LATER, NORTHWIND, RESELLER, rewritten, saved, showProgram, STAMP, stubOutputs } from './test-harness';
import { Activity } from 'react';
import type { Step } from './steps';

const nav = vi.hoisted(() => ({ pathname: '/programs/pg_resellerdd/why', push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
}));

const { ProgramStep } = await import('./program-step');

function show(step: Step, opts: Parameters<typeof showProgram>[1] = {}) {
  nav.pathname = `/programs/${(opts.program ?? RESELLER).id}/${step}`;
  const view = showProgram(<ProgramStep step={step} />, opts);
  return {
    ...view,
    goTo: (next: Step) => {
      nav.pathname = `/programs/${(opts.program ?? RESELLER).id}/${next}`;
      view.go(<ProgramStep step={next} />);
    },
  };
}

const card = (name: string) => screen.getByRole('region', { name });
const tabs = () => screen.getByRole('navigation', { name: COPY.PROG_SCREENS });
const status = () => screen.getByRole('status');

let outputs: ReturnType<typeof stubOutputs>;

describe('program steps', () => {
  beforeEach(() => {
    nav.push.mockClear();
    nav.refresh.mockClear();
    outputs = stubOutputs();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('heads each step with the crumb and the step name, and the tab row names the levels', () => {
    show('registered', { program: { ...RESELLER, focus: 'DACH', regName: 'Member', prefName: 'Gold' } });
    expect(screen.getByText('Reseller · DACH program · step 3 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Member');
    expect(within(tabs()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      '1Why join', '2Basics', '3Member', '4Gold', '5Money', 'Program Sheet', 'Public page',
    ]);
    expect(within(tabs()).getByRole('link', { name: 'Member' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs()).getByRole('link', { name: 'Why join' })).toHaveAttribute('href', '/programs/pg_resellerdd/why');
    expect(within(tabs()).getByRole('link', { name: 'Program Sheet' })).toHaveAttribute('href', '/programs/pg_resellerdd/sheet');
  });

  it('adds the program’s name to the crumb when another program has the same type and focus', () => {
    const copy: Program = { ...RESELLER, id: 'pg_resellercp', name: `${RESELLER.name} (copy)`, focus: '' };
    show('basics', { program: copy, others: [{ programId: RESELLER.id, label: 'Reseller' }] });
    const crumb = screen.getByText('Reseller · Northwind Security Reseller Program (copy) · step 2 of 5');
    expect(crumb).toHaveClass('truncate');
  });

  it('names a twin by its label alone once its focus tells them apart, and an unnamed twin "Untitled"', async () => {
    const copy: Program = { ...RESELLER, id: 'pg_resellercp', name: '  ', focus: '' };
    const { user } = show('basics', { program: copy, others: [{ programId: RESELLER.id, label: 'Reseller' }] });
    expect(screen.getByText('Reseller · Untitled · step 2 of 5')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Focus/), 'DACH');
    expect(screen.getByText('Reseller · DACH program · step 2 of 5')).toBeInTheDocument();
  });

  it('has Back and Next under each step; the first has no Back, and Money’s next is the Program Sheet', () => {
    const view = show('why');
    const steps = () => screen.getByRole('navigation', { name: 'Steps' });
    expect(within(steps()).queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
    expect(within(steps()).getByRole('link', { name: 'Next: Basics' })).toHaveAttribute('href', '/programs/pg_resellerdd/basics');
    view.goTo('preferred');
    expect(within(steps()).getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/programs/pg_resellerdd/registered');
    expect(within(steps()).getByRole('link', { name: 'Next: Money' })).toBeInTheDocument();
    view.goTo('money');
    expect(within(steps()).getByRole('link', { name: 'Next: Program Sheet' })).toHaveAttribute('href', '/programs/pg_resellerdd/sheet');
  });

  it('saves a change 800 ms after the last one, with the program as read and its Updated, then as saved', async () => {
    const { save, user } = show('why');
    await user.clear(screen.getByRole('textbox', { name: 'Reason 1' }));
    await user.type(screen.getByRole('textbox', { name: 'Reason 1' }), 'Leads');
    await waitFor(() => expect(status()).toHaveTextContent('Saved'), { timeout: 3000 });
    expect(save).toHaveBeenCalledTimes(1);
    const [first] = save.mock.calls[0]!;
    expect(first).toMatchObject({ programId: 'pg_resellerdd', base: RESELLER, expectedUpdatedAt: STAMP });
    expect(first.program.why[0]).toBe('Leads');

    await user.click(screen.getByRole('button', { name: 'Add a reason' }));
    await user.type(screen.getByRole('textbox', { name: 'Reason 5' }), 'Training');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const [second] = save.mock.calls[1]!;
    expect(second.expectedUpdatedAt).toBe(LATER);
    expect(second.base.why[0]).toBe('Leads');
  });

  it('keeps the screen of every step on one editor: a change on one step is there on the next', async () => {
    const { user, goTo } = show('basics');
    await user.type(screen.getByRole('textbox', { name: /^Focus/ }), 'DACH');
    goTo('registered');
    expect(screen.getByText('Reseller · DACH program · step 3 of 5')).toBeInTheDocument();
  });

  it('rewrites the outputs 30 seconds after a save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show('basics');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Opening the program rewrites its outputs at once.
    await waitFor(() => expect(rewritten(outputs)).toEqual([['pg_resellerdd']]));
    await user.type(screen.getByRole('textbox', { name: /^Focus/ }), 'DACH');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/));
    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(rewritten(outputs)).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(rewritten(outputs)).toEqual([['pg_resellerdd'], ['pg_resellerdd']]));
  });

  it('after a hand edit in the sheet the save is refused, says so, offers Reload and never sends again', async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: 'conflict' as const, message: 'conflict' }));
    const { user } = show('why', { save });
    await user.type(screen.getByRole('textbox', { name: 'Reason 1' }), '!');
    await waitFor(() => expect(status()).toHaveTextContent(COPY.CHANGED_SOMEWHERE_ELSE), { timeout: 3000 });
    await user.type(screen.getByRole('textbox', { name: 'Reason 1' }), '?');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('shows a sheet’s unreadable rows in the card they belong to', () => {
    const issues = [
      { tab: 'Reasons', row: 3, message: 'Reason in Reasons row 3 is too long.' },
      { tab: 'Benefits', row: 7, message: 'Key in Benefits row 7 is empty.' },
    ];
    const view = show('why', { issues });
    const why = card(COPY.PROG_WHY_TITLE);
    expect(within(why).getByRole('note')).toHaveTextContent(COPY.PROG_ISSUES_TITLE);
    expect(within(why).getByRole('note')).toHaveTextContent('Reason in Reasons row 3 is too long.');
    expect(within(why).getByRole('note')).not.toHaveTextContent('Benefits row 7');
    view.goTo('registered');
    expect(within(card('What it takes to join')).queryByRole('note')).not.toBeInTheDocument();
    expect(within(card('What Registered partners get')).getByRole('note')).toHaveTextContent('Key in Benefits row 7 is empty.');
    view.goTo('preferred');
    expect(within(card('What Preferred partners get')).getByRole('note')).toHaveTextContent('Key in Benefits row 7 is empty.');
  });

  it('Why join warns while no reason is filled in', async () => {
    const { user } = show('why', { program: { ...RESELLER, why: [''] } });
    expect(screen.getByText(COPY.PROG_NO_REASON)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Reason 1' }), 'Leads');
    expect(screen.queryByText(COPY.PROG_NO_REASON)).not.toBeInTheDocument();
  });

  it('Basics says who invoices for the type, and marks the focus optional', () => {
    show('basics');
    expect(within(card('The program')).getByText(WHO_INVOICES.resale)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Focus (optional)' })).toHaveValue('');
  });

  it('Preferred can be removed and added back; without it the step offers to add it', async () => {
    const { user } = show('preferred');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Preferred');
    expect(within(card('Rolling it out')).getByRole('link', { name: 'certificate' })).toHaveAttribute('href', CERTIFICATE_URL);
    expect(within(card('Rolling it out')).getByRole('link', { name: 'badge' })).toHaveAttribute('href', BADGE_URL);
    expect(within(card('What Preferred partners get')).getByText(/^Higher margin: 25% margin off your suggested price, every year → 30%/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove this level' }));
    expect(screen.getByRole('button', { name: 'Add a Preferred level' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a Preferred level' }));
    expect(screen.getByRole('button', { name: 'Remove this level' })).toBeInTheDocument();
  });

  it('a refused removal of Preferred (partners sit at it) says why on the status line', async () => {
    const message = COPY.PREFERRED_IN_USE(2, 'Preferred', 'Registered');
    const save = vi.fn(async () => ({ ok: false as const, error: 'invalid' as const, message, fieldErrors: { prefOn: message } }));
    const { user } = show('preferred', { save });
    await user.click(screen.getByRole('button', { name: 'Remove this level' }));
    await waitFor(() => expect(status()).toHaveTextContent(message), { timeout: 3000 });
  });

  it('Money shows the rates per level and the cost check beside them', () => {
    show('money');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Money');
    expect(screen.getByRole('table', { name: 'Rates per level' })).toBeInTheDocument();
    const glance = card('At a glance');
    expect(within(glance).getByRole('rowheader', { name: 'Partners cost you, per €1 brought in' })).toBeInTheDocument();
    expect(within(glance).getByText(/^Partners cost you €0\.30 to €0\.35 of every €1 a customer brings in\. Selling direct costs you €0\.40\.$/)).toBeInTheDocument();
  });

  it('Review Focus 4: with empty Company facts Money says what to fill in, never NaN, 0 or Infinity', () => {
    show('money', { facts: { ...newCompanyFacts('co_aaaaaaaaaa'), updatedAt: STAMP } });
    const glance = card('At a glance');
    expect(glance).toHaveTextContent(COPY.FACTS_DIRECT_UNKNOWN);
    expect(glance).toHaveTextContent(COPY.PROGRAM_CUSTOMER_UNKNOWN);
    expect(within(glance).getByRole('link', { name: 'Company facts' })).toHaveAttribute('href', '/company-facts');
    expect(glance.textContent).not.toMatch(/NaN|Infinity|€0(?![.,\d])|€0\.00/);
  });
});

describe('program steps: a company server’s viewer (owner, 2026-11-14)', () => {
  beforeEach(() => {
    outputs = stubOutputs();
  });
  afterEach(() => vi.unstubAllGlobals());

  const fields = () => [...screen.getByTestId('closed-for-viewer').querySelectorAll('input, select, textarea, button')];
  const ADDS = /^(Add|Remove|\+ Add)|×/;

  it.each(['why', 'basics', 'registered', 'preferred', 'money'] as const)('reads %s with every field closed, no Add or Remove, and saves nothing', async (step) => {
    const save = saved();
    show(step, { viewer: true, save, program: { ...RESELLER, prefOn: true } });
    expect(fields().length).toBeGreaterThan(0);
    for (const field of fields()) expect(field).toBeDisabled();
    expect(screen.queryAllByRole('button').filter((b) => ADDS.test(b.textContent ?? '') || ADDS.test(b.getAttribute('aria-label') ?? ''))).toEqual([]);
    expect(screen.getByRole('navigation', { name: COPY.PROG_STEPS_FOOTER })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 900));
    expect(save).not.toHaveBeenCalled();
  });

  it('says the higher level is off, with no button to add it', () => {
    show('preferred', { viewer: true, program: { ...RESELLER, prefOn: false } });
    expect(screen.queryByRole('button', { name: COPY.PROG_ADD_LEVEL(RESELLER.prefName) })).toBeNull();
  });

  it('keeps every step open for an admin or a partner manager', () => {
    show('why');
    expect(screen.queryByTestId('closed-for-viewer')).toBeNull();
    expect(screen.getByRole('button', { name: COPY.PROG_ADD_REASON })).toBeEnabled();
  });
});

describe('Delete program', () => {
  beforeEach(() => {
    nav.push.mockClear();
    nav.refresh.mockClear();
    stubOutputs();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks first, naming the program, then trashes it and opens the Programs page', async () => {
    const { user, remove } = show('basics');
    await user.click(within(card('Delete program')).getByRole('button', { name: 'Delete program' }));
    const dialog = screen.getByRole('dialog', { name: `Delete ${RESELLER.name}?` });
    expect(dialog).toHaveTextContent(`${RESELLER.name} goes to the trash in your Google Drive. You can restore it from there.`);
    await user.click(within(dialog).getByRole('button', { name: 'Delete program' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/programs'));
    expect(remove).toHaveBeenCalledWith({ programId: 'pg_resellerdd' });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('keeps a program that partners or markets point to, and says why in the dialog', async () => {
    const message = COPY.PROGRAM_IN_USE(2, 1);
    const remove = vi.fn<RemoveProgram>(async () => ({ ok: false, error: 'invalid', message }));
    const { user } = show('basics', { remove });
    await user.click(within(card('Delete program')).getByRole('button', { name: 'Delete program' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete program' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(nav.push).not.toHaveBeenCalled();
  });
});

/** The row of a benefit or requirement: its tick box, its text and its tag. */
const row = (el: HTMLElement) => el.closest('li') as HTMLElement;
const group = (name: string) => screen.getByRole('group', { name });
const ofType = (type: Program['type'], id: string): Program =>
  ({ ...newProgram(type, NORTHWIND, { id, companyName: 'Northwind Security' }), updatedAt: STAMP });

// Cases from Program Designer that the ones above don't cover. Its menu is PartnerStandard Desk's tab row, and here the
// crumb is always the label.
describe('program steps, from Program Designer', () => {
  beforeEach(() => {
    nav.push.mockClear();
    nav.refresh.mockClear();
    stubOutputs();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has Back and Next: <step> at the bottom, naming the levels; Money leads to the Program Sheet', () => {
    const program = { ...RESELLER, regName: 'Member', prefName: 'Gold' };
    const { goTo } = show('why', { program });
    const path = (step: string) => `/programs/${RESELLER.id}/${step}`;
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next: Basics' })).toHaveAttribute('href', path('basics'));
    goTo('basics');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', path('why'));
    expect(screen.getByRole('link', { name: 'Next: Member' })).toHaveAttribute('href', path('registered'));
    goTo('registered');
    expect(screen.getByRole('link', { name: 'Next: Gold' })).toHaveAttribute('href', path('preferred'));
    goTo('preferred');
    expect(screen.getByRole('link', { name: 'Next: Money' })).toHaveAttribute('href', path('money'));
    goTo('money');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', path('preferred'));
    expect(screen.getByRole('link', { name: 'Next: Program Sheet' })).toHaveAttribute('href', path('sheet'));
  });

  describe('Why join', () => {
    it('warns until a reason is filled in', async () => {
      const { user } = show('why', { program: { ...RESELLER, why: [] } });
      const why = card('Why partners join, besides money');
      expect(within(why).getByText(/^Three to five reasons a partner would join even without a commission\./)).toBeInTheDocument();
      expect(within(why).getByText(COPY.PROG_NO_REASON)).toBeInTheDocument();
      await user.click(within(why).getByRole('button', { name: 'Add a reason' }));
      const reason = within(why).getByRole('textbox', { name: 'Reason 1' });
      expect(reason).toHaveFocus();
      expect(reason).toHaveAttribute('placeholder', 'For example: leads from us in your region');
      expect(within(why).getByText(COPY.PROG_NO_REASON)).toBeInTheDocument();
      await user.type(reason, 'Leads from us in your region.');
      expect(within(why).queryByText(COPY.PROG_NO_REASON)).not.toBeInTheDocument();
    });

    it('lists the reasons with a remove button each', async () => {
      const { user, save } = show('why');
      expect(screen.getAllByRole('textbox', { name: /^Reason \d$/ }).map((t) => (t as HTMLInputElement).value)).toEqual(RESELLER.why);
      await user.click(screen.getByRole('button', { name: 'Remove reason 2' }));
      expect(screen.getAllByRole('textbox', { name: /^Reason \d$/ })).toHaveLength(3);
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
      expect(save.mock.calls[0]![0].program.why).toEqual([RESELLER.why[0], ...RESELLER.why.slice(2)]);
      expect(save.mock.calls[0]![0].expectedUpdatedAt).toBe(STAMP);
    });
  });

  describe('Basics', () => {
    it('has the four cards, Focus with its caption and the who-invoices note', () => {
      show('basics');
      expect(screen.getAllByRole('region').map((r) => within(r).getAllByRole('heading', { level: 2 })[0]!.textContent)).toEqual([
        'The program', 'Why this program', 'Who it is for', 'Running it', 'Delete program',
      ]);
      expect(screen.getByRole('textbox', { name: 'Program name' })).toHaveValue('Northwind Security Reseller Program');
      expect(screen.getByRole('textbox', { name: 'Program lead' })).toHaveValue('Anna Berger, Head of Partnerships');
      expect(screen.getByRole('textbox', { name: /^Focus/ })).toHaveAttribute('placeholder', 'For example: DACH, or mid-market');
      expect(screen.getByText('A region or market segment, if this program covers only part of your market.')).toBeInTheDocument();
      expect(within(card('The program')).getByText(WHO_INVOICES.resale)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'What you want to achieve with this partner type' })).toHaveValue(RESELLER.goals);
      expect(screen.getByRole('textbox', { name: 'Description for partners' })).toHaveValue(RESELLER.description);
      expect(screen.getByRole('textbox', { name: 'Ideal partner' })).toHaveValue(RESELLER.ipp);
      expect(screen.getByRole('textbox', { name: 'Ideal customer' })).toHaveValue(RESELLER.icp);
      expect(screen.getByRole('textbox', { name: 'How you measure the program' })).toHaveValue(RESELLER.kpis);
      expect(screen.getByRole('textbox', { name: 'Training and material' })).toHaveValue(RESELLER.enablement);
      expect(screen.getByRole('textbox', { name: 'Tools' })).toHaveValue(RESELLER.tools);
    });

    it('changing Focus to DACH relabels the crumb at once and saves', async () => {
      const { user, save } = show('basics');
      await user.type(screen.getByRole('textbox', { name: /^Focus/ }), 'DACH');
      expect(screen.getByText('Reseller · DACH program · step 2 of 5')).toBeInTheDocument();
      await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
      expect(save.mock.lastCall?.[0].program.focus).toBe('DACH');
      await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/));
    });

    it('says what is wrong with an empty name and sends nothing', async () => {
      const { user, save } = show('basics');
      await user.clear(screen.getByRole('textbox', { name: 'Program name' }));
      expect(screen.getByText("Program name can't be empty.")).toBeInTheDocument();
      await waitFor(() => expect(status()).toHaveTextContent("Not saved: Program name can't be empty."), { timeout: 2000 });
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('Registered', () => {
    it('has the starting level, what it takes to join and what partners get, with the step 5 hint', async () => {
      const { user } = show('registered');
      expect(within(card('The starting level')).getByText('Every partner who signs starts here.')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Name of the level' })).toHaveValue('Registered');
      const join = card('What it takes to join');
      expect(within(join).getByText('Checked once, when the partner signs.')).toBeInTheDocument();
      expect(within(join).getAllByRole('textbox').map((t) => (t as HTMLInputElement).value)).toEqual(RESELLER.entry);
      await user.click(within(join).getByRole('button', { name: 'Add a requirement' }));
      expect(within(join).getByRole('textbox', { name: `Requirement ${RESELLER.entry.length + 1}` })).toHaveFocus();
      const get = card('What Registered partners get');
      expect(within(get).getByText('Margin and commission are set in step 5. Preferred partners get all of this too.')).toBeInTheDocument();
      expect(within(get).getAllByRole('group').map((g) => within(g).getByRole('heading').textContent)).toEqual([
        'Selling', 'Marketing', 'Product and training', 'Support',
      ]);
      expect(within(group('Selling')).getByRole('checkbox', { name: 'Deal registration' })).toBeChecked();
      expect(within(group('Selling')).getByRole('checkbox', { name: 'First in line on deal registration' })).not.toBeChecked();
    });

    it('the hint leaves Preferred out when the program has one level', () => {
      show('registered', { program: { ...RESELLER, prefOn: false } });
      expect(within(card('What Registered partners get')).getByText('Margin and commission are set in step 5.')).toBeInTheDocument();
    });

    it('renaming the level renames the card, the heading and the tab', async () => {
      const { user } = show('registered');
      const name = screen.getByRole('textbox', { name: 'Name of the level' });
      await user.clear(name);
      await user.type(name, 'Member');
      expect(card('What Member partners get')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Member');
      expect(within(tabs()).getByRole('link', { name: 'Member' })).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('own benefits', () => {
    it('+ Add your own under Marketing adds a ticked, focused field; on Preferred it shows grayed with the Registered tag', async () => {
      const { user, goTo, save } = show('registered');
      await user.click(within(group('Marketing')).getByRole('button', { name: '+ Add your own' }));
      const text = within(group('Marketing')).getByRole('textbox', { name: 'Your own benefit' });
      expect(text).toHaveFocus();
      expect(text).toHaveAttribute('placeholder', 'Your own benefit');
      expect(within(group('Marketing')).getByRole('checkbox', { name: 'Your own benefit' })).toBeChecked();
      await user.type(text, 'Partner of the year award');
      expect(within(group('Marketing')).getByRole('checkbox', { name: 'Partner of the year award' })).toBeChecked();

      goTo('preferred');
      const box = within(group('Marketing')).getByRole('checkbox', { name: 'Partner of the year award' });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
      expect(within(row(box)).getByText('Registered')).toBeInTheDocument();
      expect(within(group('Marketing')).queryByRole('textbox')).not.toBeInTheDocument();

      await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
      const sent = save.mock.lastCall![0].program;
      const own = sent.own.find((o) => o.n === 'Partner of the year award')!;
      expect(own).toMatchObject({ g: 'Marketing' });
      expect(own.k).toMatch(/^own_[0-9a-z]{8}$/);
      expect(sent.reg).toContain(own.k);
      expect(sent.pref).not.toContain(own.k);
    });

    it('one added under Preferred shows unticked on Registered and can be ticked there; removing it removes it from both', async () => {
      const { user, goTo, save } = show('preferred');
      await user.click(within(group('Support')).getByRole('button', { name: '+ Add your own' }));
      await user.type(within(group('Support')).getByRole('textbox', { name: 'Your own benefit' }), 'Partner dinner');
      expect(within(group('Support')).getByRole('checkbox', { name: 'Partner dinner' })).toBeChecked();
      await waitFor(() => expect(save.mock.lastCall?.[0].program.own).toEqual([expect.objectContaining({ n: 'Partner dinner', g: 'Support' })]), { timeout: 2000 });

      goTo('registered');
      const box = within(group('Support')).getByRole('checkbox', { name: 'Partner dinner' });
      expect(box).not.toBeChecked();
      expect(box).toBeEnabled();
      await user.click(box);
      expect(box).toBeChecked();
      await user.click(within(group('Support')).getByRole('button', { name: 'Remove Partner dinner' }));
      expect(within(group('Support')).queryByRole('checkbox', { name: 'Partner dinner' })).not.toBeInTheDocument();

      goTo('preferred');
      expect(within(group('Support')).queryByRole('checkbox', { name: 'Partner dinner' })).not.toBeInTheDocument();
      await waitFor(() => expect(save.mock.lastCall?.[0].program.own).toEqual([]), { timeout: 2000 });
      const sent = save.mock.lastCall![0].program;
      expect(sent.reg).toEqual(RESELLER.reg);
      expect(sent.pref).toEqual(RESELLER.pref);
    });

    it('standard benefits Registered gives show on Preferred ticked, grayed and tagged with the Registered name', () => {
      show('preferred', { program: { ...RESELLER, regName: 'Member' } });
      const box = within(group('Selling')).getByRole('checkbox', { name: 'Deal registration' });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
      expect(within(row(box)).getByText('Member')).toBeInTheDocument();
      const own = within(group('Selling')).getByRole('checkbox', { name: 'First in line on deal registration' });
      expect(own).toBeChecked();
      expect(own).toBeEnabled();
      expect(within(row(own)).queryByText('Member')).not.toBeInTheDocument();
    });
  });

  describe('Preferred', () => {
    it('has the level, the money line with Change, and what Preferred partners get', () => {
      show('preferred');
      expect(within(card('The level partners earn')).getByText('One level above Registered. Partners earn it with this year’s results and keep it by meeting the bar every year.')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Name of the level' })).toHaveValue('Preferred');
      const get = card('What Preferred partners get');
      expect(within(get).getByText('On top of everything Registered partners get. The difference has to be felt.')).toBeInTheDocument();
      const money = within(get).getByRole('group', { name: 'Money' });
      expect(within(money).getByText('Higher margin: 25% margin off your suggested price, every year → 30% margin off your suggested price, every year')).toBeInTheDocument();
      expect(within(money).getByRole('link', { name: 'Change' })).toHaveAttribute('href', `/programs/${RESELLER.id}/money`);
    });

    it('a program paying no cash says so in place of the money line', () => {
      show('preferred', { program: ofType('content', 'pg_contentnwd') });
      expect(within(group('Money')).getByText('This program pays no cash.')).toBeInTheDocument();
    });

    it('Remove this level shows Add a Preferred level, which brings it back', async () => {
      const { user, save } = show('preferred');
      await user.click(screen.getByRole('button', { name: 'Remove this level' }));
      expect(screen.queryByRole('region', { name: 'What Preferred partners get' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Can partners feel the difference?' })).not.toBeInTheDocument();
      expect(screen.getByText('This program has one level only. Turn on Preferred to give partners something to grow into.')).toBeInTheDocument();
      await waitFor(() => expect(save.mock.lastCall?.[0].program.prefOn).toBe(false), { timeout: 2000 });
      await user.click(screen.getByRole('button', { name: 'Add a Preferred level' }));
      expect(card('What Preferred partners get')).toBeInTheDocument();
    });

    it('an Affiliate program starts with one level and says why', () => {
      show('preferred', { program: ofType('affiliate', 'pg_affiliaten') });
      expect(screen.getByText('Affiliate programs usually have one level: commission only.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add a Preferred level' })).toBeInTheDocument();
    });

    it('the certified-people count keeps its number when unticked and ticked again', async () => {
      const { user, save } = show('preferred');
      const box = screen.getByRole('checkbox', { name: 'Certified people working on your product' });
      const count = screen.getByRole('textbox', { name: 'Certified people working on your product' });
      expect(box).toBeChecked();
      expect(count).toHaveValue('2');
      await user.clear(count);
      await user.type(count, '3');
      await user.click(box);
      expect(box).not.toBeChecked();
      expect(count).toBeDisabled();
      expect(count).toHaveValue('3');
      await waitFor(() => expect(save.mock.lastCall?.[0].program.prefReq.certified).toEqual({ on: false, people: 3 }), { timeout: 2000 });
      await user.click(box);
      expect(box).toBeChecked();
      expect(count).toBeEnabled();
      expect(count).toHaveValue('3');
    });

    it('lists the requirements, the performance bar for the type, Keeping it and Rolling it out', async () => {
      const { user } = show('preferred');
      const todo = card('What Preferred partners have to do');
      expect(within(todo).getByText('Measured on the current year, never on past results.')).toBeInTheDocument();
      expect(within(todo).getByRole('heading', { name: 'For every Preferred partner' })).toBeInTheDocument();
      for (const name of ['A named contact for the partnership', 'Registers every deal it works on', 'Joint pipeline review every quarter', 'Quarterly business review', 'Represents your brand correctly']) {
        expect(within(todo).getByRole('checkbox', { name })).toBeChecked();
      }
      expect(within(todo).getByRole('heading', { name: 'Performance bar for Resellers' })).toBeInTheDocument();
      expect(within(todo).getAllByRole('textbox', { name: 'What you measure' }).map((t) => (t as HTMLInputElement).value)).toEqual(['New customers', 'Revenue through you, in €']);
      expect(within(todo).getAllByRole('textbox', { name: 'At least' }).map((t) => (t as HTMLInputElement).value)).toEqual(['5', '150,000']);
      await user.click(within(todo).getByRole('button', { name: 'Add a measure' }));
      expect(within(todo).getAllByRole('textbox', { name: 'Unit' }).map((t) => (t as HTMLInputElement).value)).toEqual(['a year', 'a year', 'a year']);
      expect(within(todo).getAllByRole('textbox', { name: 'What you measure' })[2]).toHaveFocus();

      const keep = card('Keeping it');
      expect(within(keep).getByRole('textbox', { name: 'Notice before moving a partner down' })).toHaveValue('90');
      expect(within(keep).getByRole('checkbox', { name: 'Improvement plan with milestones first' })).toBeChecked();

      const roll = card('Rolling it out');
      expect(within(roll).getByRole('textbox', { name: 'Pilot partners' })).toHaveValue(RESELLER.pilots);
      expect(within(roll).getByLabelText('Publish the criteria on')).toHaveValue('2027-01-15');
      expect(within(roll).getByText(/^Free templates:/)).toHaveTextContent('Free templates: certificate, badge.');
    });

    it('the level check card shows levelCheck’s call-outs and follows changes', async () => {
      const { user } = show('preferred');
      const check = card('Can partners feel the difference?');
      for (const c of levelCheck(NORTHWIND, RESELLER)) expect(within(check).getByText(c.text)).toBeInTheDocument();
      for (const name of ['Remove measure 1', 'Remove measure 1']) await user.click(screen.getByRole('button', { name }));
      expect(within(check).getByText('Add at least one performance bar, so partners know what it takes.')).toBeInTheDocument();
    });

    it('shows the level’s unreadable Requirements and Performance bar rows while the level is off', () => {
      const issues = [
        { tab: 'Requirements', row: 2, message: 'Requirements row 2 has a requirement this tool doesn’t know.' },
        { tab: 'Performance bar', row: 3, message: 'At least in Performance bar row 3 isn’t a number.' },
      ];
      show('preferred', { program: { ...RESELLER, prefOn: false }, issues });
      const off = card('Preferred level');
      expect(within(off).getByRole('note')).toHaveTextContent('Requirements row 2 has a requirement this tool doesn’t know.');
      expect(within(off).getByRole('note')).toHaveTextContent('At least in Performance bar row 3 isn’t a number.');
    });

    it('a refused removal (partners sit at Preferred) doesn’t stop saving: other changes save, and adding it back saves', async () => {
      const message = COPY.PREFERRED_IN_USE(2, 'Preferred', 'Registered');
      const ok = saved();
      const save = vi.fn<SaveProgram>(async (input) => (input.program.prefOn ? ok(input)
        : { ok: false, error: 'invalid', message, fieldErrors: { prefOn: message } }));
      const { user, goTo } = show('preferred', { save });
      await user.click(screen.getByRole('button', { name: 'Remove this level' }));
      await waitFor(() => expect(status()).toHaveTextContent(message), { timeout: 3000 });
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add a Preferred level' }));
      // The file still has Preferred: with it back, what is on screen is what is stored, and the line says Saved.
      await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/), { timeout: 3000 });
      expect(save).toHaveBeenCalledTimes(1);
      goTo('basics');
      await user.type(screen.getByRole('textbox', { name: 'Program lead' }), '!');
      await waitFor(() => expect(save.mock.lastCall![0].program).toMatchObject({ lead: `${RESELLER.lead}!`, prefOn: true }), { timeout: 3000 });
      await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/));
    });
  });

  it('a saved change queues the outputs, which leaving the program still sends', async () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    const { user, save, unmount } = show('basics');
    await user.type(screen.getByRole('textbox', { name: 'Program lead' }), '!');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/));
    unmount();
    expect(sendBeacon).toHaveBeenCalledWith('/api/programs/outputs', JSON.stringify({ programIds: [RESELLER.id] }));
  });

  it('the tab row keeps the names typed when Next shows the kept page again', async () => {
    const { ProgramEditor } = await import('./program-editor');
    const { ProgramTabs } = await import('./program-tabs');
    const { OutputRefreshProvider } = await import('./use-output-refresh');
    const save = saved();
    const remove = vi.fn<RemoveProgram>(async ({ programId }) => ({ ok: true, programId }));
    nav.pathname = `/programs/${RESELLER.id}/registered`;
    const page = (mode: 'visible' | 'hidden') => (
      <OutputRefreshProvider>
        <Activity mode={mode}>
          <ProgramEditor initial={RESELLER} facts={NORTHWIND} companyName="Northwind Security" fileUrl={null} issues={[]} save={save} remove={remove}>
            <ProgramTabs />
            <ProgramStep step="registered" />
          </ProgramEditor>
        </Activity>
      </OutputRefreshProvider>
    );
    const view = render(page('visible'));
    const user = userEvent.setup();
    const name = screen.getByRole('textbox', { name: 'Name of the level' });
    await user.clear(name);
    await user.type(name, 'Member');
    expect(within(tabs()).getByRole('link', { name: 'Member' })).toBeInTheDocument();
    view.rerender(page('hidden'));
    view.rerender(page('visible'));
    expect(within(tabs()).getByRole('link', { name: 'Member' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next: Preferred' })).toBeInTheDocument();
  });
});
