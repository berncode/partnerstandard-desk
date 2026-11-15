// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agents-actions', () => ({
  createApiKey: vi.fn(), turnOffApiKey: vi.fn(), turnOffAgent: vi.fn(), addWebhook: vi.fn(), webhookDeliveries: vi.fn(), sendWebhookTest: vi.fn(),
  turnWebhookOff: vi.fn(), turnWebhookOn: vi.fn(), removeWebhook: vi.fn(), sendWebhookAgain: vi.fn(),
}));

const { AgentsPanel, AgentsUnavailable } = await import('./agents-panel');
const { StorageProvider } = await import('@/storage-context');
const actions = await import('./agents-actions');

const base = {
  connectorUrl: 'https://desk.example.com/mcp', personName: 'Anna', timeZone: 'Europe/Berlin', agents: [], keys: [], webhooks: [],
  proposalsWaiting: {}, makerKeys: { apps: {}, keys: {} },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const HOOK = 'https://hooks.example.com/in';
type Delivery = { id: string; at: string; type: string; status: number | null };
const hook = (status: 'active' | 'off' | 'off_failing', deliveries: Delivery[]) => ({
  id: 'wh_1', url: HOOK, events: ['partner.signed' as const], status, createdAt: '2026-11-01T09:00:00.000Z', deliveries,
});
/** Four deliveries, newest first: failed (500), no answer, arrived (200), waiting. */
const FOUR: Delivery[] = [
  { id: 'evt_4', at: '2026-11-01T12:00:00.000Z', type: 'partner.signed', status: 500 },
  { id: 'evt_3', at: '2026-11-01T11:00:00.000Z', type: 'webhook.test', status: 0 },
  { id: 'evt_2', at: '2026-11-01T10:00:00.000Z', type: 'partner.signed', status: 200 },
  { id: 'evt_1', at: '2026-11-01T09:00:00.000Z', type: 'partner.signed', status: null },
];

describe('AgentsPanel', () => {
  it('empty lists show their empty lines', () => {
    render(<AgentsPanel {...base} />);
    expect(screen.getByText(COPY.AGENTS_NONE)).toBeTruthy();
    expect(screen.getByText(COPY.API_KEYS_NONE)).toBeTruthy();
    expect(screen.getByText(COPY.WEBHOOKS_NONE)).toBeTruthy();
    // The connector address, to copy, with its one line.
    expect(screen.getByText('https://desk.example.com/mcp')).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.AGENTS_COPY_ADDRESS })).toBeTruthy();
    expect(screen.getByText(COPY.AGENTS_CONNECT_HINT)).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.API_KEY_CREATE })).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.WEBHOOK_ADD })).toBeTruthy();
  });

  it('when the lists couldn’t be read, the card says so in one line and lists nothing', () => {
    render(<AgentsUnavailable />);
    expect(screen.getByRole('status').textContent).toBe(COPY.AGENTS_LOAD_FAILED);
    expect(screen.queryByText(COPY.WEBHOOKS_NONE)).toBeNull();
  });

  it('a webhook turned off for failures says so', () => {
    render(<AgentsPanel {...base} webhooks={[{
      id: 'wh_1', url: 'https://hooks.example.com/in', events: ['partner.signed'], status: 'off_failing', createdAt: '2026-11-01T09:00:00.000Z',
      deliveries: [{ id: 'evt_1', at: '2026-11-01T09:00:00.000Z', type: 'partner.signed', status: 500 }],
    }]} />);
    const row = screen.getByRole('listitem', { name: 'https://hooks.example.com/in' });
    expect(within(row).getByText('Turned off after 3 days of failed deliveries')).toBeTruthy();
    // It can be turned on again, and its last delivery shows time, event and answer code.
    expect(within(row).getByRole('button', { name: COPY.TURN_ON_NAMED('https://hooks.example.com/in') })).toBeTruthy();
    expect(within(row).getByText('1 Nov, 10:00')).toBeTruthy();
    expect(within(row).getAllByText('partner.signed').length).toBeGreaterThan(0);
    expect(within(row).getByText('500')).toBeTruthy();
  });

  it('lists agents and keys with their level and dates, never a whole key', () => {
    render(<AgentsPanel {...base}
      agents={[{ clientId: 'c_claude', appName: 'Claude', level: 'change', allowedAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null }]}
      keys={[{ id: 'ak_1', name: 'n8n', level: 'read', prefix: 'pd_abcde', createdAt: '2026-11-01T09:00:00.000Z', lastUsedAt: '2026-11-02T08:00:00.000Z' }]} />);
    const agent = screen.getByRole('listitem', { name: 'Claude' });
    expect(agent.textContent).toContain(COPY.AGENT_LEVEL_CHANGE);
    expect(agent.textContent).toContain('Allowed 1 Nov 2026');
    expect(agent.textContent).toContain(COPY.AGENTS_NOT_USED);
    expect(within(agent).getByRole('button', { name: COPY.TURN_OFF_NAMED('Claude') })).toBeTruthy();
    const key = screen.getByRole('listitem', { name: 'n8n' });
    expect(key.textContent).toContain('pd_abcde…');
    expect(key.textContent).toContain(COPY.AGENT_LEVEL_READ);
    expect(key.textContent).toContain('Last used 2 Nov 2026');
  });

  it('Settings shows "2 proposals waiting" on Claude’s row and none on a key without any', () => {
    render(<AgentsPanel {...base}
      agents={[
        { clientId: 'c_claude', appName: 'Claude', level: 'propose', allowedAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null },
        { clientId: 'c_cursor', appName: 'Cursor', level: 'change', allowedAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null },
      ]}
      keys={[
        { id: 'ak_1', name: 'n8n', level: 'propose', prefix: 'pd_abcde', createdAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null },
        { id: 'ak_2', name: 'Make', level: 'propose', prefix: 'pd_fghij', createdAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null },
      ]}
      proposalsWaiting={{ 'app:Claude': 2, 'key:ak_2': 1 }}
      makerKeys={{ apps: { c_claude: 'app:Claude', c_cursor: 'app:Cursor' }, keys: { ak_1: 'key:ak_1', ak_2: 'key:ak_2' } }} />);
    const claude = screen.getByRole('listitem', { name: 'Claude' });
    expect(claude.textContent).toContain(COPY.AGENT_LEVEL_PROPOSE);
    expect(claude.textContent).toContain('2 proposals waiting');
    expect(screen.getByRole('listitem', { name: 'Cursor' }).textContent).not.toContain('waiting');
    const n8n = screen.getByRole('listitem', { name: 'n8n' });
    expect(n8n.textContent).toContain('Read, change and propose');
    expect(n8n.textContent).not.toContain('waiting');
    expect(screen.getByRole('listitem', { name: 'Make' }).textContent).toContain('1 proposal waiting');
  });

  it('Create key offers three levels and makes a propose key', async () => {
    vi.mocked(actions.createApiKey).mockResolvedValue({
      ok: true, key: 'pd_secretkey', keys: [{ id: 'ak_1', name: 'Claude', level: 'propose', prefix: 'pd_secre', createdAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null }],
    });
    const user = userEvent.setup();
    render(<AgentsPanel {...base} />);
    await user.click(screen.getByRole('button', { name: COPY.API_KEY_CREATE }));
    const dialog = screen.getByRole('dialog', { name: COPY.API_KEY_CREATE });
    expect(within(dialog).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['read', 'change', 'propose']);
    // Read only first, and picked: proposing is never the default.
    expect(within(dialog).getByRole('radio', { name: /^Read only/ })).toBeChecked();
    expect(within(dialog).getByText(COPY.AGENT_LEVEL_PROPOSE_TEXT)).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: COPY.API_KEY_NAME }), 'Claude');
    await user.click(within(dialog).getByRole('radio', { name: /^Read, change and propose/ }));
    await user.click(within(dialog).getByRole('button', { name: COPY.API_KEY_CREATE }));
    await screen.findByRole('dialog', { name: COPY.API_KEY_MADE_TITLE });
    expect(actions.createApiKey).toHaveBeenCalledWith('Claude', 'propose');
    await user.click(screen.getByRole('button', { name: COPY.DONE }));
    expect(screen.getByRole('listitem', { name: 'Claude' }).textContent).toContain(COPY.AGENT_LEVEL_PROPOSE);
  });

  it('without an https address, says connectors need one instead of showing an address', () => {
    render(<AgentsPanel {...base} connectorUrl={null} />);
    expect(screen.getByText(COPY.AGENTS_CONNECT_NEEDS_HTTPS)).toBeTruthy();
    expect(screen.queryByRole('button', { name: COPY.AGENTS_COPY_ADDRESS })).toBeNull();
  });

  it('the key name field takes at most 40 characters, as the server does', async () => {
    render(<AgentsPanel {...base} />);
    await userEvent.click(screen.getByRole('button', { name: COPY.API_KEY_CREATE }));
    const dialog = screen.getByRole('dialog', { name: COPY.API_KEY_CREATE });
    expect(within(dialog).getByRole('textbox', { name: COPY.API_KEY_NAME }).getAttribute('maxlength')).toBe('40');
  });

  it('a new key, shown once, stays until Done: Escape and a click outside don’t close it', async () => {
    vi.mocked(actions.createApiKey).mockResolvedValue({
      ok: true, key: 'pd_secretkey', keys: [{ id: 'ak_1', name: 'n8n', level: 'read', prefix: 'pd_secre', createdAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null }],
    });
    // The open dialog makes the page under it inert (pointer-events: none); the click outside goes there all the same.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AgentsPanel {...base} />);
    await user.click(screen.getByRole('button', { name: COPY.API_KEY_CREATE }));
    await user.type(screen.getByRole('textbox', { name: COPY.API_KEY_NAME }), 'n8n');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: COPY.API_KEY_CREATE }));
    const made = await screen.findByRole('dialog', { name: COPY.API_KEY_MADE_TITLE });
    expect(within(made).getByDisplayValue('pd_secretkey')).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(document.body);
    expect(screen.getByRole('dialog', { name: COPY.API_KEY_MADE_TITLE })).toBeTruthy();
    await user.click(within(made).getByRole('button', { name: COPY.DONE }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a new webhook’s secret, shown once, stays until Done or the close button', async () => {
    vi.mocked(actions.addWebhook).mockResolvedValue({
      ok: true, secret: 'whsec_shownonce',
      webhook: { id: 'wh_1', url: 'https://hooks.example.com/in', events: ['partner.signed'], status: 'active', createdAt: '2026-11-01T09:00:00.000Z', deliveries: [] },
    });
    // The open dialog makes the page under it inert (pointer-events: none); the click outside goes there all the same.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AgentsPanel {...base} />);
    await user.click(screen.getByRole('button', { name: COPY.WEBHOOK_ADD }));
    await user.type(screen.getByRole('textbox', { name: COPY.WEBHOOK_URL_LABEL }), 'https://hooks.example.com/in');
    await user.click(screen.getByRole('checkbox', { name: new RegExp(COPY.WEBHOOK_EVENT_TEXT['partner.signed']) }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: COPY.WEBHOOK_ADD }));
    const made = await screen.findByRole('dialog', { name: COPY.WEBHOOK_MADE_TITLE });
    expect(within(made).getByDisplayValue('whsec_shownonce')).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(document.body);
    expect(screen.getByRole('dialog', { name: COPY.WEBHOOK_MADE_TITLE })).toBeTruthy();
    await user.click(within(made).getByRole('button', { name: COPY.CLOSE }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows Send again on a failed delivery of a webhook that is on, and not on one that arrived, waits, or belongs to a webhook that is off', () => {
    const { unmount } = render(<AgentsPanel {...base} webhooks={[hook('active', FOUR)]} />);
    const row = screen.getByRole('listitem', { name: HOOK });
    const again = within(row).getAllByRole('button', { name: /^Send again/ });
    expect(again.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Send again: partner.signed of 1 Nov, 13:00', 'Send again: webhook.test of 1 Nov, 12:00',
    ]);
    // The name starts with the words on the button (WCAG 2.5.3, label in name): "Send again" said aloud finds it.
    for (const button of again) {
      expect(button.textContent).toBe(COPY.WEBHOOK_SEND_AGAIN);
      expect(button.getAttribute('aria-label')?.startsWith(COPY.WEBHOOK_SEND_AGAIN)).toBe(true);
    }
    // Its answer still shows beside it.
    expect(within(row).getByText('500')).toBeTruthy();
    unmount();
    for (const status of ['off', 'off_failing'] as const) {
      const off = render(<AgentsPanel {...base} webhooks={[hook(status, FOUR)]} />);
      expect(within(screen.getByRole('listitem', { name: HOOK })).queryAllByRole('button', { name: /^Send again/ })).toEqual([]);
      off.unmount();
    }
  });

  it('Send again shows "Sent again." and the delivery waits again', async () => {
    let answer!: (value: Awaited<ReturnType<typeof actions.sendWebhookAgain>>) => void;
    vi.mocked(actions.sendWebhookAgain).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    vi.mocked(actions.webhookDeliveries).mockResolvedValue({ ok: true, deliveries: [{ ...FOUR[0]!, status: 200 }, ...FOUR.slice(1)] });
    const user = userEvent.setup();
    render(<AgentsPanel {...base} webhooks={[hook('active', FOUR)]} />);
    const row = screen.getByRole('listitem', { name: HOOK });
    await user.click(within(row).getByRole('button', { name: COPY.WEBHOOK_SEND_AGAIN_NAMED('partner.signed', '1 Nov, 13:00') }));
    expect(actions.sendWebhookAgain).toHaveBeenCalledWith('wh_1', 'evt_4');
    // While it runs, the webhook's buttons wait.
    await waitFor(() => expect(within(row).getByRole('button', { name: COPY.WEBHOOK_SEND_TEST_NAMED(HOOK) }).hasAttribute('disabled')).toBe(true));
    for (const button of within(row).getAllByRole('button', { name: /^Send again/ })) expect(button.hasAttribute('disabled')).toBe(true);
    expect(within(row).getByRole('button', { name: COPY.TURN_OFF_NAMED(HOOK) }).hasAttribute('disabled')).toBe(true);
    answer({ ok: true, deliveries: [{ ...FOUR[0]!, status: null }, ...FOUR.slice(1)] });
    expect((await within(row).findByRole('status')).textContent).toBe(COPY.WEBHOOK_SENT_AGAIN);
    const first = within(row).getAllByRole('row')[1]!;
    expect(first.textContent).toContain(COPY.WEBHOOK_ANSWER_WAITING);
    expect(within(first).queryByRole('button')).toBeNull();
    // The buttons come back once the answer is in: the status and the end of the wait are two renders, so wait for it.
    await waitFor(() => expect(within(row).getByRole('button', { name: COPY.WEBHOOK_SEND_TEST_NAMED(HOOK) }).hasAttribute('disabled')).toBe(false));
    // The deliveries are read again until each has an answer: here the one sent again arrives.
    await waitFor(() => expect(actions.webhookDeliveries).toHaveBeenCalledWith('wh_1'), { timeout: 4_000 });
    await waitFor(() => expect(within(row).getAllByRole('row')[1]!.textContent).toContain('200'));
  });

  it('Send again refused shows the reason', async () => {
    vi.mocked(actions.sendWebhookAgain).mockResolvedValue({ ok: false, message: COPY.WEBHOOK_SEND_AGAIN_BUSY });
    const user = userEvent.setup();
    render(<AgentsPanel {...base} webhooks={[hook('active', FOUR)]} />);
    const row = screen.getByRole('listitem', { name: HOOK });
    await user.click(within(row).getByRole('button', { name: COPY.WEBHOOK_SEND_AGAIN_NAMED('webhook.test', '1 Nov, 12:00') }));
    expect((await within(row).findByRole('alert')).textContent).toBe(COPY.WEBHOOK_SEND_AGAIN_BUSY);
  });

  it('Turn on says what waited was dropped', async () => {
    vi.mocked(actions.turnWebhookOn).mockResolvedValue({ ok: true, webhook: hook('active', []), deliveries: [FOUR[2]!] });
    const user = userEvent.setup();
    render(<AgentsPanel {...base} webhooks={[hook('off', [FOUR[2]!, FOUR[3]!])]} />);
    const row = screen.getByRole('listitem', { name: HOOK });
    await user.click(within(row).getByRole('button', { name: COPY.TURN_ON_NAMED(HOOK) }));
    expect((await within(row).findByRole('status')).textContent).toBe(COPY.WEBHOOK_TURNED_ON);
    expect(within(row).getByRole('button', { name: COPY.TURN_OFF_NAMED(HOOK) })).toBeTruthy();
    // The one that waited is gone from Last deliveries.
    expect(within(row).getAllByRole('row')).toHaveLength(2);
    expect(within(row).queryByText(COPY.WEBHOOK_ANSWER_WAITING)).toBeNull();
  });
});

