// The checks that need no domain. The starters' categories and sides, and the sample plan, are checked against the
// domain in core (maps/content.test.ts).
import { describe, expect, it } from 'vitest';
import { MAP_LEARN_MORE } from '../links';
import { PARTNER_TYPES } from '../partner-types';
import { STAGES } from '../stages';
import { EXAMPLE_EXIT_TRIGGERS, MOMENTUM_NEXT_STEPS, exampleObjectives, horizonMilestones, suggestedMilestones } from './examples';
import { GUIDED_STEPS } from './guided-steps';
import { buildSampleRecord, buildSamplePlan } from './sample-plan';
import { reviewActivities, starterActivities, typeStarters } from './starters';

describe('recruitment suggestions', () => {
  it('are the onboarding plan agreed before signing: a short recruitment set, then the onboarding starters', () => {
    const titles = starterActivities('reseller', 'recruitment').map((s) => s.title);
    expect(titles.slice(0, 6)).toEqual([
      'Agree on seller activation targets',
      'Agree on the training plan',
      'Plan the launch marketing',
      'Name the partner’s sales and marketing leads',
      'Discuss exit triggers and what we do not want',
      'Sign the partnership agreement',
    ]);
    for (const onboarding of starterActivities('reseller', 'onboarding').slice(0, -2)) expect(titles).toContain(onboarding.title);
  });
});

describe('review suggestions', () => {
  it('are the business review at the end of a horizon, looking ahead to the next one', () => {
    expect(reviewActivities().map((s) => s.title)).toEqual([
      'Prepare the business review',
      'Review results against both sides’ objectives',
      'Collect partner feedback on the program',
      'Agree on adjustments for the next horizon',
    ]);
    for (const s of reviewActivities()) {
      expect(['us', 'partner', 'joint']).toContain(s.side);
      expect(s.title).not.toMatch(/quarter|\d+ days/i);
    }
  });
});

describe('content for every partner type', () => {
  it('gives every type its own non-empty starters and objectives, on top of the stage starters', () => {
    for (const type of PARTNER_TYPES) {
      const extras = typeStarters(type);
      expect(extras.length, type).toBe(2);
      for (const stage of STAGES) expect(starterActivities(type, stage).slice(-2), `${type}/${stage}`).toEqual(extras);
      const { us, partner } = exampleObjectives(type);
      expect(us.length, type).toBe(2);
      expect(partner.length, type).toBe(2);
      for (const text of [...us, ...partner, ...extras.map((s) => s.title)]) {
        expect(text.trim().length, type).toBeGreaterThan(0);
        expect(text, type).not.toContain("'");
      }
    }
  });

  it('carries the old types’ content over to the new ids', () => {
    expect(starterActivities('system-integrator', 'growth').map((s) => s.title)).toContain('Certify the partner’s delivery team');
    expect(exampleObjectives('system-integrator').us).toContain('Partner delivers three implementations to our quality standard');
    expect(starterActivities('reseller', 'growth').map((s) => s.title)).toContain('Agree on pricing and margin structure');
    expect(starterActivities('technology', 'growth').map((s) => s.title)).toContain('Scope and build the integration');
    expect(exampleObjectives('other').us).toContain('Agree on one measurable shared goal');
  });

  it('shares the two-tier set between distributors and value added distributors', () => {
    expect(starterActivities('vad', 'growth')).toEqual(starterActivities('distributor', 'growth'));
    expect(exampleObjectives('vad')).toEqual(exampleObjectives('distributor'));
  });
});

describe('examples', () => {
  it('has at least two example objectives per side for every partner type', () => {
    for (const type of PARTNER_TYPES) {
      const examples = exampleObjectives(type);
      expect(examples.us.length).toBeGreaterThanOrEqual(2);
      expect(examples.partner.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('suggests day 30, 60 and 90 check-ins, day 1 being the start date, so day 90 is the horizon’s last day', () => {
    expect(suggestedMilestones('2026-10-01').map((m) => m.targetDate)).toEqual(['2026-10-30', '2026-11-29', '2026-12-29']);
  });

  it('suggests check-ins every 30 days and a business review at the end of each horizon length', () => {
    const names = (horizonDays: number) => horizonMilestones({ startDate: '2026-10-20', horizonDays, horizon: 2 }).map((m) => [m.name, m.day]);
    expect(names(30)).toEqual([['Horizon 2: Business review', 30]]);
    expect(names(60)).toEqual([['Horizon 2: Day 30 check-in', 30], ['Horizon 2: Business review', 60]]);
    expect(names(90)).toEqual([['Horizon 2: Day 30 check-in', 30], ['Horizon 2: Day 60 check-in', 60], ['Horizon 2: Business review', 90]]);
    expect(names(120).map(([, day]) => day)).toEqual([30, 60, 90, 120]);
    expect(names(180).map(([, day]) => day)).toEqual([30, 60, 90, 120, 180]);
    expect(names(180).at(-1)).toEqual(['Horizon 2: Business review', 180]);
  });

  it('dates each horizon milestone from the horizon’s start and says what it checks', () => {
    expect(horizonMilestones({ startDate: '2026-10-20', horizonDays: 60, horizon: 3 })).toEqual([
      { name: 'Horizon 3: Day 30 check-in', criteria: 'Progress reviewed with both sides', day: 30, targetDate: '2026-11-18' },
      // The horizon's last day, the end date the header shows (start + 60 − 1).
      { name: 'Horizon 3: Business review', criteria: 'Results reviewed against both sides’ objectives', day: 60, targetDate: '2026-12-18' },
    ]);
  });

  it('has exit trigger examples and momentum next steps', () => {
    expect(EXAMPLE_EXIT_TRIGGERS.length).toBeGreaterThanOrEqual(3);
    expect(MOMENTUM_NEXT_STEPS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('guided steps and links', () => {
  it('follows the four MAP components after the partner step', () => {
    expect(GUIDED_STEPS.map((s) => s.key)).toEqual(['partner', 'objectives', 'people', 'activities', 'milestones']);
  });

  it('asks about activities without naming a horizon length', () => {
    expect(GUIDED_STEPS.find((s) => s.key === 'activities')?.title).toBe('What will each side do during this horizon?');
    for (const step of GUIDED_STEPS) expect(step.title).not.toMatch(/90 days/);
  });

  it('points every learn-more link at the PartnerStandard hub', () => {
    for (const url of [...Object.values(MAP_LEARN_MORE), ...GUIDED_STEPS.map((s) => s.learnMore)]) {
      expect(url).toMatch(/^https:\/\/pro\.partnerstandard\.com\//);
    }
  });
});

describe('sample partner', () => {
  it('is Brightwave Systems as reseller, signed on the sample plan’s start, in onboarding', () => {
    expect(buildSampleRecord('2026-10-16')).toEqual({
      partnerName: 'Brightwave Systems', partnerType: 'reseller', stage: 'onboarding', signedDate: '2026-09-12', closed: null, closedReason: '',
    });
    expect(buildSamplePlan('2026-10-16').info).toEqual({
      partnerId: 'p_sample', partnerType: 'reseller', horizonDays: 90, laterHorizons: [], nextReviewDate: '2026-12-11',
    });
  });
});
