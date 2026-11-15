import type { ActivitySide, ActivityStatus, MapHealth, MilestoneStatus } from '@partner-desk/core';
import { COPY, MAP_ACTIVITY_STATUS_LABELS, MAP_HEALTH_LABELS } from '@partner-desk/copy';
import { cn } from '@/ui/cn';
import { sideName, type SideNames } from './format';

const HEALTH_STYLE: Record<MapHealth, string> = {
  on_track: 'bg-brand-soft text-brand-strong',
  at_risk: 'bg-warn-soft text-warn',
  off_track: 'bg-danger-soft text-danger',
  // Neutral, as "Not signed": an empty MAP has no health (owner, 2026-10-31).
  empty: 'bg-surface-2 text-ink-2',
};

/** A MAP's health in words: "Nothing planned yet" for an empty MAP, which has no health (owner, 2026-10-31). */
export const mapHealthLabel = (health: MapHealth): string => (health === 'empty' ? COPY.MAP_NOTHING_PLANNED : MAP_HEALTH_LABELS[health]);

export function HealthBadge({ health, className }: { health: MapHealth; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', HEALTH_STYLE[health], className)}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {mapHealthLabel(health)}
    </span>
  );
}

/** In place of the health badge once a recruitment ended without signing: there is nothing left to track. */
export function NotSignedBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-ink-2', className)}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {COPY.MAP_NOT_SIGNED}
    </span>
  );
}

const SIDE_STYLE: Record<ActivitySide, string> = {
  us: 'bg-brand-soft text-brand-strong',
  partner: 'bg-partner-soft text-partner',
  joint: 'bg-joint-soft text-joint',
};

export function SideBadge({ side, names, className }: { side: ActivitySide; names: SideNames; className?: string }) {
  const label = sideName(side, names);
  return (
    <span title={label} className={cn('inline-block max-w-40 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold', SIDE_STYLE[side], className)}>
      {label}
    </span>
  );
}

export function SideDot({ side }: { side: ActivitySide }) {
  return <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', side === 'us' ? 'bg-brand' : side === 'partner' ? 'bg-partner' : 'bg-joint')} />;
}

const MILESTONE_STYLE: Record<MilestoneStatus, string> = { achieved: 'text-brand-strong', missed: 'text-danger', upcoming: 'text-ink-3' };

export function MilestoneStatusTag({ status }: { status: MilestoneStatus }) {
  return <span className={cn('text-xs font-medium', MILESTONE_STYLE[status])}>{COPY.MAP_MILESTONE_STATUS[status]}</span>;
}

export const STATUS_STYLE: Record<ActivityStatus, string> = {
  not_started: 'border-line bg-surface text-ink-2',
  in_progress: 'border-info/30 bg-info-soft text-info',
  blocked: 'border-danger/30 bg-danger-soft text-danger',
  done: 'border-brand/30 bg-brand-soft text-brand-strong',
  na: 'border-dashed border-line bg-surface text-ink-3',
};

export function StatusTag({ status }: { status: ActivityStatus }) {
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLE[status])}>
      {MAP_ACTIVITY_STATUS_LABELS[status]}
    </span>
  );
}
