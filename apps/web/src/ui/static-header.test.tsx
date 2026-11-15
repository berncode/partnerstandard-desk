// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticHeader } from './static-header';

afterEach(() => { vi.unstubAllEnvs(); });

describe('StaticHeader', () => {
  it('shows the PartnerStandard logo and the Desk badge on PartnerStandard’s own build', () => {
    render(<StaticHeader />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getAllByRole('img', { name: 'PartnerStandard' }).length).toBeGreaterThan(0);
    expect(within(banner).getByText('Desk')).toBeInTheDocument();
  });

  it('shows the Community Edition’s own mark and badge on any other build, never the PartnerStandard logo', () => {
    vi.stubEnv('NEXT_PUBLIC_PD_BRAND', '');
    render(<StaticHeader />);
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByRole('img', { name: 'PartnerStandard' })).not.toBeInTheDocument();
    expect(within(banner).getByRole('img', { name: 'PartnerStandard Desk Community Edition' })).toBeInTheDocument();
    expect(within(banner).getByText('Community')).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: /^PartnerStandard Desk Community Edition/ })).toHaveAttribute('href', '/');
  });
});
