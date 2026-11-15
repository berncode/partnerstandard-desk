// @vitest-environment jsdom
import { EXAMPLES } from '@partner-desk/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OurFiguresCard } from './our-figures-card';

const ours = () => structuredClone(EXAMPLES.saas.case.ours);

describe('OurFiguresCard', () => {
  it('is marked internal and shows the figures and the default cost lines in all three groups', () => {
    render(<OurFiguresCard ours={{ figures: ours().figures, costs: ours().costs }} currency="EUR" issues={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Our figures' })).toBeInTheDocument();
    expect(screen.getByText('Internal. A new case copies these. They never reach a partner.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your gross margin' })).toHaveValue('80');
    for (const group of ['To get started', 'Every year', 'When Preferred']) expect(screen.getByRole('group', { name: new RegExp(`^${group}`) })).toBeInTheDocument();
  });

  it('hands back the figures and the lines as changed, and shows the facts’ issues under their fields', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { figures, costs } = ours();
    render(<OurFiguresCard ours={{ figures, costs }} currency="EUR" onChange={onChange}
      issues={[{ path: 'ours.figures.serve.close', message: 'Closing a deal must be 0 or more.' }]} />);
    expect(screen.getByText('Closing a deal must be 0 or more.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a cost every year' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.lastCall![0].costs).toHaveLength(costs.length + 1);
    expect(onChange.mock.lastCall![0].figures).toEqual(figures);
  });
});
