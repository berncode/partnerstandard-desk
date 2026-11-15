// @vitest-environment jsdom
import { GUIDE_DIAGRAMS, GUIDE_DIAGRAM_IDS, GUIDE_SECTION_IDS } from '@partner-desk/copy';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Diagram } from './index';
import { JOURNEY_LINKS } from './journey';

describe('the guide diagrams', () => {
  // The journey's boxes are links, and an img's children are presentational, so the journey is a labeled group instead.
  it.each(GUIDE_DIAGRAM_IDS.filter((id) => id !== 'journey'))('%s is an image with its text alternative', (id) => {
    render(<Diagram id={id} />);
    expect(screen.getByRole('img', { name: GUIDE_DIAGRAMS[id].alt })).toBeInTheDocument();
  });

  it('the journey is a group with its text alternative, and its links are in the accessibility tree', () => {
    render(<Diagram id="journey" />);
    const group = screen.getByRole('group', { name: GUIDE_DIAGRAMS.journey.alt });
    const links = within(group).getAllByRole('link');
    expect(links).toHaveLength(Object.keys(JOURNEY_LINKS).length);
    for (const a of links) expect(a).toHaveAccessibleName();
  });

  it('links every box of the journey to a section that exists', () => {
    render(<Diagram id="journey" />);
    const hrefs = [...document.querySelectorAll('svg a')].map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBe(Object.keys(JOURNEY_LINKS).length);
    for (const h of hrefs) expect(GUIDE_SECTION_IDS).toContain(h!.slice(1));
  });

  it('gives each journey link a name a screen reader can say', () => {
    render(<Diagram id="journey" />);
    const links = [...document.querySelectorAll('svg a')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute('aria-label')?.trim()).toBeTruthy();
  });

  it.each(GUIDE_DIAGRAM_IDS)('%s draws with theme colors only', (id) => {
    const { container } = render(<Diagram id={id} />);
    expect(container.innerHTML).not.toMatch(/(fill|stroke|color)="#|rgb\(/);
  });

  it.each(GUIDE_DIAGRAM_IDS)('%s uses only words from its labels', (id) => {
    const { container } = render(<Diagram id={id} />);
    const labels = new Set(Object.values(GUIDE_DIAGRAMS[id].labels));
    const drawn = [...container.querySelectorAll('text')].map((t) => t.textContent!.trim()).filter(Boolean);
    expect(drawn.length).toBeGreaterThan(0);
    for (const t of drawn) expect([...labels].some((l) => l === t || l.startsWith(`${t} `) || l.endsWith(` ${t}`))).toBe(true);
  });
});
