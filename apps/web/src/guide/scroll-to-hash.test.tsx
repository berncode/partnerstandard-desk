// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrollToHash } from './scroll-to-hash';

describe('ScrollToHash', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('scrolls to the section the address names, once it is on the page', () => {
    window.history.replaceState(null, '', '/guide#reviews');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<><h2 id="reviews">Reviews</h2><ScrollToHash /></>);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toHaveProperty('id', 'reviews');
  });

  it('does nothing without a section in the address', () => {
    window.history.replaceState(null, '', '/guide');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<><h2 id="reviews">Reviews</h2><ScrollToHash /></>);
    expect(scroll).not.toHaveBeenCalled();
  });
});
