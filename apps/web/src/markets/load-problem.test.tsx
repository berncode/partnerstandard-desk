// @vitest-environment jsdom
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

import { LoadProblem } from './load-problem';

const gone = { error: 'file_not_found', message: COPY.FILE_GONE };

describe('LoadProblem', () => {
  it('names the partners file when it is gone, and points to Partners, where a new one can be started', () => {
    render(<LoadProblem failure={gone} partnersFile next="/markets" storage="google" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your partners file is missing. On Partners you can restore it or start a new one.');
    expect(alert).not.toHaveTextContent(COPY.FILE_GONE);
    expect(screen.getByRole('link', { name: 'Go to Partners' })).toHaveAttribute('href', '/partners');
  });

  it('points to Partners, where a new file can be started, when the partners file is from an earlier version', () => {
    render(<LoadProblem failure={{ error: 'old_version', message: SHEET_COPY.ISSUES.OLD_VERSION }} partnersFile next="/markets" storage="google" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(COPY.PARTNERS_FILE_OLD_LINE);
    expect(screen.getByRole('link', { name: 'Go to Partners' })).toHaveAttribute('href', '/partners');
  });

  it('says the message as it is for any other file, and for any other problem with the partners file', () => {
    const { unmount } = render(<LoadProblem failure={gone} next="/markets" storage="google" />);
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.FILE_GONE);
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    render(<LoadProblem failure={{ error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE }} partnersFile next="/markets" storage="google" />);
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.UNAVAILABLE_MESSAGE);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('offers Reconnect Google for an expired sign-in', () => {
    render(<LoadProblem failure={{ error: 'auth', message: COPY.AUTH_MESSAGE }} partnersFile next="/markets/new" storage="google" />);
    expect(screen.getByRole('button', { name: 'Reconnect Google' })).toBeInTheDocument();
  });
});
