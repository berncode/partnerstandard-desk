// @vitest-environment jsdom
import { anAccount, sampleBook } from '@partner-desk/core/test-builders';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COPY } from '@partner-desk/copy';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { AccountHeader } from './account-header';
import { renderPartner } from './test-harness';

describe('the company name', () => {
  it('is edited on the heading, and can’t be left empty', async () => {
    const user = userEvent.setup();
    const book = sampleBook({ accounts: [anAccount({ company: 'Acme GmbH' })], marketLinks: [] });
    const { dispatched } = renderPartner(<AccountHeader />, book);
    const heading = screen.getByRole('heading', { level: 1 });
    await user.click(within(heading).getByRole('button', { name: 'Company: Acme GmbH' }));
    await user.clear(screen.getByRole('textbox', { name: 'Company' }));
    await user.keyboard('{Enter}');
    expect(screen.getByText('Company is required')).toBeInTheDocument();
    expect(dispatched.filter((d) => d.change.kind === 'update' && 'company' in d.change.patch && d.change.patch.company === '')).toHaveLength(1);
    await user.type(screen.getByRole('textbox', { name: 'Company' }), 'Acme AG{Enter}');
    expect(dispatched.at(-1)).toEqual({
      change: { kind: 'update', entity: 'account', id: 'a_abc123', patch: { company: 'Acme AG' } }, options: { label: COPY.PARTNER_UPDATED },
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme AG');
  });

  it('is plain text when the page is read-only', () => {
    renderPartner(<AccountHeader />, sampleBook({ marketLinks: [] }), { readOnly: true });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme GmbH');
    expect(within(screen.getByRole('heading', { level: 1 })).queryByRole('button')).toBeNull();
  });
});

describe('the company header', () => {
  it('shows the name, and edits the website and the country on the company', async () => {
    const user = userEvent.setup();
    const book = sampleBook({
      accounts: [anAccount({ company: 'Acme GmbH', website: 'https://acme.example', country: '' })],
      marketLinks: [],
    });
    const { dispatched } = renderPartner(<AccountHeader />, book);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme GmbH');
    await user.click(screen.getByRole('button', { name: 'Country: empty' }));
    await user.keyboard('Austria{Enter}');
    expect(dispatched.at(-1)?.change).toEqual({
      kind: 'update', entity: 'account', id: 'a_abc123', patch: { country: 'Austria' },
    });
  });
});
