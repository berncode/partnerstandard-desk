// @vitest-environment jsdom
// A case has one partner type, fixed, so the tests take each example's own type. Saving goes through PartnerStandard Desk's
// editor (one for the whole case) and `caseSave`'s answer.
import {
  EXAMPLE_KEYS, EXAMPLES, simulateCase, type BusinessCase as Case, type PreferredConditions,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteResult } from '@/editor/remote';
import { StorageProvider } from '@/storage-context';
import { formatMoney } from './format';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { CaseEditor, CaseSaveStatus, PartnerCaseTab, forResult } = await import('./case-editor');
type Save = (input: { caseId: string; case: Case; base: Case; expectedUpdatedAt: string | null }) => Promise<RemoteResult<Case>>;

const example = (key: keyof typeof EXAMPLES): Case => structuredClone(EXAMPLES[key].case);
const saas = () => example('saas');
const preferredOn = (c: Case, p: Partial<PreferredConditions> = {}): Case => ({ ...c, offer: { ...c.offer, preferred: { ...c.offer.preferred, on: true, ...p } } });
const snapshot = (value: Case): Snapshot<Case> => ({ value, issues: [] }) as unknown as Snapshot<Case>;
/** A save that answers the case as saved, with a new Updated. */
const saved = (updatedAt = '2026-10-25T10:00:00.000Z') => async ({ case: c }: Parameters<Save>[0]): Promise<RemoteResult<Case>> =>
  ({ ok: true, snapshot: snapshot({ ...c, updatedAt }), entityId: null });
const lastSaved = (save: ReturnType<typeof vi.fn>) => (save.mock.lastCall?.[0] as Parameters<Save>[0]).case;
const status = () => screen.getByRole('status');
const profit = () => screen.getByRole('group', { name: 'Partner profit after costs' });
const card = (name: string | RegExp) => screen.getByRole('region', { name });

function show(c: Case, save: ReturnType<typeof vi.fn> = vi.fn(saved())) {
  const view = render(<CaseEditor initial={c} save={save as unknown as Save}><CaseSaveStatus /><PartnerCaseTab /></CaseEditor>);
  return { save, ...view };
}

beforeEach(() => {
  refresh.mockClear();
});

