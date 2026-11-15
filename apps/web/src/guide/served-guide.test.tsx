// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ storage: 'google' as 'google' | 'database' }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@partner-desk/platform/env', () => ({ serverEnv: () => ({}), editionFlags: () => ({ storage: env.storage }), onVercel: () => false }));

const { ServedGuide } = await import('./served-guide');

const answerTo = (question: string) => screen.getByRole('heading', { level: 3, name: question }).nextElementSibling;

describe('the guide as served (plan 13, task 13)', () => {
  it('is hosted’s guide on hosted', async () => {
    env.storage = 'google';
    render(<>{await ServedGuide()}</>);
    expect(answerTo('Where are my files?')).toHaveTextContent('In your Google Drive');
  });

  it('is a company server’s guide on a company server', async () => {
    env.storage = 'database';
    const { container } = render(<>{await ServedGuide()}</>);
    expect(answerTo('Where are my files?')).toHaveTextContent('In your company’s own database');
    expect(container.textContent).not.toMatch(/Google|Drive/);
  });
});
