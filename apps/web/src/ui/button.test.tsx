// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('is a non-submitting button by default', () => {
    render(<Button>Add</Button>);
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('type', 'button');
  });

  it('calls onClick unless disabled', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    rerender(<Button onClick={onClick} disabled>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses the strong brand green for primary buttons', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-brand-strong');
  });
});
