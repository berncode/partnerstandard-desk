// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COMMUNITY_EDITION_LIVE, COMMUNITY_EDITION_URL, CommunityEdition } from './community-edition';

describe('the Community Edition on hosted’s landing page (owner, 2026-11-14)', () => {
  it('is shown, now the repository is public', () => {
    expect(COMMUNITY_EDITION_LIVE).toBe(true);
    render(<CommunityEdition />);
    expect(screen.getByRole('region', { name: COPY.COMMUNITY_TITLE })).toBeInTheDocument();
  });

  it('shows nothing when switched off', () => {
    const { container } = render(<CommunityEdition live={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('its heading, text, three points, the license line and the link to the repository', () => {
    render(<CommunityEdition live />);
    const section = screen.getByRole('region', { name: COPY.COMMUNITY_TITLE });
    expect(section).toHaveTextContent(COPY.COMMUNITY_TEXT);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([...COPY.COMMUNITY_POINTS]);
    expect(section).toHaveTextContent(COPY.COMMUNITY_LICENSE);
    expect(screen.getByRole('link', { name: COPY.COMMUNITY_LINK })).toHaveAttribute('href', COMMUNITY_EDITION_URL);
    expect(COMMUNITY_EDITION_URL).toBe('https://github.com/berncode/partnerstandard-desk');
  });
});
