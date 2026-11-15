// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Currency } from '@partner-desk/core';
import { MoneyInput, OptionalMoneyInput } from './money-input';
import { NumberInput, parseNumber } from './number-input';
import { PercentInput } from './percent-input';

function Money({ initial, currency = 'EUR', onChange }: { initial: number; currency?: Currency; onChange: (n: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <MoneyInput id="price" label="Price" caption="List price" currency={currency} value={value}
      onChange={(n) => { setValue(n); onChange(n); }} />
  );
}

describe('parseNumber', () => {
  it.each([
    ['12000', 12000],
    ['12,000', 12000],
    [' 1,234.5 ', 1234.5],
    ['12,5', 12.5],
    ['2,50', 2.5],
    ['12.000,50', 12000.5],
    ['1,234.5', 1234.5],
    ['1,234', 1234],
    ['1.234.567', 1234567],
    ['1.5', 1.5],
    ['€1,200', 1200],
    ['CHF 1 500', 1500],
    ['85%', 85],
    ['8,5 %', 8.5],
    ['-800', -800],
    ['12,', 12],
  ])('reads %j as %d', (typed, n) => {
    expect(parseNumber(typed)).toBe(n);
  });

  it.each(['1,2,3', 'abc', '12x', '', '-', '1.2.3', '1.234,5,6', '1,23.4'])('reads %j as not a number', (typed) => {
    expect(parseNumber(typed)).toBeNaN();
  });
});

describe('OptionalMoneyInput', () => {
  function Optional({ initial, onChange }: { initial: number | null; onChange: (n: number | null) => void }) {
    const [value, setValue] = useState(initial);
    return (
      <OptionalMoneyInput id="spend" label="Sales and marketing, last year" currency="EUR" value={value}
        onChange={(n) => { setValue(n); onChange(n); }} />
    );
  }

  it('shows not known while empty and reads an emptied field as null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Optional initial={2600000} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Sales and marketing, last year' });
    expect(input).toHaveValue('2,600,000');
    expect(input).toHaveAttribute('placeholder', 'not known');
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.tab();
    expect(input).toHaveValue('');
    await user.type(input, '6500000');
    expect(onChange).toHaveBeenLastCalledWith(6500000);
  });

  it('starts empty for null', () => {
    render(<Optional initial={null} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Sales and marketing, last year' })).toHaveValue('');
  });
});

describe('MoneyInput', () => {
  it('shows thousands separators, the sign before the number, a label and a caption', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Money initial={4000} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Price' });
    expect(input).toHaveValue('4,000');
    expect(input).toHaveAttribute('id', 'price');
    expect(input).toHaveClass('text-right', 'tabular-nums');
    expect(screen.getByText('€')).toBeInTheDocument();
    expect(screen.getByText('List price')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '12000');
    expect(onChange).toHaveBeenLastCalledWith(12000);
    await user.tab();
    expect(input).toHaveValue('12,000');
  });

  it('reads European input and shows it in the display format after leaving the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Money initial={4000} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Price' });
    await user.clear(input);
    await user.type(input, '12.000,50');
    expect(onChange).toHaveBeenLastCalledWith(12000.5);
    await user.tab();
    expect(input).toHaveValue('12,000.5');
  });

  it('keeps what was typed when it is not a number, so it can be fixed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Money initial={4000} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Price' });
    await user.clear(input);
    await user.type(input, '12x');
    await user.tab();
    expect(input).toHaveValue('12x');
    expect(onChange).toHaveBeenLastCalledWith(NaN);
  });

  it('shows an error in place of the caption', () => {
    render(<MoneyInput id="p" label="Price" caption="List price" error="Price must be 0 or more." currency="EUR" value={-1} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveAccessibleDescription('Price must be 0 or more.');
    expect(screen.queryByText('List price')).toBeNull();
  });
});

describe('PercentInput and NumberInput', () => {
  it('show their unit after the number', () => {
    render(
      <>
        <PercentInput id="renew" label="Customers who renew" unit="% a year" value={90} onChange={() => {}} />
        <NumberInput id="pref" label="Preferred from" unit="deals a year" value={1200} onChange={() => {}} />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Customers who renew' })).toHaveValue('90');
    expect(screen.getByText('% a year')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Preferred from' })).toHaveValue('1,200');
    expect(screen.getByText('deals a year')).toBeInTheDocument();
  });

  it('can take its label from a column heading, for grids', () => {
    render(<PercentInput id="r" label="Each renewal year, Registered" labelHidden value={20} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Each renewal year, Registered' })).toHaveValue('20');
    expect(screen.queryByText('Each renewal year, Registered')).toBeNull();
  });
});
