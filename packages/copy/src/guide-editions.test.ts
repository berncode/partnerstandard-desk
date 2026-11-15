import { describe, expect, it } from 'vitest';
import { GUIDE_DIAGRAMS, GUIDE_INTRO, GUIDE_QUESTIONS, GUIDE_SECTIONS, guideNames, partLines, type GuideSection } from './guide';
import { DATABASE_GUIDE_ANSWERS, DATABASE_GUIDE_LINES, guideFor } from './guide-editions';

const lines = (s: GuideSection) => [s.why, ...s.steps, ...s.appDoes, ...(s.parts ?? []).flatMap(partLines)];
const strongs = (s: string) => [...s.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]!);
const everything = (guide: ReturnType<typeof guideFor>) =>
  [...guide.sections.flatMap((s) => [s.title, ...lines(s), ...s.where.flatMap((w) => w.trail)]), ...guide.questions.flatMap((q) => [q.question, q.answer])];

describe('the guide on each edition (plan 13, task 13)', () => {
  it('hosted, and a test user, get the guide itself, as it is today', () => {
    for (const storage of ['google', 'memory'] as const) {
      expect(guideFor(storage).sections).toBe(GUIDE_SECTIONS);
      expect(guideFor(storage).questions).toBe(GUIDE_QUESTIONS);
    }
  });

  it('a company server’s guide never speaks of Google, Drive, Sheets or the PartnerStandard Desk folder', () => {
    for (const line of everything(guideFor('database'))) {
      expect(line).not.toMatch(/Google|Drive|Sheets|Partner Desk folder|PartnerStandard \/ (?:PartnerStandard )?Desk|PartnerStandard \/ Partner Desk|sheet by hand/);
      expect(line).not.toMatch(/—/);
    }
  });

  it('replaces only lines the hosted guide has: a changed hosted line fails here until its company server line follows', () => {
    const hosted = new Set(GUIDE_SECTIONS.flatMap(lines));
    for (const line of DATABASE_GUIDE_LINES.keys()) expect(hosted.has(line), line).toBe(true);
    for (const [question, { hosted: answer }] of DATABASE_GUIDE_ANSWERS) {
      expect(GUIDE_QUESTIONS.find((q) => q.question === question)?.answer, question).toBe(answer);
    }
  });

  it('keeps every section and its order, and leaves out only the two questions about sheets and Google', () => {
    const guide = guideFor('database');
    expect(guide.sections.map((s) => s.id)).toEqual(GUIDE_SECTIONS.map((s) => s.id));
    expect(GUIDE_QUESTIONS.filter((q) => !guide.questions.some((d) => d.question === q.question)).map((q) => q.question))
      .toEqual(['What happens if I edit a sheet by hand?', 'Why doesn’t Delete account sign me out of Google?']);
  });

  it('covers the intro and the pictures too: none of them names Google today', () => {
    expect([GUIDE_INTRO, ...Object.values(GUIDE_DIAGRAMS).flatMap((d) => [d.alt, ...Object.values(d.labels)])].join(' ')).not.toMatch(/Google|Drive|Sheets/);
  });

  it('names only what the app shows on a company server', () => {
    const names = guideNames('database');
    for (const line of everything(guideFor('database'))) for (const n of strongs(line)) expect(names.has(n), n).toBe(true);
  });

  it('says on a company server that the MAP emails and the Monday summary don’t go to viewers; hosted, with no viewers, stays as it is (owner, 2026-11-14)', () => {
    const mapLines = (storage: 'google' | 'database') => guideFor(storage).sections.find((s) => s.id === 'onboarding')!.appDoes;
    const db = mapLines('database');
    expect(db.find((l) => l.includes('changes the MAP through their link'))).toMatch(/Viewers don’t get this email\.$/);
    expect(db.find((l) => l.startsWith('Each Monday'))).toContain('Viewers don’t get it.');
    for (const line of mapLines('google')) expect(line).not.toMatch(/[Vv]iewer/);
    // Every line of the company server's guide keeps to the guide's length, as the hosted guide's do.
    for (const line of guideFor('database').sections.flatMap(lines)) expect(line.length, line.slice(0, 40)).toBeLessThanOrEqual(400);
  });
});
