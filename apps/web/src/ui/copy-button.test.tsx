// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './copy-button';

describe('CopyButton', () => {
  it('copies the text and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyButton text="https://example.test/approve">Copy approval link</CopyButton>);
    await user.click(screen.getByRole('button', { name: 'Copy approval link' }));
    expect(writeText).toHaveBeenCalledWith('https://example.test/approve');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('tells the caller when the clipboard is blocked, so it can show the text instead', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('blocked'); }) }, configurable: true });
    const onCopyFailed = vi.fn();
    render(<CopyButton text="prompt" onCopyFailed={onCopyFailed}>Copy search prompt</CopyButton>);
    await user.click(screen.getByRole('button', { name: 'Copy search prompt' }));
    expect(onCopyFailed).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Copy search prompt' })).toBeInTheDocument();
  });
});
