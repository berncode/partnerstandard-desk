// @vitest-environment jsdom
// The summary link's page is a GET a link scanner may open: it only reads (AGENTS.md, "Emails never act on a link visit").
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { heldReviewWithLink } from '@/test/review-summary';

const state = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/server/runtime', () => ({ shareDeps: () => state.deps }));

const { SharedSummary } = await import('./summary-view');

describe('/r/[token]', () => {
  it('a GET of /r/{token} changes nothing', async () => {
    const { deps, share, token, mapId } = await heldReviewWithLink({ includeScorecard: true });
    state.deps = share;
    const fileOf = async () => {
      const read = await deps.maps.read({ fileId: (await deps.directory.map(mapId))!.fileId });
      if (!read.ok) throw new Error('setup');
      return read.snapshot.value;
    };
    const before = {
      plan: await fileOf(), links: structuredClone(deps.reviewLinks.rows), events: deps.events.events.length,
      lastChange: (await deps.directory.map(mapId))!.lastChangeAt,
    };
    const writes = [
      vi.spyOn(deps.maps, 'apply'), vi.spyOn(deps.maps, 'applyMany'), vi.spyOn(deps.maps, 'trash'), vi.spyOn(deps.partnerBooks, 'apply'),
      vi.spyOn(deps.partnerBooks, 'applyMany'), vi.spyOn(deps.reviewLinks, 'create'), vi.spyOn(deps.reviewLinks, 'revokeReview'),
      vi.spyOn(deps.reviewLinks, 'revokeMaps'), vi.spyOn(deps.directory, 'setMapLastChange'), vi.spyOn(deps.events, 'record'),
    ];

    for (let visit = 0; visit < 3; visit += 1) render(await SharedSummary({ params: Promise.resolve({ token }) }));

    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(await fileOf()).toEqual(before.plan);
    expect(deps.reviewLinks.rows).toEqual(before.links);
    expect(deps.events.events).toHaveLength(before.events);
    expect((await deps.directory.map(mapId))!.lastChangeAt).toBe(before.lastChange);
  });

  it('has no server action and calls no command that writes or sends', () => {
    const files = readdirSync(__dirname).filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'));
    expect(files.sort()).toEqual(['not-found.tsx', 'page.tsx', 'summary-view.tsx']);
    for (const name of files) {
      const source = readFileSync(join(__dirname, name), 'utf8');
      expect(source, name).not.toMatch(/'use server'|\b(shareSummary|revokeSummary|mailReviewSummary|sendReviewSummary|changeMap|closeReview)\(/);
    }
  });
});
