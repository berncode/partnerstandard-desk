// @vitest-environment jsdom
// Delete for a MAP, a case or a program: a company server's viewer can't delete any of them, so they see no button
// (owner, 2026-11-14). Everyone else gets it, asking first.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StorageProvider } from '@/storage-context';
import { DeleteDialog } from './delete-dialog';

const dialog = (remove = vi.fn()) => (
  <DeleteDialog action="Delete MAP" title="Delete Acme as reseller?" text="It goes to the trash." remove={remove} onDeleted={vi.fn()} />
);

describe('Delete, for a company server’s viewer', () => {
  it('shows a viewer no Delete button', () => {
    render(<StorageProvider storage="database" viewer>{dialog()}</StorageProvider>);
    expect(screen.queryByRole('button', { name: 'Delete MAP' })).toBeNull();
  });

  it('shows an admin or a partner manager Delete, asking first, and hosted with no provider too', async () => {
    for (const tree of [<StorageProvider key="db" storage="database">{dialog()}</StorageProvider>, dialog()]) {
      const view = render(tree);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Delete MAP' }));
      expect(screen.getByRole('dialog', { name: 'Delete Acme as reseller?' })).toBeVisible();
      view.unmount();
    }
  });
});
