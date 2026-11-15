// New for PartnerStandard Desk (landing sample week): a made-up company's week, as This week shows it. Pure: every date
// is counted from `today`, so the sample is never out of date. The names and titles are made up.
import type { WeekProposal } from '@partner-desk/commands';
import { addDays, type Activity, type IsoDate, type ThisWeek } from '@partner-desk/core';
import { STEP_LABELS } from '@partner-desk/method';

export const SAMPLE_COMPANY = 'Brookvale Software';
export const SAMPLE_ACCOUNT = 'Ruth Lindqvist';

const BRIGHTWATER = 'Brightwater IT as reseller';
const TALLIS = 'Tallis Cloud as technology partner';
const ORRIN = 'Orrin Systems as referral partner';

function activity(id: string, title: string, dueDate: IsoDate): Activity {
  return {
    id, title, category: 'sales', side: 'us', ownerId: null, dueDate, status: 'not_started', completedDate: null,
    milestoneId: null, note: '', updatedAt: null, updatedBy: null,
  };
}

/** Midday on a date, as an instant: the proposal's times. */
const noonOn = (date: IsoDate) => `${date}T12:00:00.000Z`;

/** Brookvale Software's week, with `today` as the visitor's today: a line or more in every card, and one proposal. */
export function sampleWeek(today: IsoDate): ThisWeek & { proposals: WeekProposal[] } {
  const webinar = activity('a_sample01', 'Plan the joint webinar', addDays(today, -2));
  const priceList = activity('a_sample02', 'Send the price list', addDays(today, 3));
  const testPlan = activity('a_sample03', 'Agree the integration test plan', addDays(today, -5));
  return {
    proposals: [{
      head: {
        id: 'prp_sample1', kind: 'stage', status: 'waiting', createdAt: noonOn(addDays(today, -1)), answeredAt: null,
        expiresAt: noonOn(addDays(today, 27)), agentName: 'Desk Agent', makerOn: true,
      },
      target: { accountId: 'acc_ashgrove', partnerId: 'p_ashgrove', marketId: null, hypothesisId: null },
      about: 'Ashgrove Data',
      reason: 'They booked a first call for next week.',
      rows: [{ itemId: 'r_sample1', what: 'Step', now: STEP_LABELS.researched, proposed: STEP_LABELS.discovery_call, evidence: '', status: 'waiting' }],
      state: 'waiting', cannot: null, answeredLine: null, targetUpdatedAt: null, partnerType: 'data', oneClick: true,
    }],
    reviews: [
      { mapId: 'map_brightwater', displayName: BRIGHTWATER, date: addDays(today, 4), daysLeft: 4, daysLate: null, prep: true, summaryUnsent: false, heldReviewId: null },
      { mapId: 'map_tallis', displayName: TALLIS, date: addDays(today, -2), daysLeft: null, daysLate: 2, prep: false, summaryUnsent: false, heldReviewId: null },
    ],
    needYou: [
      { mapId: 'map_orrin', displayName: ORRIN, reasons: [{ kind: 'health', health: 'at_risk', reason: { kind: 'stalled', days: 21 } }] },
      { mapId: 'map_tallis', displayName: TALLIS, reasons: [{ kind: 'health', health: 'at_risk', reason: { kind: 'overdue', activityId: testPlan.id, days: 5 } }] },
    ],
    due: [
      { mapId: 'map_brightwater', displayName: BRIGHTWATER, activities: [{ activity: webinar, overdueDays: 2 }, { activity: priceList, overdueDays: 0 }] },
      { mapId: 'map_tallis', displayName: TALLIS, activities: [{ activity: testPlan, overdueDays: 5 }] },
    ],
    waiting: [
      { partnerId: 'p_fennick', accountId: 'acc_fennick', name: 'Fennick Consulting', partnerType: 'referral', reason: 'mapNotAgreed', days: null },
    ],
  };
}
