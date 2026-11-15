// New for PartnerStandard Desk (reviews spec 4.1): a "needs you" reason in plain words. The health reasons reuse the MAP's own
// sentences (COPY.MAP_REASON_*); the read model carries no activity or milestone names, so an overdue activity is
// named when Activities due lists it and is "An activity" when it doesn't.
import type { NeedReason } from '@partner-desk/core';
import { COPY, MAP_HEALTH_LABELS } from '@partner-desk/copy';

export function describeNeed(reason: NeedReason, titles: ReadonlyMap<string, string>): string {
  switch (reason.kind) {
    case 'health': {
      const r = reason.reason;
      if (r.kind === 'stalled') return COPY.MAP_REASON_STALLED(r.days);
      if (r.kind === 'overdue') {
        const title = titles.get(r.activityId);
        return title ? COPY.MAP_REASON_OVERDUE(title, r.days) : COPY.WEEK_REASON_OVERDUE_ANY(r.days);
      }
      if (r.kind === 'milestone_missed') return COPY.WEEK_REASON_MISSED;
      // An exit trigger arrives as its own kind below; this keeps the switch whole.
      return r.status === 'triggered' ? COPY.MAP_REASON_TRIGGERED(COPY.MAP_AN_EXIT_TRIGGER) : COPY.MAP_REASON_WATCH(COPY.MAP_AN_EXIT_TRIGGER);
    }
    case 'exitTrigger': {
      const condition = reason.condition || COPY.MAP_AN_EXIT_TRIGGER;
      return reason.status === 'triggered' ? COPY.MAP_REASON_TRIGGERED(condition) : COPY.MAP_REASON_WATCH(condition);
    }
    case 'healthChanged':
      return COPY.WEEK_REASON_CHANGED(MAP_HEALTH_LABELS[reason.from], MAP_HEALTH_LABELS[reason.to]);
  }
}
