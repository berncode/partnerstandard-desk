// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rename: vi.fn(), remove: vi.fn(), refresh: vi.fn(), zone: vi.fn(), emailType: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('../actions/company', () => ({ companyRename: mocks.rename, companyTimeZone: mocks.zone }));
vi.mock('./actions', () => ({ deleteMyAccount: mocks.remove, setEmailType: mocks.emailType }));
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

const { CompanyForm } = await import('./company-form');
const { DeleteAccount } = await import('./delete-account');
const { Storage } = await import('./storage-panel');
const { TimeZoneForm } = await import('./time-zone-form');
const { EmailPreferences } = await import('./email-prefs');
const { StorageProvider } = await import('@/storage-context');
const { copyFor } = await import('@partner-desk/copy');

beforeEach(() => { vi.clearAllMocks(); });

describe('CompanyForm', () => {
  it('saves the cleaned name, says so, and refreshes so the sidebar shows it', async () => {
    mocks.rename.mockResolvedValue({ ok: true, name: 'Halden GmbH' });
    const user = userEvent.setup();
    render(<CompanyForm initial="" />);
    expect(screen.getByText(COPY.SETTINGS_COMPANY_HINT_EMPTY)).toBeVisible();
    await user.type(screen.getByLabelText(COPY.SETTINGS_COMPANY_FIELD), '  Halden GmbH ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(COPY.SETTINGS_SAVED));
    expect(mocks.rename).toHaveBeenCalledWith({ name: '  Halden GmbH ' });
    expect(screen.getByLabelText(COPY.SETTINGS_COMPANY_FIELD)).toHaveValue('Halden GmbH');
    expect(screen.getByText(COPY.SETTINGS_COMPANY_HINT('Halden GmbH'))).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows why a name is refused and does not refresh', async () => {
    mocks.rename.mockResolvedValue({ ok: false, error: 'invalid', message: 'x', fieldErrors: { name: COPY.COMPANY_NAME_TOO_LONG } });
    const user = userEvent.setup();
    render(<CompanyForm initial="Halden" />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.COMPANY_NAME_TOO_LONG);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('says something went wrong when the server can’t be reached', async () => {
    mocks.rename.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<CompanyForm initial="Halden" />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.SETTINGS_WRONG);
  });
});

describe('DeleteAccount', () => {
  it('is disabled until DELETE is typed, then sends it', async () => {
    mocks.remove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DeleteAccount />);
    const button = screen.getByRole('button', { name: COPY.SETTINGS_DELETE_BUTTON });
    expect(button).toBeDisabled();
    expect(screen.getByText(COPY.SETTINGS_DELETE_TEXT)).toBeVisible();
    await user.type(screen.getByLabelText(COPY.SETTINGS_DELETE_LABEL), 'DELETE');
    expect(button).toBeEnabled();
    await user.click(button);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('DELETE'));
  });

  it('shows the server’s refusal', async () => {
    mocks.remove.mockResolvedValue({ ok: false, message: COPY.DELETE_ACCOUNT_FAILED });
    const user = userEvent.setup();
    render(<DeleteAccount />);
    await user.type(screen.getByLabelText(COPY.SETTINGS_DELETE_LABEL), 'DELETE');
    await user.click(screen.getByRole('button', { name: COPY.SETTINGS_DELETE_BUTTON }));
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.DELETE_ACCOUNT_FAILED);
  });
});

