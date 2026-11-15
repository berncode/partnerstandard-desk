'use client';

// New for PartnerStandard Desk (spec 4.4): above a program's steps, its partners per level ("Registered: 6 · Preferred: 2"),
// each linking to the partner's tab, and the markets that feed it.
import { levelNames, type Level } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { partnerHref } from '@/partner/partner-model';
import { cn } from '@/ui/cn';
import type { ProgramMembers } from './links';
import { useProgramEditor } from './program-editor';

const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

/** The partners and markets as read with the page, or why they couldn't be. */
export type MembersRead = { ok: true; value: ProgramMembers } | { ok: false; message: string };

/** A comma list of links, as one line that wraps. */
function LinkList({ label, items }: { label: string; items: { key: string; href: string; text: string }[] }) {
  return (
    <ul aria-label={label} className="inline">
      {items.map((item, i) => (
        <li key={item.key} className="inline">
          <Link href={item.href} className={cn(linkClass, 'break-words')}>{item.text}</Link>
          {i < items.length - 1 && ', '}
        </li>
      ))}
    </ul>
  );
}

/**
 * The program's partners per level, by the names the program gives its levels as they are typed, and the markets
 * that feed it. Preferred is counted while the program has it, or while a partner still sits there.
 */
export function ProgramMembersView({ members }: { members: MembersRead }) {
  const { program } = useProgramEditor();
  const names = levelNames(program);
  if (!members.ok) {
    return (
      <section aria-label={COPY.PROG_MEMBERS} className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-3 print:hidden">
        {COPY.PROG_MEMBERS_FAILED}
      </section>
    );
  }
  const { partners, markets } = members.value;
  const at = (level: Level) => partners.filter((p) => p.level === level);
  const levels: Level[] = program.prefOn || at('pref').length > 0 ? ['reg', 'pref'] : ['reg'];
  return (
    <section aria-label={COPY.PROG_MEMBERS} className="grid gap-2 rounded-xl border border-line bg-surface p-4 text-sm print:hidden">
      <p className="font-medium">{levels.map((level) => COPY.PROG_LEVEL_COUNT(names[level], at(level).length)).join(' · ')}</p>
      {levels.filter((level) => at(level).length > 0).map((level) => (
        <div key={level} className="min-w-0">
          <span className="text-ink-3">{names[level]}: </span>
          <LinkList label={names[level]} items={at(level).map((p) => ({ key: p.partnerId, href: partnerHref(p.accountId, p.partnerType), text: p.company }))} />
        </div>
      ))}
      {markets.length === 0 ? <p className="text-ink-3">{COPY.PROG_NO_MARKETS}</p> : (
        <div className="min-w-0">
          <span className="text-ink-3">{COPY.PROG_FED_BY}: </span>
          <LinkList label={COPY.PROG_FED_BY} items={markets.map((m) => ({ key: m.marketId, href: `/markets/${encodeURIComponent(m.marketId)}`, text: m.displayName }))} />
        </div>
      )}
    </section>
  );
}
