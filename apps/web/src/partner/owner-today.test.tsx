// @vitest-environment jsdom
import { aPartner, sampleBook } from '@partner-desk/core/test-builders';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { AddTypeDialog } from './add-type-dialog';
import { CallForm } from './call-form';
import { CorrectExitDialog, ExitDialog } from './exit-dialog';
import { SignDialog } from './sign-dialog';
import { renderPartner } from './test-harness';

// The browser's clock says 29 October (in Berlin, as in Vienna); the owner's Settings time zone already says 28 October
// on the server, as at 01:00 in Berlin for an owner in New York. Every dialog starts on the owner's date, so a MAP
// planned from the owner's date never offers a one-day move.
const OWNER = '2026-10-28';
const zone = process.env.TZ;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  process.env.TZ = 'Europe/Berlin';
  vi.setSystemTime(new Date('2026-10-29T00:30:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = zone;
});

const book = (over = {}) => sampleBook({ partners: [aPartner(over)], marketLinks: [] });

describe('the date a dialog starts on', () => {
  it('is the owner’s today in Mark signed, not the browser’s', () => {
    renderPartner(<SignDialog open onOpenChange={() => {}} />, book(), { today: OWNER });
    expect(screen.getByLabelText('Date signed')).toHaveValue(OWNER);
  });

  it('is the owner’s today in Mark exited and in a correction with no exit date', () => {
    const { unmount } = renderPartner(<ExitDialog open onOpenChange={() => {}} />, book({ stage: 'onboarding', signedDate: '2026-01-01' }), { today: OWNER });
    expect(screen.getByLabelText('Exit date')).toHaveValue(OWNER);
    unmount();
    renderPartner(<CorrectExitDialog open onOpenChange={() => {}} />, book({ stage: 'onboarding', signedDate: '2026-01-01' }), { today: OWNER });
    expect(screen.getByLabelText('Exit date')).toHaveValue(OWNER);
  });

  it('is the owner’s today in Log a call', () => {
    renderPartner(<CallForm onClose={() => {}} onLogged={() => {}} />, book(), { today: OWNER });
    expect(screen.getByLabelText('Date')).toHaveValue(OWNER);
  });

  it('is the owner’s today in a new partner type’s signing date, and the person can still pick another', async () => {
    const user = userEvent.setup();
    render(<AddTypeDialog open onOpenChange={() => {}} accountId="a_1" taken={['reseller']} apply={async () => ({ ok: false })} onAdded={() => {}} today={OWNER} />);
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'onboarding');
    const signed = screen.getByLabelText('Signed on');
    expect(signed).toHaveValue(OWNER);
    await user.clear(signed);
    await user.type(signed, '2026-09-01');
    expect(signed).toHaveValue('2026-09-01');
  });
});
