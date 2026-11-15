// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuideText } from './guide-text';

describe('GuideText', () => {
  it('renders a marked name in a strong and the rest as text', () => {
    const { container } = render(<p><GuideText text="Press **Mark signed**." /></p>);
    expect(screen.getByText('Mark signed').tagName).toBe('STRONG');
    expect(container.textContent).toBe('Press Mark signed.');
  });

  it('renders several marked names', () => {
    render(<p><GuideText text="**One** and **Two**" /></p>);
    expect(screen.getAllByText(/One|Two/).map((e) => e.tagName)).toEqual(['STRONG', 'STRONG']);
  });

  it('renders a text with no marker as it is', () => {
    const { container } = render(<p><GuideText text="Nothing to mark." /></p>);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe('Nothing to mark.');
  });
});
