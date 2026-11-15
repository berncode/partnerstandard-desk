// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EXAMPLES, type Figures } from '@partner-desk/core';
import { FiguresForm } from './figures-form';

function Harness({ onChange }: { onChange: (f: Figures) => void }) {
  const [figures, setFigures] = useState(structuredClone(EXAMPLES.saas.case.ours.figures));
  return (
    <FiguresForm figures={figures} currency="EUR" issues={[{ path: 'serve.close', message: 'Closing a deal must be 0 or more.' }]}
      onChange={(next) => {
        setFigures(next);
        onChange(next);
      }} />
  );
}

describe('FiguresForm', () => {
  it('shows our gross margin and the cost of winning and serving a customer, each with where it comes from', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness onChange={changed} />);

    expect(screen.getByRole('textbox', { name: 'Your gross margin' })).toHaveValue('80');
    expect(screen.getByText('Left after hosting and delivery, before support')).toBeInTheDocument();
    expect(screen.getByText('What a customer costs you without a partner. The partner type decides which parts the partner takes over.')).toBeInTheDocument();
    const values = {
      'Finding a lead': '3,000', 'Closing a deal': '6,000', 'Support level 1': '300', 'Support level 2': '250',
      'Services: your cost': '0', 'Services: what you charge': '0',
    };
    for (const [name, value] of Object.entries(values)) expect(screen.getByRole('textbox', { name })).toHaveValue(value);
    expect(screen.getByText('Closing a deal must be 0 or more.')).toBeInTheDocument();

    const sources = {
      'Your gross margin source': 'Finance', 'Sales costs source': 'Sales', 'Support costs source': 'Finance', 'Services source': 'Finance',
    };
    for (const [name, value] of Object.entries(sources)) expect(screen.getByRole('combobox', { name })).toHaveDisplayValue(value);
    expect(screen.getAllByText('Source')).toHaveLength(4);
    const options = [...screen.getByRole('combobox', { name: 'Sales costs source' }).querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['Assumption', 'Finance', 'Sales', 'Partner', 'Other']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Support costs source' }), 'Assumption');
    const level2 = screen.getByRole('textbox', { name: 'Support level 2' });
    await user.clear(level2);
    await user.type(level2, '400');
    const margin = screen.getByRole('textbox', { name: 'Your gross margin' });
    await user.clear(margin);
    await user.type(margin, '70');
    expect(changed.mock.lastCall?.[0]).toMatchObject({
      margin: 70, marginSource: 'finance', serve: { support2: 400, supportSource: 'assumption', find: 3000 },
    });
  });
});
