'use client';

import type { Partner } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Plus } from 'lucide-react';
import { Tabs } from 'radix-ui';
import type { ReactNode } from 'react';
import { Button } from '@/ui/button';

/**
 * One tab per partner type, plus Add partner type. The open tab is that type, and `children` (its work) is the open
 * tab's panel, so each tab names the panel it controls.
 */
export function TypeTabs({ sections, value, onValueChange, onAdd, readOnly, children }: {
  sections: readonly Partner[];
  value: string;
  onValueChange: (partnerType: string) => void;
  onAdd: () => void;
  readOnly: boolean;
  children?: ReactNode;
}) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange} className="grid gap-4">
      <div className="flex items-end gap-2">
        <Tabs.List aria-label={COPY.TYPE_TABS} className="flex min-w-0 flex-1 gap-1 overflow-x-auto border-b border-line">
          {sections.map((section) => (
            <Tabs.Trigger key={section.id} value={section.partnerType}
              className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand data-[state=active]:border-brand data-[state=active]:text-ink">
              {PARTNER_TYPE_LABELS[section.partnerType]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="mb-1 shrink-0" onClick={onAdd}>
            <Plus className="h-4 w-4" aria-hidden />
            {COPY.ADD_PARTNER_TYPE}
          </Button>
        )}
      </div>
      {sections.map((section) => (
        <Tabs.Content key={section.id} value={section.partnerType} className="grid gap-4 outline-none focus-visible:ring-2 focus-visible:ring-brand">
          {section.partnerType === value ? children : null}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