describe('AgentsPanel for a company server’s viewer (owner, 2026-11-14)', () => {
  const panel = (viewer: boolean) => (
    <StorageProvider storage="database" viewer={viewer}>
      <AgentsPanel {...base} {...(viewer ? { keyLevels: ['read' as const] } : {})}
        webhooks={[hook('active', FOUR), { ...hook('off', [FOUR[0]!]), id: 'wh_2', url: `${HOOK}/2` }]} />
    </StorageProvider>
  );

  it('shows a viewer no Add webhook, Send test, Turn on or Send again; Turn off and Delete stay, for webhooks they made before', () => {
    render(panel(true));
    expect(screen.queryByRole('button', { name: COPY.WEBHOOK_ADD })).toBeNull();
    const on = screen.getByRole('listitem', { name: HOOK });
    expect(within(on).queryByRole('button', { name: COPY.WEBHOOK_SEND_TEST_NAMED(HOOK) })).toBeNull();
    expect(within(on).queryByRole('button', { name: /^Send again/ })).toBeNull();
    expect(within(on).getByRole('button', { name: COPY.TURN_OFF_NAMED(HOOK) })).toBeTruthy();
    expect(within(on).getByRole('button', { name: COPY.WEBHOOK_DELETE_NAMED(HOOK) })).toBeTruthy();
    const off = screen.getByRole('listitem', { name: `${HOOK}/2` });
    expect(within(off).queryByRole('button', { name: COPY.TURN_ON_NAMED(`${HOOK}/2`) })).toBeNull();
    expect(within(off).getByRole('button', { name: COPY.WEBHOOK_DELETE_NAMED(`${HOOK}/2`) })).toBeTruthy();
  });

  it('still lets a viewer create a Read only key, and offers no other level', async () => {
    const user = userEvent.setup();
    render(panel(true));
    await user.click(screen.getByRole('button', { name: COPY.API_KEY_CREATE }));
    const dialog = screen.getByRole('dialog', { name: COPY.API_KEY_CREATE });
    expect(within(dialog).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['read']);
  });

  it('shows an admin or a partner manager every webhook button', () => {
    render(panel(false));
    expect(screen.getByRole('button', { name: COPY.WEBHOOK_ADD })).toBeTruthy();
    const on = screen.getByRole('listitem', { name: HOOK });
    expect(within(on).getByRole('button', { name: COPY.WEBHOOK_SEND_TEST_NAMED(HOOK) })).toBeTruthy();
    expect(within(on).getAllByRole('button', { name: /^Send again/ }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('listitem', { name: `${HOOK}/2` })).getByRole('button', { name: COPY.TURN_ON_NAMED(`${HOOK}/2`) })).toBeTruthy();
  });
});