describe('PartnerCaseTab: the result follows the inputs', () => {
  it('shows the SaaS example’s profit and when it pays for itself', () => {
    show(saas());
    expect(screen.getByRole('heading', { level: 2, name: 'What partnering with Acme is worth to Northwind' })).toBeInTheDocument();
    expect(profit()).toHaveTextContent('€479,507');
    expect(profit()).toHaveTextContent('pays for itself in year 2, month 6');
    expect(screen.getByText('Reseller partner, 5 years, expected scenario. A typical customer is worth €24,000 a year plus €4,000 once.')).toBeInTheDocument();
  });

  it('recalculates for the Careful scenario, and saves it', async () => {
    const user = userEvent.setup();
    const { save } = show(saas());
    await user.click(screen.getByRole('button', { name: 'Careful' }));
    expect(screen.getByRole('button', { name: 'Careful' })).toHaveAttribute('aria-pressed', 'true');
    expect(profit()).toHaveTextContent('€265,373');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(lastSaved(save).scenario).toBe('careful');
  });

  it('labels the chart axis in round steps, from 0 for a small loss in year 1', () => {
    const { container } = show(saas());
    expect([...container.querySelectorAll('[data-tick]')].map((t) => t.textContent)).toEqual(['€0', '€100k', '€200k', '€300k', '€400k', '€500k']);
  });

  it('takes 4,000 off the profit for a new start cost of 4,000, and sums the costs up with the support', async () => {
    const user = userEvent.setup();
    const { save } = show(saas());
    expect(screen.getByText('€25,000 to get started, then €8,000 every year, plus €300 per customer a year for support.')).toBeInTheDocument();

    const start = screen.getByRole('group', { name: 'To get started' });
    await user.click(within(start).getByRole('button', { name: 'Add a cost' }));
    const name = within(start).getByRole('textbox', { name: 'To get started, line 4' });
    expect(name).toHaveValue('New cost');
    await user.clear(name);
    await user.type(name, 'Certification');
    const amount = within(start).getByRole('textbox', { name: 'To get started, line 4 amount' });
    await user.clear(amount);
    await user.type(amount, '4,000');

    expect(profit()).toHaveTextContent('€475,507');
    expect(screen.getByText('€29,000 to get started, then €8,000 every year, plus €300 per customer a year for support.')).toBeInTheDocument();
    await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/), { timeout: 2000 });
    const added = lastSaved(save).costs.at(-1)!;
    expect(added).toMatchObject({ name: 'Certification', when: 'start', amount: 4000 });
    expect(added.id).toMatch(/^cost_[0-9a-z]+$/);
  });

  it('sums up the partner fee and the share of the partner’s services with the costs, and counts them in the profit', async () => {
    const services = example('services');
    const { unmount } = show(services);
    expect(screen.getByText('€10,000 to get started, then €5,000 every year, plus €2,500 a year partner fee, plus €250 per customer a year for support.')).toBeInTheDocument();
    expect(profit()).toHaveTextContent(formatMoney(simulateCase(services).profit, 'EUR'));
    expect(within(card('Year by year')).getByRole('rowheader', { name: 'Partner fee to Cloudline' })).toBeInTheDocument();
    unmount();

    const onprem = preferredOn(example('onprem'), { rule: 'year', year: 3 });
    onprem.offer.types[0]!.preferred.servicesShare = 5;
    show(onprem);
    expect(screen.getByText('€30,000 to get started, then €10,000 every year, plus 10% of Kessler IT’s services to Secura as Registered, 5% as Preferred, plus €600 per customer a year for support.')).toBeInTheDocument();
    expect(profit()).toHaveTextContent(formatMoney(simulateCase(onprem).profit, 'EUR'));
    expect(within(card('Year by year')).getByRole('rowheader', { name: 'Share of services to Secura' })).toBeInTheDocument();
  });

  it('removes a cost line, and counts the partner’s support cost per customer', async () => {
    const user = userEvent.setup();
    show(saas());
    await user.click(screen.getByRole('button', { name: 'Remove Events and marketing' }));
    expect(screen.getByText('€25,000 to get started, then €3,000 every year, plus €300 per customer a year for support.')).toBeInTheDocument();
    const support = screen.getByRole('textbox', { name: 'Support cost per customer a year (level 1)' });
    expect(support).toHaveValue('300');
    expect(screen.getByText('The partner’s own cost of the support it gives each customer')).toBeInTheDocument();
  });

  it('lets up to 4 benefits be picked, never a fifth', async () => {
    const user = userEvent.setup();
    const { save } = show(saas());
    const chip = (name: string) => screen.getByRole('button', { name });
    expect(chip('New customers')).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip('Faster time to market'));
    expect(chip('Market credibility')).toBeDisabled();
    expect(chip('New customers')).toBeEnabled();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(lastSaved(save).benefits).toHaveLength(4);
  });

  it('fills the years from year 1, growing by the given rate', async () => {
    const user = userEvent.setup();
    show(saas());
    await user.click(screen.getByRole('button', { name: 'Fill' }));
    const deals = [1, 2, 3, 4, 5].map((y) => screen.getByRole('textbox', { name: `Year ${y}` }));
    expect(deals.map((d) => (d as HTMLInputElement).value)).toEqual(['3', '4', '6', '8', '12']);
  });

  it('shows the partner type by its name, fixed', () => {
    show(saas());
    expect(screen.getByRole('textbox', { name: 'Partner type' })).toHaveValue('Reseller');
    expect(screen.getByRole('textbox', { name: 'Partner type' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('combobox', { name: 'Partner type' })).toBeNull();
  });
});

