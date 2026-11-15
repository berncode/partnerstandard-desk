// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EXAMPLES, type OurCostLine } from '@partner-desk/core';
import { StorageProvider } from '@/storage-context';
import { costGroups, OurCostLinesForm } from './our-cost-lines';

function Harness({ preferred, onChange }: { preferred: boolean; onChange: (lines: OurCostLine[]) => void }) {
  const [lines, setLines] = useState(structuredClone(EXAMPLES.saas.case.ours.costs));
  return (
    <OurCostLinesForm lines={lines} currency="EUR" issues={[]} groups={costGroups(preferred)}
      onChange={(next) => {
        setLines(next);
        onChange(next);
      }} />
  );
}

const group = (name: string) => screen.getByRole('group', { name });

describe('OurCostLinesForm', () => {
  it('shows the lines by when they are paid, each with its source; When Preferred only while Preferred is on', () => {
    const { rerender } = render(<Harness preferred={false} onChange={() => {}} />);
    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(within(group('To get started')).getByRole('textbox', { name: 'To get started, line 1' })).toHaveValue('Onboarding and enablement');
    expect(within(group('Every year')).getByRole('textbox', { name: 'Every year, line 1' })).toHaveValue('Partner manager time');
    expect(within(group('Every year')).getByRole('textbox', { name: 'Every year, line 1 amount' })).toHaveValue('30,000');
    expect(within(group('Every year')).getByRole('combobox', { name: 'Every year, line 1 source' })).toHaveDisplayValue('Finance');
    expect(screen.queryByRole('group', { name: 'When Preferred' })).toBeNull();

    rerender(<Harness preferred onChange={() => {}} />);
    expect(screen.getByText('· Every year as a Preferred partner')).toBeInTheDocument();
    expect(within(group('When Preferred')).getByRole('textbox', { name: 'When Preferred, line 1' })).toHaveValue('Dedicated partner support');
  });

  it('adds, changes and removes lines, and keeps the When Preferred lines while that group is hidden', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness preferred={false} onChange={changed} />);

    expect(screen.getAllByRole('button', { name: /^Add a cost/ }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Add a cost to get started', 'Add a cost every year']);
    await user.click(within(group('To get started')).getByRole('button', { name: 'Add a cost to get started' }));
    let lines = changed.mock.lastCall?.[0] as OurCostLine[];
    const added = lines.at(-1)!;
    expect(added).toMatchObject({ name: 'New cost', when: 'start', amount: 1000, source: 'assumption' });
    expect(added.id).toMatch(/^cost_[0-9a-z]+$/);

    await user.selectOptions(within(group('To get started')).getByRole('combobox', { name: 'To get started, line 3 source' }), 'Partner');
    await user.click(screen.getByRole('button', { name: 'Remove Partner manager time' }));
    lines = changed.mock.lastCall?.[0] as OurCostLine[];
    expect(lines.find((l) => l.id === added.id)?.source).toBe('partner');
    expect(lines.map((l) => l.name)).not.toContain('Partner manager time');
    expect(lines.map((l) => l.name)).toContain('Dedicated partner support');
  });
});

describe('OurCostLinesForm: a company server’s viewer (owner, 2026-11-14)', () => {
  it('shows the lines with no Add a cost or Remove', () => {
    render(<StorageProvider storage="database" viewer><Harness preferred onChange={() => {}} /></StorageProvider>);
    expect(within(group('Every year')).getByRole('textbox', { name: 'Every year, line 1' })).toHaveValue('Partner manager time');
    expect(screen.queryByRole('button', { name: /Add a cost|^Remove / })).toBeNull();
  });
});
