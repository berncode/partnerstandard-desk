// @vitest-environment jsdom
import type { PartnerBook, PartnerChange } from '@partner-desk/core';
import { person, sampleBook } from '@partner-desk/core/test-builders';
import type { Snapshot } from '@partner-desk/storage';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { partnersAdapter } from './adapters';
import type { EditorRemote, RemoteResult } from './remote';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { useEditor } from './use-editor';

const book = (why = ''): Snapshot<PartnerBook> => ({
  value: sampleBook({
    partners: [{ ...sampleBook().partners[0]!, id: 'p_1', whyItFits: why }],
    people: [person({ id: 'e_1', accountId: 'a_abc123' })],
    calls: [], qualifications: [], marketLinks: [],
  }),
  issues: [{ tab: 'People', row: 4, message: 'Email must be an email address or empty' }],
});

function setup(initial = book()) {
  const sent: Array<{ change: PartnerChange; resolve: (r: RemoteResult<PartnerBook>) => void }> = [];
  const remote: EditorRemote<PartnerBook, PartnerChange> = {
    apply: (change) => new Promise((resolve) => { sent.push({ change, resolve }); }),
  };
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const hook = renderHook(({ snapshot }) => useEditor(snapshot, { adapter: partnersAdapter, remote, notify, actor: 'Anna' }), {
    initialProps: { snapshot: initial },
  });
  return { ...hook, sent, notify };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('useEditor', () => {
  it('shows the value with a change on top at once, and the file’s unreadable rows', () => {
    const { result } = setup();
    expect(result.current.saving).toBe('idle');
    expect(result.current.issues).toHaveLength(1);
    act(() => { result.current.dispatch({ kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'They know the buyers' } }); });
    expect(result.current.value.partners[0]).toMatchObject({ whyItFits: 'They know the buyers', updatedBy: 'Anna' });
    expect(result.current.saving).toBe('saving');
    expect(result.current.readOnly).toBe(false);
  });

  it('takes a fresh snapshot from the server (after Refresh) as the saved value', () => {
    const { result, rerender } = setup();
    rerender({ snapshot: book('They know the buyers') });
    expect(result.current.value.partners[0]!.whyItFits).toBe('They know the buyers');
  });

  it('warns before the page is left while a change is saving', async () => {
    const { result, sent } = setup();
    act(() => { result.current.dispatch({ kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'They know the buyers' } }); });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      sent[0]!.resolve({ ok: true, snapshot: book('Acme AG'), entityId: 'p_1' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.saving).toBe('saved');
    const later = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it('sends a held-back delete when the page goes away', async () => {
    const { result, unmount, sent } = setup();
    act(() => { result.current.dispatch({ kind: 'delete', entity: 'person', id: 'e_1' }); });
    unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(sent.map((s) => s.change)).toEqual([{ kind: 'delete', entity: 'person', id: 'e_1' }]);
  });

  it('refreshes the page from the conflict toast, and maps a new row’s local id once saved', async () => {
    const { result, sent, notify } = setup();
    let localId = '';
    act(() => {
      const added = result.current.dispatch({ kind: 'add', entity: 'person', values: { accountId: 'a_abc123', name: 'Lea' } });
      localId = added.ok ? added.entityId! : '';
    });
    expect(result.current.idFor(localId)).toBe(localId);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      sent[0]!.resolve({ ok: true, snapshot: book(), entityId: 'e_srv' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.idFor(localId)).toBe('e_srv');
    act(() => { result.current.dispatch({ kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'x' } }); });
    await act(async () => {
      await Promise.resolve();
      sent[1]!.resolve({ ok: false, error: 'conflict', message: 'Updated elsewhere since you opened it' });
      await new Promise((r) => setTimeout(r, 0));
    });
    (notify.info.mock.calls[0]![1] as { onClick: () => void }).onClick();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
