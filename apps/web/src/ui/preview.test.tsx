// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppLink, PreviewProvider } from './preview';

describe('AppLink', () => {
  it('is a link outside a preview', () => {
    render(<AppLink href="/partners" className="x">Partners</AppLink>);
    expect(screen.getByRole('link', { name: 'Partners' })).toHaveAttribute('href', '/partners');
  });

  it('is plain text in a preview: no link, no address, same look', () => {
    const { container } = render(<PreviewProvider pathname="/this-week"><AppLink href="/partners" className="x hover:text-brand">Partners</AppLink></PreviewProvider>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('[href]')).toBeNull();
    expect(screen.getByText('Partners')).toHaveClass('x');
    expect(screen.getByText('Partners')).not.toHaveClass('hover:text-brand');
  });
});
