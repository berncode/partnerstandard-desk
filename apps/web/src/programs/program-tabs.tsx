'use client';

import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cn } from '@/ui/cn';
import { useProgramEditor } from './program-editor';
import { programPath, SCREENS, screenName, STEPS, type Screen } from './steps';

/** Which of the program's screens the address shows, or null. */
export function screenOf(pathname: string, programId: string): Screen | null {
  const base = programPath(programId, 'why').replace(/why$/, '');
  if (!pathname.startsWith(base)) return null;
  const rest = pathname.slice(base.length);
  return (SCREENS as readonly string[]).includes(rest) ? (rest as Screen) : null;
}

/**
 * The program's screens as a row of tabs, in the look of the market's tabs (Recruitment's): the five numbered steps,
 * named with the program's level names as they are typed, then Program Sheet and Public page. Each is a link (one
 * address per screen, so Back in the browser works); the one on screen is marked. Scrolls sideways on a phone.
 */
export function ProgramTabs() {
  const pathname = usePathname();
  const { program: p } = useProgramEditor();
  const current = screenOf(pathname, p.id);
  // On a phone the row scrolls sideways: the tab on screen is brought into view.
  const shown = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    shown.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  return (
    <nav aria-label={COPY.PROG_SCREENS} className="flex gap-1 overflow-x-auto border-b border-line print:hidden">
      {SCREENS.map((screen) => {
        const step = (STEPS as readonly string[]).indexOf(screen);
        const name = screenName(p, screen);
        return (
          <Link key={screen} ref={screen === current ? shown : undefined} href={programPath(p.id, screen)} aria-current={screen === current ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand',
              screen === current && 'border-brand text-ink',
            )}>
            {step >= 0 ? <><span aria-hidden className="mr-1 tabular-nums">{step + 1}</span>{name}</> : name}
          </Link>
        );
      })}
    </nav>
  );
}
