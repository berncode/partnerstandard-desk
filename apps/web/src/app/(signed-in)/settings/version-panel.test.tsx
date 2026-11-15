// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VersionPanel } from './version-panel';

afterEach(cleanup);

describe('VersionPanel', () => {
  it('a newer release: the notice with its version, what is new and how to update', () => {
    render(<VersionPanel status={{ current: '1.4.2', update: { version: '1.5.0', url: 'https://github.com/o/r/releases/tag/v1.5.0' }, repo: 'o/r' }} howToUpdate="https://x/docs#updating" />);
    expect(screen.getByText('This server runs PartnerStandard Desk 1.4.2.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Update available: 1.5.0.');
    expect(screen.getByRole('link', { name: 'What’s new' }).getAttribute('href')).toBe('https://github.com/o/r/releases/tag/v1.5.0');
    expect(screen.getByRole('link', { name: 'How to update' }).getAttribute('href')).toBe('https://x/docs#updating');
  });

  it('up to date: only the version', () => {
    render(<VersionPanel status={{ current: '1.4.2', update: null, repo: 'o/r' }} howToUpdate="https://x" />);
    expect(screen.getByText('This server runs PartnerStandard Desk 1.4.2.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