describe('PartnerCaseTab: a company server’s viewer (owner, 2026-11-14)', () => {
  const asViewer = (viewer: boolean, save = vi.fn(saved())) => {
    render(
      <StorageProvider storage="database" viewer={viewer}>
        <CaseEditor initial={saas()} save={save as unknown as Save}><PartnerCaseTab /></CaseEditor>
      </StorageProvider>,
    );
    return save;
  };
  const inputs = () => [...screen.getByTestId('closed-for-viewer').querySelectorAll('input, select, textarea, button')] as HTMLElement[];

  it('reads every field, closed, with no Add, Remove or Fill, and saves nothing', async () => {
    const save = asViewer(true);
    expect(inputs().length).toBeGreaterThan(5);
    for (const field of inputs()) expect(field).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Year 1' })).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Expected' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Add a cost' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Year 1' }), { target: { value: '9' } });
    await new Promise((r) => setTimeout(r, 900));
    expect(save).not.toHaveBeenCalled();
    expect(profit()).toHaveTextContent('€479,507');
  });

  it('keeps the chosen scenario and benefits readable: no fade and no hover on the closed buttons', () => {
    asViewer(true);
    const chosen = [screen.getByRole('button', { name: 'Expected' }), screen.getByRole('button', { name: 'New customers' })];
    for (const b of chosen) {
      expect(b).toHaveAttribute('aria-pressed', 'true');
      expect(b.className).not.toMatch(/disabled:opacity|hover:/);
    }
    expect(screen.getByRole('button', { name: 'Careful' }).className).not.toMatch(/hover:/);
  });

  it('keeps everything open for an admin or a partner manager', () => {
    asViewer(false);
    expect(screen.getByRole('button', { name: 'Careful' }).className).toMatch(/hover:/);
    expect(screen.getByRole('button', { name: 'Market credibility' }).className).toMatch(/disabled:opacity-45/);
    expect(screen.getByRole('textbox', { name: 'Year 1' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Add a cost' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Fill' })).toBeEnabled();
    expect(screen.queryByTestId('closed-for-viewer')).toBeNull();
  });
});

