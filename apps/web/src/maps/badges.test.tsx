// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthBadge, mapHealthLabel, NotSignedBadge } from './badges';

describe('HealthBadge', () => {
  it.each([['on_track', 'On track'], ['at_risk', 'At risk'], ['off_track', 'Off track']] as const)('says %s as "%s"', (health, label) => {
    render(<HealthBadge health={health} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('says "Nothing planned yet" for an empty MAP, in the neutral style "Not signed" has, never green (owner, 2026-10-31)', () => {
    const { unmount } = render(<NotSignedBadge />);
    const neutral = screen.getByText('Not signed').className.split(' ').sort();
    unmount();
    render(<HealthBadge health="empty" />);
    const badge = screen.getByText('Nothing planned yet');
    expect(badge.className.split(' ').sort()).toEqual(neutral);
    expect(badge.className).not.toMatch(/brand/);
    expect(mapHealthLabel('empty')).toBe('Nothing planned yet');
    expect(mapHealthLabel('on_track')).toBe('On track');
  });
});
