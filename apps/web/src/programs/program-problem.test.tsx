// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

const { ProgramProblem } = await import('./program-problem');

describe('ProgramProblem', () => {
  it.each(['file_not_found', 'not_found', 'invalid'])('a program that isn’t there (%s) says so, with Go to Programs', (error) => {
    render(<ProgramProblem failure={{ error, message: 'Please fix the highlighted fields' }} next="/programs/x/why" storage="memory" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.PROGRAM_NOT_FOUND);
    expect(screen.queryByText('Please fix the highlighted fields')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.PROG_GO_TO_PROGRAMS })).toHaveAttribute('href', '/programs');
  });

  it('a sheet that can’t be read gives the store’s sentence', () => {
    render(<ProgramProblem failure={{ error: 'structure', message: 'The Reasons tab is missing.' }} next="/programs/x/why" storage="memory" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.PROG_PROBLEM_STRUCTURE);
    expect(screen.getByText('The Reasons tab is missing.')).toBeInTheDocument();
  });

  it('Company facts that can’t be read are named as such', () => {
    render(<ProgramProblem facts failure={{ error: 'file_not_found', message: 'gone' }} next="/programs/x/why" storage="memory" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.FACTS_PROBLEM_GONE);
    expect(screen.getByRole('link', { name: COPY.PROG_GO_TO_FACTS })).toHaveAttribute('href', '/company-facts');
  });
});
