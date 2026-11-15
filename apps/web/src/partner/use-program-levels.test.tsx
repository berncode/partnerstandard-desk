// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProgramLevels } from '@/programs/links';
import { useProgramLevels } from './use-program-levels';

const MEMBER: ProgramLevels = { status: 'ready', reg: 'Member', pref: 'Gold', prefOn: true };

describe('useProgramLevels', () => {
  it('uses the levels read with the page, and reads a program the page didn’t have once', async () => {
    const read = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, MEMBER])));
    const initial = { pg_a: MEMBER };
    const { result, rerender } = renderHook(({ ids }) => useProgramLevels(initial, ids, read), { initialProps: { ids: ['pg_a'] } });
    expect(result.current('pg_a')).toEqual(MEMBER);
    expect(read).not.toHaveBeenCalled();

    rerender({ ids: ['pg_a', 'pg_b'] });
    expect(result.current('pg_b')).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current('pg_b')).toEqual(MEMBER));
    rerender({ ids: ['pg_b'] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(['pg_b']);
  });

  it('says so when the read fails', async () => {
    const read = vi.fn(async () => { throw new Error('offline'); });
    const initial = {};
    const { result } = renderHook(() => useProgramLevels(initial, ['pg_a'], read));
    await waitFor(() => expect(result.current('pg_a')).toEqual({ status: 'failed', message: COPY.SAVE_OFFLINE }));
  });
});
