// @vitest-environment jsdom
import { TERM_NOTES } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { termNoteText, TermNotes } from './term-notes';

const levels = { registered: 'Member', preferred: 'Gold' };

describe('TermNotes', () => {
  it('says each note in plain words, with the program’s name for its higher level', () => {
    render(<TermNotes notes={['flat-fee', 'bars', 'pref-req']} levels={levels} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      COPY.CASE_NOTE_FLAT_FEE, COPY.CASE_NOTE_BARS('Gold'), COPY.CASE_NOTE_PREF_REQ('Gold'),
    ]);
    expect(screen.getByText(/^The program asks more of a Gold partner/)).toBeInTheDocument();
  });

  it('has the spec’s words for a partner type with no program, and a text for every note', () => {
    expect(termNoteText('no-program', levels)).toBe('No program for this partner type yet. Add one, or fill in the terms here.');
    for (const note of TERM_NOTES) {
      const text = termNoteText(note, levels);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/—|\bcandidate\b|\bCAC\b|\bARR\b|\bMDF\b/);
    }
  });

  it('shows nothing without notes', () => {
    const { container } = render(<TermNotes notes={[]} levels={levels} />);
    expect(container).toBeEmptyDOMElement();
  });
});
