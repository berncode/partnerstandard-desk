// @vitest-environment jsdom
import { CALL_GUIDE, TOPICS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CallGuidePage from './page';

describe('the call guide page', () => {
  it('shows the six topics in order, each with what to learn, questions and a note prompt', () => {
    render(<CallGuidePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Discovery call guide' })).toBeVisible();
    expect(screen.getByText(COPY.APP_NAME, { selector: 'p' })).toBeVisible();
    expect(screen.getByText(/Paste it into the call on the partner’s page/)).toBeVisible();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(TOPICS.map((topic, i) => `${i + 1}.${CALL_GUIDE[topic].title}`));
    const first = CALL_GUIDE[TOPICS[0]];
    expect(screen.getByText(first.learn)).toBeVisible();
    for (const question of first.questions) expect(screen.getByText(question)).toBeVisible();
    expect(screen.getAllByText(COPY.CALL_GUIDE_NOTES)).toHaveLength(6);
  });

  it('prints from the Print button, which is hidden on paper', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<CallGuidePage />);
    const button = screen.getByRole('button', { name: 'Print' });
    expect(button).toHaveClass('print:hidden');
    await userEvent.setup().click(button);
    expect(print).toHaveBeenCalledTimes(1);
  });
});
