// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScorecardTable, type ScoreRow } from './scorecard-table';

const row = (over: Partial<ScoreRow> = {}): ScoreRow => ({
  key: 'dealsWon', label: 'Deals won', actual: null, target: null, source: null, note: '', suggestion: null, ...over,
});
const save = () => ({ ok: true }) as never;
const line = (label: string) => screen.getByRole('row', { name: new RegExp(`^${label}`) });

describe('ScorecardTable', () => {
  it('shows actual, target and percent', () => {
    render(<ScorecardTable rows={[row({ actual: 3, target: 4 }), row({ key: 'weBill', label: 'We bill', actual: 30000, target: 40000.04 })]} noCase={false} onChange={save} />);
    const deals = line('Deals won');
    expect(within(deals).getByRole('textbox', { name: 'Deals won: actual' })).toHaveValue('3');
    expect(within(deals).getByRole('textbox', { name: 'Deals won: target' })).toHaveValue('4');
    expect(deals).toHaveTextContent('75%');
    // Money and forecast targets are rounded on screen.
    expect(within(line('We bill')).getByRole('textbox', { name: 'We bill: target' })).toHaveValue('40000');
    expect(screen.queryByText('No business case')).not.toBeInTheDocument();
  });

  it('No business case when there are no targets', () => {
    render(<ScorecardTable rows={[row({ actual: 2 })]} noCase onChange={save} />);
    expect(screen.getByText('No business case')).toBeInTheDocument();
    expect(within(line('Deals won')).getByRole('textbox', { name: 'Deals won: target' })).toHaveValue('');
    expect(line('Deals won')).not.toHaveTextContent('%');
  });

  it('no percent when the target is 0', () => {
    render(<ScorecardTable rows={[row({ actual: 2, target: 0 })]} noCase={false} />);
    expect(line('Deals won')).not.toHaveTextContent('%');
    expect(line('Deals won')).not.toHaveTextContent('Infinity');
  });

  it('saves a typed number, refuses text such as 12k, and offers a prefill', async () => {
    const onChange = vi.fn(() => ({ ok: true }) as never);
    const user = userEvent.setup();
    render(<ScorecardTable rows={[row(), row({ key: 'weBill', label: 'We bill', suggestion: 12000 })]} noCase={false} onChange={onChange} />);
    await user.type(screen.getByRole('textbox', { name: 'Deals won: actual' }), '5{Enter}');
    expect(onChange).toHaveBeenCalledWith('dealsWon', { actual: 5 });
    await user.type(screen.getByRole('textbox', { name: 'Deals won: target' }), '12k{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Type a number, like 12000 or 12.5.');
    expect(onChange).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Use 12,000' }));
    expect(onChange).toHaveBeenCalledWith('weBill', { actual: 12000 });
  });

  it('shows money in the case’s currency, whole, and counts the percent from what it shows', () => {
    render(<ScorecardTable readOnly noCase={false} currency="EUR" rows={[
      row({ actual: 1, target: 0.74 }),
      row({ key: 'weBill', label: 'We bill', actual: 3550.7, target: 11835.6 }),
      row({ key: 'partnerEarns', label: 'The partner earns', actual: 1, target: 1.6 }),
      row({ key: 'openValue', label: 'Open deals value', actual: 25000, target: null }),
    ]} />);
    // A target stored before targets were whole: 0.7 shown, so 1 of 0.7 is 143%.
    expect(line('Deals won')).toHaveTextContent(/^Deals won10\.7143%$/);
    expect(line('We bill')).toHaveTextContent('€3,551');
    expect(line('We bill')).toHaveTextContent('€11,836');
    expect(line('We bill')).toHaveTextContent('30%');
    // €1 of €2 is 50%, not the 63% of 1 of 1.6.
    expect(line('The partner earns')).toHaveTextContent(/€1€250%$/);
    expect(line('Open deals value')).toHaveTextContent('€25,000');
  });

  it('shows money without a sign when there is no case, still whole', () => {
    render(<ScorecardTable readOnly noCase currency={null} rows={[row({ key: 'weBill', label: 'We bill', actual: 3550.7, target: null })]} />);
    expect(line('We bill')).toHaveTextContent(/^We bill3,551$/);
  });

  it('an editable money field shows the currency, and its prefill is whole money', async () => {
    const onChange = vi.fn(() => ({ ok: true }) as never);
    const user = userEvent.setup();
    render(<ScorecardTable noCase={false} currency="USD" onChange={onChange}
      rows={[row({ key: 'weBill', label: 'We bill', suggestion: 12000.4, target: 11835.6 })]} />);
    expect(within(line('We bill')).getAllByText('$')).toHaveLength(2);
    expect(within(line('We bill')).getByRole('textbox', { name: 'We bill: target' })).toHaveValue('11836');
    await user.click(screen.getByRole('button', { name: 'Use $12,000' }));
    expect(onChange).toHaveBeenCalledWith('weBill', { actual: 12000 });
  });

  it('shows the numbers as text when read only', () => {
    render(<ScorecardTable rows={[row({ actual: 3, target: 4 })]} noCase={false} readOnly />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(line('Deals won')).toHaveTextContent('3');
    expect(line('Deals won')).toHaveTextContent('75%');
  });
});