describe('PartnerCaseTab: the partner case follows the partner type (BC v2 section 4)', () => {
  const TYPES = [
    {
      key: 'referral', deals: 'Deals from the partner’s referrals', hint: 'Your sales team closes the deals the partner introduces.', business: false,
      support: null, roles: 'Lumen Consulting introduces the customer · Brightdesk closes the deal and invoices the customer · Brightdesk provides customer support.',
      second: 'Customers by year 5',
    },
    {
      key: 'saas', deals: 'Deals the partner expects to close', hint: 'Most partners start slowly: the first deals usually come after a few months.', business: false,
      support: 'Support cost per customer a year (level 1)', roles: 'Northwind finds the customer, closes the deal and sends the invoice · Northwind provides level 1 support.',
      second: 'Customers by year 5',
    },
    {
      key: 'services', deals: 'New customers the partner serves', hint: 'The partner found 30% of these customers itself. Your team closes every deal.', business: true,
      support: 'Support cost per customer a year (level 1)',
      roles: 'Clearpath Consulting finds 30% of the customers it serves itself · Cloudline closes the deal and invoices the customer · Clearpath Consulting provides level 1 support · Clearpath Consulting delivers implementation and services.',
      second: 'Partner services',
    },
    {
      key: 'onprem', deals: 'Deals the partner expects to close', hint: 'Most partners start slowly: the first deals usually come after a few months.', business: true,
      support: 'Support cost per customer a year (level 1 and 2)',
      roles: 'Kessler IT finds the customer, closes the deal and sends the invoice · Kessler IT provides level 1 and 2 support · Kessler IT delivers implementation and services.',
      second: 'Partner services',
    },
  ] as const;

  it.each(TYPES)('$key: the deals card, the partner business, the support cost, who does what, the second headline', (t) => {
    show(example(t.key));
    expect(within(card(t.deals)).getByText(t.hint)).toBeInTheDocument();
    if (t.business) expect(card('Partner business around each deal')).toHaveTextContent('Partner profit on it');
    else expect(screen.queryByRole('region', { name: 'Partner business around each deal' })).toBeNull();
    const costs = card('What it costs the partner');
    if (t.support) expect(within(costs).getByRole('textbox', { name: t.support })).toBeInTheDocument();
    else expect(within(costs).queryByRole('textbox', { name: /^Support cost/ })).toBeNull();
    expect(screen.getByText(t.roles)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: t.second })).toBeInTheDocument();
  });

  it('has no field for the partner’s name: the case is named as Partners names the partner (owner, 2026-10-30)', () => {
    show({ ...saas(), partner: 'Northwind Group' });
    expect(screen.queryByRole('textbox', { name: 'Company' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Partner type' })).toHaveValue('Reseller');
    expect(screen.getByText('Northwind Group finds the customer, closes the deal and sends the invoice · Northwind Group provides level 1 support.')).toBeInTheDocument();
  });
});

describe('PartnerCaseTab: Preferred (BC v2 section 6), with the program’s level names', () => {
  it('while off: no Starts as, no When Preferred costs, no level, no star and no Preferred call-out', () => {
    const { container } = show(saas());
    expect(screen.queryByRole('combobox', { name: 'Starts as' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'When Preferred' })).toBeNull();
    expect(container).not.toHaveTextContent(/Registered|Preferred|★/);
  });

  it('while on: Starts as, the When Preferred costs, the level and the call-out', async () => {
    const user = userEvent.setup();
    const { container } = show(preferredOn(saas(), { rule: 'deals', deals: 8 }));
    const preferredCosts = screen.getByRole('group', { name: 'When Preferred' });
    expect(preferredCosts).toHaveTextContent('When Preferred · Every year as a Preferred partner');
    expect(screen.getByText('€25,000 to get started, then €8,000 every year, plus €6,000 a year as Preferred, plus €300 per customer a year for support.')).toBeInTheDocument();
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('★ Preferred from year 4. Being Preferred adds €189,772 over 5 years, after its extra costs.');
    expect(within(screen.getByRole('table', { name: 'Year by year' })).getByRole('rowheader', { name: 'Tier' })).toBeInTheDocument();
    expect(container).toHaveTextContent('Year 4 ★');

    expect(screen.getByText('Preferred for a partner who already has the tier')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Starts as' }), 'preferred');
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('★ Starts as Preferred.');
  });

  it('names the levels as the program does, everywhere on the tab', async () => {
    const user = userEvent.setup();
    const c = preferredOn(saas(), { rule: 'deals', deals: 8 });
    c.offer.levels = { registered: 'Member', preferred: 'Gold' };
    const { container } = show(c);
    expect(screen.getByRole('group', { name: 'When Gold' })).toHaveTextContent('When Gold · Every year as a Gold partner');
    expect(screen.getByText('€25,000 to get started, then €8,000 every year, plus €6,000 a year as Gold, plus €300 per customer a year for support.')).toBeInTheDocument();
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('★ Gold from year 4. Being Gold adds €189,772 over 5 years, after its extra costs.');
    expect([...screen.getByRole('combobox', { name: 'Starts as' }).querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Member', 'Gold']);
    const table = screen.getByRole('table', { name: 'Year by year' });
    expect(within(table).getAllByText('Member')).toHaveLength(3);
    expect(within(table).getAllByText('Gold')).toHaveLength(2);
    fireEvent.focus(screen.getByRole('button', { name: 'Year 4, Gold' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Year 4 · Gold');
    expect(container.textContent).not.toMatch(/Registered|Preferred/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Starts as' }), 'Gold');
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('★ Starts as Gold.');
  });

  it('keeps the When Preferred lines while Preferred is off', async () => {
    const user = userEvent.setup();
    const { save } = show(saas());
    await user.click(screen.getByRole('button', { name: 'Ambitious' }));
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastSaved(save).costs.filter((x) => x.when === 'preferred')).toHaveLength(1);
  });
});

describe('PartnerCaseTab: wording (BC v2 section 10)', () => {
  const THEY = /\b[Tt]he(ir|y|m)\b/;

  it.each(EXAMPLE_KEYS.flatMap((key) => [{ key, on: false }, { key, on: true }]))(
    'never says their, they or them for the partner: $key, Preferred on $on',
    ({ key, on }) => {
      const c = example(key);
      const { container, unmount } = show(on ? preferredOn(c) : c);
      fireEvent.focus(screen.getByRole('button', { name: /^Year 1/ }));
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      expect(document.body.innerHTML).not.toMatch(THEY);
      expect(container.textContent).not.toMatch(THEY);
      unmount();
    },
  );
});

describe('PartnerCaseTab: numbers still being typed (Review Focus 5)', () => {
  it('counts a number being typed in the offer as 0, and shows no NaN, Infinity or negative zero', () => {
    const c = saas();
    c.offer.products[0]!.price = Number.NaN;
    c.offer.renewal = Number.NaN;
    c.offer.types[0]!.registered.first = Number.NaN;
    c.deals = [Number.NaN, 0, 0, 0, 0];
    const { container } = show(c);
    expect(container.textContent).not.toMatch(/NaN|Infinity|-€0(?![\d,])/);
    expect(forResult(c).offer.products[0]!.price).toBe(0);
  });

  it('with an empty offer and no deals shows €0, not paid back yet', () => {
    const c = saas();
    c.offer.products = [];
    c.offer.renewal = 0;
    c.deals = [0, 0, 0, 0, 0];
    c.costs = [];
    c.supportCost = 0;
    const { container } = show(c);
    expect(profit()).toHaveTextContent('€0');
    expect(profit()).toHaveTextContent('not paid back yet');
    expect(container.textContent).not.toMatch(/NaN|Infinity|-€0(?![\d,])/);
  });
});

describe('CaseEditor: saving', () => {
  it('saves a change with the case as read and its Updated, then over the case as last saved', async () => {
    const user = userEvent.setup();
    const c = saas();
    const { save } = show(c, vi.fn(saved('2026-10-25T10:00:00.000Z')));

    const year1 = screen.getByRole('textbox', { name: 'Year 1' });
    await user.clear(year1);
    await user.type(year1, '4');
    await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/), { timeout: 2000 });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      caseId: c.id, case: expect.objectContaining({ deals: [4, 7, 11, 15, 19] }), base: c, expectedUpdatedAt: c.updatedAt,
    }));

    const year2 = screen.getByRole('textbox', { name: 'Year 2' });
    await user.clear(year2);
    await user.type(year2, '8');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      case: expect.objectContaining({ deals: [4, 8, 11, 15, 19] }), expectedUpdatedAt: '2026-10-25T10:00:00.000Z',
    }));
  });

  it('shows what is wrong under the field and never saves an invalid case', async () => {
    const user = userEvent.setup();
    const { save } = show(saas());
    await user.clear(screen.getByRole('textbox', { name: 'Year 2' }));
    await user.type(screen.getByRole('textbox', { name: 'Year 2' }), '2.5');
    expect(await screen.findByText('Deals in year 2 must be a whole number.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1000));
    expect(save).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent('Not saved: Deals in year 2 must be a whole number.');
  });

  it('shows a failed save’s message with Try again', async () => {
    const user = userEvent.setup();
    const save = vi.fn<Save>(async () => ({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE }));
    show(saas(), save);
    await user.click(screen.getByRole('button', { name: 'Ambitious' }));
    await waitFor(() => expect(status()).toHaveTextContent(COPY.UNAVAILABLE_MESSAGE), { timeout: 2000 });
    save.mockImplementation(saved());
    await user.click(screen.getByRole('button', { name: COPY.TRY_AGAIN }));
    await waitFor(() => expect(status()).toHaveTextContent(/^Saved$/));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('stops saving once the case was changed somewhere else, and offers Reload (Review Focus 4)', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (): Promise<RemoteResult<Case>> => ({ ok: false, error: 'conflict', message: COPY.CONFLICT }));
    const { unmount } = show(saas(), save);
    await user.click(screen.getByRole('button', { name: 'Ambitious' }));
    await waitFor(() => expect(status()).toHaveTextContent(COPY.CHANGED_SOMEWHERE_ELSE), { timeout: 2000 });
    expect(screen.queryByRole('button', { name: COPY.TRY_AGAIN })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Careful' }));
    await new Promise((r) => setTimeout(r, 1000));
    expect(save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: COPY.RELOAD }));
    expect(refresh).toHaveBeenCalled();
    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('sends what isn’t saved yet when the case leaves the screen (Back)', async () => {
    const user = userEvent.setup();
    const { save, unmount } = show(saas());
    const year1 = screen.getByRole('textbox', { name: 'Year 1' });
    await user.clear(year1);
    await user.type(year1, '6');
    unmount();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lastSaved(save).deals[0]).toBe(6);
  });
});
