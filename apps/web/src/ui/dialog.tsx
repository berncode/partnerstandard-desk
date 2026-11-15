'use client';

import { COPY } from '@partner-desk/copy';
import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

/** A centered modal with a title (its accessible name), an optional description and a close button. */
export function DialogContent({ title, description, className, children, ...props }: ComponentProps<typeof RadixDialog.Content> & { title: string; description?: string }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
      <RadixDialog.Content
        className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 text-ink shadow-xl', className)}
        {...props}
      >
        <RadixDialog.Title className="pr-8 text-base font-semibold">{title}</RadixDialog.Title>
        <RadixDialog.Description className={description ? 'mt-1 text-sm text-ink-2' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
        {children}
        <RadixDialog.Close aria-label={COPY.CLOSE} className="absolute right-3 top-3 rounded-lg p-1 text-ink-3 hover:bg-surface-2">
          <X className="h-4 w-4" aria-hidden />
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
