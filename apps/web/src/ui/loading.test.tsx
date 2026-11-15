// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlockLoading, DetailLoading, ListLoading } from './loading';

describe('loading screens', () => {
  it('say "Loading…" to screen readers and hide their shapes', () => {
    const { container } = render(<DetailLoading />);
    const status = screen.getByRole('status', { name: COPY.LOADING });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.loading-bar')).not.toBeNull();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    for (const shape of container.querySelectorAll('.skeleton')) expect(shape).toHaveAttribute('aria-hidden');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('keep the page heading a list page already has', () => {
    render(<ListLoading title={<h1>Partners</h1>} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Partners' });
    // Outside the busy region, so screen readers read it while the list loads.
    expect(heading.closest('[aria-busy]')).toBeNull();
  });

  it('take a label that names what is loading', () => {
    render(<BlockLoading label={COPY.MAP_LOADING} />);
    expect(screen.getByRole('status', { name: COPY.MAP_LOADING })).toBeInTheDocument();
  });
});
