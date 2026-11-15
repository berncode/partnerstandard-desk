// @vitest-environment jsdom
// The case page holds the share state itself (no page reload after an action), so nothing here checks for a reload.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StorageProvider } from '@/storage-context';
import { ShareControls, type ShareActions } from './share-controls';

const URL_A = 'https://pbs.example/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const URL_B = 'https://pbs.example/s/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
let ids = 0;

function actions(patch: Partial<ShareActions> = {}) {
  return {
    share: vi.fn(async () => ({ ok: true as const, url: URL_A })),
    stop: vi.fn(async () => ({ ok: true as const })),
    ...patch,
  };
}

/** Each test its own case id: the links made in a tab are kept by case id. */
function show(props: { sharedAt?: string | null; acts?: ReturnType<typeof actions> } = {}) {
  const caseId = `case_${(ids += 1)}`;
  const acts = props.acts ?? actions();
  const view = render(<ShareControls caseId={caseId} partner="Northwind" sharedAt={props.sharedAt ?? null} actions={acts} />);
  return { caseId, acts, view };
}

describe('ShareControls', () => {
  it('shares a case at once, then shows the link to copy', async () => {
    const user = userEvent.setup();
    const { caseId, acts, view } = show();
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    expect(acts.share).toHaveBeenCalledWith(caseId);

    // The page gives the case back as shared.
    view.rerender(<ShareControls caseId={caseId} partner="Northwind" sharedAt="2026-10-25T10:00:00.000Z" actions={acts} />);
    expect(screen.getByText('Shared on 25 Oct 2026.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Link for Northwind' })).toHaveValue(URL_A);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByText('Anyone with this link can see the case. Copy it now: it can’t be shown again.')).toBeInTheDocument();
  });

  it('keeps the link just made on screen when the page shows the case again, and only for that case', async () => {
    const user = userEvent.setup();
    const { caseId, acts, view } = show();
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    view.unmount();
    render(<ShareControls caseId={caseId} partner="Northwind" sharedAt="2026-10-25T10:00:00.000Z" actions={acts} />);
    expect(screen.getByRole('textbox', { name: 'Link for Northwind' })).toHaveValue(URL_A);
  });

  it('a case shared earlier shows when, Make a new link and Stop sharing, but no link: only its hash is kept', () => {
    show({ sharedAt: '2026-10-20T10:00:00.000Z' });
    expect(screen.getByText('Shared on 20 Oct 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Link for Northwind' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make a new link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument();
    // The link shows the case as it is now (spec §5): there is no older offer to update to.
    expect(screen.queryByText(/older offer/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
  });

  it('Make a new link asks first, then shows the new link', async () => {
    const user = userEvent.setup();
    const { caseId, acts } = show({ sharedAt: '2026-10-20T10:00:00.000Z', acts: actions({ share: vi.fn(async () => ({ ok: true as const, url: URL_B })) }) });
    await user.click(screen.getByRole('button', { name: 'Make a new link' }));
    const dialog = screen.getByRole('dialog', { name: 'Make a new link?' });
    expect(dialog).toHaveTextContent('The link you sent stops working. Send the new one instead.');
    expect(acts.share).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Make a new link' }));
    expect(acts.share).toHaveBeenCalledWith(caseId);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Link for Northwind' })).toHaveValue(URL_B);
  });

  it('Stop sharing asks first, then forgets the link', async () => {
    const user = userEvent.setup();
    const { caseId, acts, view } = show();
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    view.rerender(<ShareControls caseId={caseId} partner="Northwind" sharedAt="2026-10-25T10:00:00.000Z" actions={acts} />);
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    const dialog = screen.getByRole('dialog', { name: 'Stop sharing with Northwind?' });
    expect(dialog).toHaveTextContent('The link stops working. Sharing again makes a new link.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(acts.stop).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop sharing' }));
    expect(acts.stop).toHaveBeenCalledWith(caseId);
    view.rerender(<ShareControls caseId={caseId} partner="Northwind" sharedAt={null} actions={acts} />);
    expect(screen.getByRole('button', { name: 'Share a link with Northwind' })).toBeInTheDocument();
    view.rerender(<ShareControls caseId={caseId} partner="Northwind" sharedAt="2026-10-25T11:00:00.000Z" actions={acts} />);
    expect(screen.queryByRole('textbox', { name: 'Link for Northwind' })).toBeNull();
  });

  it('shows a refusal in the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    show({ sharedAt: '2026-10-20T10:00:00.000Z', acts: actions({ stop: vi.fn(async () => ({ ok: false as const, message: 'We couldn’t reach your storage. Try again.' })) }) });
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop sharing' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('We couldn’t reach your storage. Try again.');
  });

  it('shows a refusal under the button', async () => {
    const user = userEvent.setup();
    show({ acts: actions({ share: vi.fn(async () => ({ ok: false as const, message: 'We couldn’t make the link. Try again.' })) }) });
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t make the link. Try again.');
  });

  it('shows a thrown error as a message', async () => {
    const user = userEvent.setup();
    show({ acts: actions({ share: vi.fn(async () => { throw new Error('offline'); }) }) });
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});

describe('ShareControls for a company server’s viewer (owner, 2026-11-14)', () => {
  const asViewer = (sharedAt: string | null) => render(
    <StorageProvider storage="database" viewer>
      <ShareControls caseId={`case_${(ids += 1)}`} partner="Northwind" sharedAt={sharedAt} actions={actions()} />
    </StorageProvider>,
  );

  it('shows a viewer nothing to share a case that isn’t shared', () => {
    asViewer(null);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a viewer when a shared case was shared, with no Make a new link and no Stop sharing', () => {
    asViewer('2026-10-25T10:00:00.000Z');
    expect(screen.getByText('Shared on 25 Oct 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an admin or a partner manager every button', () => {
    const view = render(<StorageProvider storage="database"><ShareControls caseId="case_pm1" partner="Northwind" sharedAt={null} actions={actions()} /></StorageProvider>);
    expect(screen.getByRole('button', { name: 'Share a link with Northwind' })).toBeInTheDocument();
    view.unmount();
    render(<StorageProvider storage="database"><ShareControls caseId="case_pm2" partner="Northwind" sharedAt="2026-10-25T10:00:00.000Z" actions={actions()} /></StorageProvider>);
    expect(screen.getByRole('button', { name: 'Make a new link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument();
  });
});
