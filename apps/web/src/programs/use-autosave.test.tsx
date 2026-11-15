// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SaveStatusLine } from './save-status';
import { useAutosave, type SaveOutcome } from './use-autosave';

type Result = SaveOutcome | { ok: false; message: string; final: true };

const handle: { edit: (n: number) => void; flush: () => Promise<SaveOutcome> } = { edit: () => {}, flush: async () => ({ ok: true }) };
const edit = (n: number) => handle.edit(n);

function Harness({ save, reload, readOnly }: { save: (n: number) => Promise<Result>; reload?: () => void; readOnly?: boolean }) {
  const autosave = useAutosave<number, Result>({
    initial: 0,
    readOnly,
    prepare: (n) => (n >= 0 ? { ok: true, value: n } : { ok: false, message: 'Must be 0 or more.' }),
    save,
    stops: (result) => !result.ok && 'final' in result,
  });
  const { update } = autosave;
  useEffect(() => {
    handle.edit = update;
    handle.flush = autosave.flush;
  });
  return <><SaveStatusLine status={autosave.status} retry={() => void autosave.flush()} reload={reload} /><span data-testid="value">{autosave.value}</span></>;
}

const leaveAsks = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('useAutosave', () => {
  it('read only (a company server’s viewer, owner 2026-11-14): a change neither shows nor saves, and leaving asks nothing', async () => {
    const save = vi.fn(async (): Promise<Result> => ({ ok: true }));
    render(<Harness save={save} readOnly />);
    act(() => edit(5));
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
    expect(screen.getByTestId('value')).toHaveTextContent('0');
    await expect(handle.flush()).resolves.toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 900));
    expect(save).not.toHaveBeenCalled();
    expect(leaveAsks()).toBe(false);
  });

  it('saves after the pause and says Saved', async () => {
    const save = vi.fn(async (): Promise<Result> => ({ ok: true }));
    render(<Harness save={save} />);
    act(() => edit(5));
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/), { timeout: 2000 });
    expect(save).toHaveBeenCalledWith(5);
  });

  it('never sends a value with a mistake', async () => {
    const save = vi.fn(async (): Promise<Result> => ({ ok: true }));
    render(<Harness save={save} />);
    act(() => edit(-1));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not saved: Must be 0 or more.'), { timeout: 2000 });
    expect(save).not.toHaveBeenCalled();
    expect(leaveAsks()).toBe(true);
  });

  it('offers Try again after an ordinary failure', async () => {
    const save = vi.fn(async (): Promise<Result> => ({ ok: false, message: 'No answer.' }));
    render(<Harness save={save} />);
    act(() => edit(5));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument(), { timeout: 2000 });
    expect(leaveAsks()).toBe(true);
  });

  it('flushes after the save in flight returns, then sends what is still unsaved, and resolves once it is saved', async () => {
    const releases: Array<() => void> = [];
    const save = vi.fn((): Promise<Result> => new Promise((resolve) => releases.push(() => resolve({ ok: true }))));
    render(<Harness save={save} />);
    act(() => edit(5));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    act(() => edit(6));
    let flushed: SaveOutcome | null = null;
    void act(() => handle.flush()).then((outcome) => { flushed = outcome; });
    await new Promise((r) => setTimeout(r, 20));
    expect(save).toHaveBeenCalledTimes(1);
    act(() => releases[0]!());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(6);
    expect(flushed).toBeNull();
    act(() => releases[1]!());
    await waitFor(() => expect(flushed).toEqual({ ok: true }));
    expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/);
    await new Promise((r) => setTimeout(r, 1000));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('resolves a flush with why it couldn’t save', async () => {
    const save = vi.fn(async (): Promise<Result> => ({ ok: false, message: 'No answer.' }));
    render(<Harness save={save} />);
    act(() => edit(-1));
    expect(await act(() => handle.flush())).toEqual({ ok: false, message: 'Not saved: Must be 0 or more.' });
    act(() => edit(5));
    expect(await act(() => handle.flush())).toEqual({ ok: false, message: 'No answer.' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('stops for good after a refusal that `stops` names: no more saves, no Try again, Reload instead', async () => {
    const save = vi.fn(async (): Promise<Result> => ({ ok: false, message: 'Changed somewhere else.', final: true }));
    const reload = vi.fn();
    const { unmount } = render(<Harness save={save} reload={reload} />);
    act(() => edit(5));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Changed somewhere else.'), { timeout: 2000 });
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    act(() => screen.getByRole('button', { name: 'Reload' }).click());
    expect(reload).toHaveBeenCalled();

    act(() => edit(6));
    await new Promise((r) => setTimeout(r, 1000));
    expect(screen.getByRole('status')).toHaveTextContent('Changed somewhere else.');
    expect(leaveAsks()).toBe(false);
    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
