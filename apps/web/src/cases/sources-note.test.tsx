// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourcesNote, sourcesLines } from './sources-note';

const none = { factsChangedAt: null, programChangedAt: null, partnerTypeGone: false };

describe('SourcesNote', () => {
  it('says when Company facts and the program changed after the case was filled', async () => {
    const load = vi.fn(async () => ({ ok: true as const, ...none, factsChangedAt: '2026-10-31T09:00:00.000Z', programChangedAt: '2026-11-02T10:00:00.000Z' }));
    render(<SourcesNote caseId="case_1" load={load} />);
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Company facts changed on 31 Oct 2026, after this case was filled. Its program changed on 2 Nov 2026, after this case was filled. The case keeps its numbers until you update it.',
    );
    expect(load).toHaveBeenCalledWith({ caseId: 'case_1' });
  });

  it('says nothing when nothing changed, or when the read fails', async () => {
    const quiet = vi.fn(async () => ({ ok: true as const, ...none }));
    const { unmount } = render(<SourcesNote caseId="case_1" load={quiet} />);
    await vi.waitFor(() => expect(quiet).toHaveBeenCalled());
    expect(screen.queryByRole('note')).toBeNull();
    unmount();

    const refused = vi.fn(async () => ({ ok: false as const, error: 'unavailable' as const, message: COPY.UNAVAILABLE_MESSAGE }));
    const { unmount: gone } = render(<SourcesNote caseId="case_1" load={refused} />);
    await vi.waitFor(() => expect(refused).toHaveBeenCalled());
    expect(screen.queryByRole('note')).toBeNull();
    gone();

    const thrown = vi.fn(async () => { throw new Error('offline'); });
    render(<SourcesNote caseId="case_1" load={thrown} />);
    await vi.waitFor(() => expect(thrown).toHaveBeenCalled());
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('names only what changed', () => {
    expect(sourcesLines({ factsChangedAt: null, programChangedAt: '2026-11-02' })).toEqual([
      COPY.CASE_PROGRAM_CHANGED('2 Nov 2026'), COPY.CASE_CHANGED_KEEPS,
    ]);
    expect(sourcesLines(none)).toEqual([]);
  });
});