describe('Storage', () => {
  it('names the Google account and the folder, offers Reconnect Google, and says where access is removed (never by us)', () => {
    render(<Storage session={{ email: 'anna@example.test', storage: 'google' }} />);
    expect(screen.getByText(COPY.SETTINGS_STORAGE_TEXT('anna@example.test'))).toBeVisible();
    expect(screen.getByText(/PartnerStandard \/ PartnerStandard Desk/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reconnect Google' })).toBeVisible();
    const link = screen.getByRole('link', { name: COPY.GOOGLE_CONNECTIONS_LINK });
    expect(link).toHaveAttribute('href', 'https://myaccount.google.com/connections');
    expect(link.parentElement).toHaveTextContent('other PartnerStandard tools');
    expect(screen.queryByRole('button', { name: /disconnect|revoke/i })).toBeNull();
  });

  it('has nothing to connect for a test account', () => {
    render(<Storage session={{ email: 'test@example.test', storage: 'memory' }} />);
    expect(screen.getByText(COPY.SETTINGS_STORAGE_TEST)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reconnect Google' })).toBeNull();
  });

  it('says the work is in the company’s database on a company server, with nothing about Google (plan 13, task 12)', () => {
    render(<Storage session={{ email: 'anna@example.test', storage: 'database' }} />);
    expect(screen.getByText(copyFor('database').SETTINGS_STORAGE_TEXT('anna@example.test'))).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reconnect Google' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Google|Drive/);
  });
});

describe('TimeZoneForm', () => {
  it('saves the chosen timezone and says so; a refusal is shown', async () => {
    mocks.zone.mockResolvedValueOnce({ ok: true, timeZone: 'America/New_York' });
    const user = userEvent.setup();
    render(<TimeZoneForm initial="Europe/Berlin" choices={['America/New_York', 'Europe/Berlin']} />);
    expect(screen.getByLabelText(COPY.SETTINGS_TIME_ZONE_FIELD)).toHaveValue('Europe/Berlin');
    expect(screen.getByText(COPY.SETTINGS_TIME_ZONE_HINT)).toBeVisible();
    expect(screen.getByRole('option', { name: 'America/New York' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(COPY.SETTINGS_TIME_ZONE_FIELD), 'America/New_York');
    await user.click(screen.getByRole('button', { name: COPY.SETTINGS_TIME_ZONE_SAVE }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(COPY.SETTINGS_SAVED));
    expect(mocks.zone).toHaveBeenCalledWith({ timeZone: 'America/New_York' });
    mocks.zone.mockResolvedValueOnce({ ok: false, error: 'invalid', message: COPY.SETTINGS_TIME_ZONE_INVALID });
    await user.click(screen.getByRole('button', { name: COPY.SETTINGS_TIME_ZONE_SAVE }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(COPY.SETTINGS_TIME_ZONE_INVALID));
  });
});

describe('EmailPreferences', () => {
  it('turns a kind of email off and on for the person’s own address, and puts a failed change back', async () => {
    const user = userEvent.setup();
    mocks.emailType.mockResolvedValue({ ok: true });
    render(<EmailPreferences email="anna@example.com" mailConfigured initial={[
      { type: 'nudges', on: true }, { type: 'digest', on: false }, { type: 'partner_alerts', on: true }, { type: 'momentum', on: true },
    ]} />);
    expect(screen.getByText(COPY.SETTINGS_EMAILS_TEXT('anna@example.com'))).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'The weekly digest' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Reminders about your activities' }));
    expect(mocks.emailType).toHaveBeenCalledWith('nudges', false);
    expect(screen.getByRole('checkbox', { name: 'Reminders about your activities' })).not.toBeChecked();
    mocks.emailType.mockResolvedValueOnce({ ok: false, message: COPY.SETTINGS_WRONG });
    await user.click(screen.getByRole('checkbox', { name: 'The weekly digest' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(COPY.SETTINGS_WRONG));
    expect(screen.getByRole('checkbox', { name: 'The weekly digest' })).not.toBeChecked();
    expect(screen.queryByText(COPY.SETTINGS_EMAILS_OFF)).toBeNull();
  });

  it('says nothing goes out while email isn’t set up', () => {
    render(<EmailPreferences email="anna@example.com" mailConfigured={false} initial={[{ type: 'nudges', on: true }]} />);
    expect(screen.getByText(COPY.SETTINGS_EMAILS_OFF)).toBeVisible();
  });

  it('speaks of reconnect emails only where Google’s access can be lost (task 12’s review)', () => {
    const initial = [{ type: 'nudges' as const, on: true }];
    const { unmount } = render(<EmailPreferences email="anna@example.com" mailConfigured initial={initial} />);
    expect(screen.getByText(COPY.SETTINGS_EMAILS_RECONNECT)).toBeVisible();
    unmount();
    render(<StorageProvider storage="database"><EmailPreferences email="anna@example.com" mailConfigured initial={initial} /></StorageProvider>);
    expect(screen.queryByText(/Reconnect emails/)).toBeNull();
  });
});
