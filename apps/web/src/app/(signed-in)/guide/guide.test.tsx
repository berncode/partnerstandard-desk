// @vitest-environment jsdom
import { COPY, GUIDE_INTRO, GUIDE_QUESTIONS, GUIDE_SECTIONS, GUIDE_DIAGRAMS } from '@partner-desk/copy';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom renders no async server component: the served sections are hosted's, as a hosted server sends them. A company
// server's are tested below, through the same body.
const served = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/guide/served-guide', async () => {
  const { GuideBody } = await import('@/guide/guide-body');
  const { guideFor } = await import('@partner-desk/copy');
  return { ServedGuide: () => { served.calls += 1; return <GuideBody guide={guideFor('google')} />; } };
});

const { default: GuidePage, metadata } = await import('./page');
const { GuideBody } = await import('@/guide/guide-body');
const { guideFor } = await import('@partner-desk/copy');

describe('the guide page', () => {
  it('has the title as the only h1, the intro and the app name', () => {
    render(<GuidePage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: COPY.GUIDE_TITLE })).toBeVisible();
    expect(metadata.title).toBe(COPY.GUIDE_TITLE);
    expect(screen.getByText(COPY.APP_NAME, { selector: 'p' })).toBeVisible();
    expect(screen.getByText(GUIDE_INTRO)).toBeVisible();
  });

  it('has one h2 per section, in order, each with its id and room under the header', () => {
    render(<GuidePage />);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.map((h) => h.id)).toEqual(GUIDE_SECTIONS.map((s) => s.id));
    expect(h2s.map((h) => h.textContent)).toEqual(GUIDE_SECTIONS.map((s) => s.title));
    for (const h of h2s) expect(h).toHaveClass('scroll-mt-20');
  });

  it('lists the contents with one link per section', () => {
    render(<GuidePage />);
    const nav = screen.getByRole('navigation', { name: COPY.GUIDE_CONTENTS });
    expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual(
      GUIDE_SECTIONS.map((s) => [s.title, `#${s.id}`]),
    );
    expect(nav).toHaveClass('print:hidden');
    expect(screen.queryByRole('heading', { name: COPY.GUIDE_CONTENTS })).toBeNull();
  });

  it('puts the journey before the contents, and each section’s diagram in its section', () => {
    render(<GuidePage />);
    const journey = screen.getByRole('group', { name: GUIDE_DIAGRAMS.journey.alt });
    const nav = screen.getByRole('navigation', { name: COPY.GUIDE_CONTENTS });
    expect(journey.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A section's own picture, and the pictures of its parts (Agents and the API), each in its section.
    const pictures = GUIDE_SECTIONS.flatMap((x) => [x.diagram, ...(x.parts ?? []).map((p) => p.diagram)].flatMap((d) => (d ? [{ id: x.id, d }] : [])));
    for (const { id, d } of pictures) {
      const section = document.getElementById(id)!.closest('section')!;
      expect(within(section).getByRole('img', { name: GUIDE_DIAGRAMS[d].alt })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('img')).toHaveLength(pictures.length);
    expect(screen.getAllByText(COPY.GUIDE_SCROLL_HINT_PICTURE)).toHaveLength(2);
    expect(screen.getByText(COPY.GUIDE_SCROLL_HINT)).toBeInTheDocument();
  });

  it('shows a section’s Where line with its first part linking to the page', () => {
    render(<GuidePage />);
    const section = document.getElementById('set-up')!.closest('section')!;
    const where = GUIDE_SECTIONS.find((s) => s.id === 'set-up')!.where;
    expect(within(section).getByText(COPY.GUIDE_WHERE)).toBeVisible();
    const link = within(section).getAllByRole('link', { name: where[0]!.trail[0] })[0]!;
    expect(link).toHaveAttribute('href', where[0]!.page);
  });

  it('shows the steps as a numbered list, the app’s part, the hub link, and names in bold', () => {
    render(<GuidePage />);
    const markets = GUIDE_SECTIONS.find((s) => s.id === 'markets')!;
    const section = document.getElementById('markets')!.closest('section')!;
    expect(within(section).getByText(COPY.GUIDE_STEPS)).toBeVisible();
    expect(within(section).getAllByRole('listitem').length).toBeGreaterThanOrEqual(markets.steps.length);
    expect(section.querySelector('ol')!.children).toHaveLength(markets.steps.length);
    expect(within(section).getByText(COPY.GUIDE_APP_DOES)).toBeVisible();
    expect(within(section).getByRole('link', { name: COPY.GUIDE_HUB })).toHaveAttribute('href', markets.hub);
    expect(section.querySelector('strong')).not.toBeNull();
    expect(document.body.textContent).not.toContain('**');
  });

  it('shows the questions as question and answer pairs', () => {
    render(<GuidePage />);
    const section = document.getElementById('questions')!.closest('section')!;
    for (const q of GUIDE_QUESTIONS) {
      expect(within(section).getByRole('heading', { level: 3, name: q.question })).toBeVisible();
    }
    expect(section.querySelector('ol')).toBeNull();
  });

  it('prints from the Print button, which is hidden on paper', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<GuidePage />);
    const button = screen.getByRole('button', { name: COPY.PRINT });
    expect(button).toHaveClass('print:hidden');
    await userEvent.setup().click(button);
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('the guide on a company server (plan 13, task 13)', () => {
  it('keeps every section, and never says Google, Drive or the PartnerStandard Desk folder', () => {
    const { container } = render(<GuideBody guide={guideFor('database')} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.id)).toEqual(GUIDE_SECTIONS.map((s) => s.id));
    expect(container.textContent).not.toMatch(/Google|Drive|Partner Desk folder|PartnerStandard \/ (?:PartnerStandard )?Desk|PartnerStandard \/ Partner Desk/);
    expect(screen.getByRole('heading', { level: 3, name: 'Where are my files?' }).nextElementSibling).toHaveTextContent('In your company’s own database');
  });
});

describe('the guide in a Vercel build (task 13’s review)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('holds the hosted guide as the page is built, never waiting for the served one', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    served.calls = 0;
    render(<GuidePage />);
    expect(served.calls).toBe(0);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.id)).toEqual(GUIDE_SECTIONS.map((s) => s.id));
    expect(screen.getByRole('heading', { level: 3, name: 'Where are my files?' }).nextElementSibling).toHaveTextContent('In your Google Drive');
  });
});

