// @vitest-environment jsdom
import { aPartner } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TypeTabs } from './type-tabs';

const sections = [
  aPartner({ id: 'p_tech', partnerType: 'technology', accountId: 'a_1' }),
  aPartner({ id: 'p_resell', partnerType: 'reseller', accountId: 'a_1' }),
];

describe('partner type tabs', () => {
  it('names each tab by its type and adds another type', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onAdd = vi.fn();
    render(<TypeTabs sections={sections} value="technology" onValueChange={onValueChange} onAdd={onAdd} readOnly={false} />);
    expect(screen.getByRole('tab', { name: 'Technology Partner' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Reseller' }));
    expect(onValueChange).toHaveBeenCalledWith('reseller');
    await user.click(screen.getByRole('button', { name: COPY.ADD_PARTNER_TYPE }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('hides Add partner type when the page is read-only', () => {
    render(<TypeTabs sections={sections} value="reseller" onValueChange={vi.fn()} onAdd={vi.fn()} readOnly />);
    expect(screen.queryByRole('button', { name: COPY.ADD_PARTNER_TYPE })).toBeNull();
  });
});
