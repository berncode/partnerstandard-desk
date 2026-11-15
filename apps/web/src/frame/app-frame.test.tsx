// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/partners' }));

import { AppFrame } from './app-frame';

describe('AppFrame', () => {
  it('puts the page in one main area next to the sidebar, with the footer after it', () => {
    render(<AppFrame company="Acme GmbH" user={<span>Anna</span>}><h1>Partners</h1></AppFrame>);
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Partners' }));
    expect(screen.getByRole('complementary')).toHaveTextContent('Acme GmbH');
    expect(screen.getByRole('contentinfo')).toHaveTextContent('© PartnerStandard Desk');
  });
});
