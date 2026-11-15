'use client';

import { Check } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ className, sideOffset = 6, align = 'start', ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        align={align}
        className={cn('z-50 min-w-44 rounded-xl border border-line bg-surface p-1 text-ink shadow-lg', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2',
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn('px-2.5 py-1 text-xs font-medium text-ink-3', className)} {...props} />;
}

export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-8 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2',
        className,
      )}
      {...props}
    >
      {children}
      <DropdownMenu.ItemIndicator className="absolute right-2.5 inline-flex">
        <Check className="h-4 w-4 text-brand-strong" aria-hidden />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}
