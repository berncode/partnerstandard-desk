'use client';

import { ACTIVITY_STATUSES, type ActivityStatus } from '@partner-desk/core';
import { COPY, MAP_ACTIVITY_STATUS_LABELS } from '@partner-desk/copy';
import { ChevronDown, Circle, CircleCheck, CircleDot, CircleMinus, OctagonAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/ui/cn';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/ui/menu';
import { STATUS_STYLE } from '../badges';
import { nextStatus } from '../view-model';

export const STATUS_ICON: Record<ActivityStatus, LucideIcon> = {
  not_started: Circle,
  in_progress: CircleDot,
  blocked: OctagonAlert,
  done: CircleCheck,
  na: CircleMinus,
};

/** One click moves to the next common status; the chevron offers all of them. */
export function StatusControl({ status, disabled, onChange }: {
  status: ActivityStatus; disabled?: boolean; onChange: (status: ActivityStatus) => void;
}) {
  const next = nextStatus(status);
  const Icon = STATUS_ICON[status];
  const label = MAP_ACTIVITY_STATUS_LABELS;
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(next)}
        aria-label={disabled ? COPY.MAP_STATUS_IS(label[status]) : COPY.MAP_STATUS_CHANGE(label[status], label[next])}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 border pr-2.5 pl-2 text-xs font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-default',
          disabled ? 'rounded-full' : 'rounded-l-full',
          STATUS_STYLE[status],
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">{label[status]}</span>
      </button>
      {!disabled && (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" aria-label={COPY.MAP_ALL_STATUSES}
              className={cn('inline-flex h-7 items-center rounded-r-full border border-l-0 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', STATUS_STYLE[status])}>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent>
            {ACTIVITY_STATUSES.map((s) => {
              const ItemIcon = STATUS_ICON[s];
              return (
                <MenuItem key={s} onSelect={() => { if (s !== status) onChange(s); }}>
                  <ItemIcon className="h-4 w-4" aria-hidden />
                  {label[s]}
                </MenuItem>
              );
            })}
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}
