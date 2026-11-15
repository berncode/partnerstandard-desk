// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

const { FactsProblem } = await import('./facts-problem');

describe('FactsProblem', () => {
  it('names a sheet with a problem and says what to fix, with a way back', () => {
    render(<FactsProblem failure={{ error: 'structure', message: 'The "Company facts" tab is missing.' }} next="/company-facts" storage="google" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.FACTS_PROBLEM_STRUCTURE);
    expect(screen.getByText('The "Company facts" tab is missing.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.GO_TO_PARTNERS })).toHaveAttribute('href', '/partners');
    expect(screen.queryByRole('button', { name: COPY.RECONNECT_BUTTON })).not.toBeInTheDocument();
  });

  it('offers Reconnect Google when Google needs permission again', () => {
    render(<FactsProblem failure={{ error: 'auth', message: COPY.AUTH_MESSAGE }} next="/company-facts" storage="google" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.PROBLEM_AUTH);
    expect(screen.getByRole('button', { name: COPY.RECONNECT_BUTTON })).toBeInTheDocument();
  });

  it('says the file can’t be reached when it is gone', () => {
    render(<FactsProblem failure={{ error: 'file_not_found', message: COPY.FILE_GONE }} next="/company-facts" storage="google" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.FACTS_PROBLEM_GONE);
  });
});
