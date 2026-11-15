// At a glance, in Recruitment's `Section`. Review Focus 4: with no typical customer in Company facts, a figure that
// depends on what the customer pays says "not known" (never 0), and with no sales and marketing or revenue the card
// says what to fill in.
import { costCheck, formatMoney, formatPerOne, levelNames, type CompanyFacts, type Program } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { cn } from '@/ui/cn';
import { Section } from '@/ui/pieces';
import { Callouts } from './callouts';
import { Note } from './note';

const NOT_KNOWN = COPY.NOT_KNOWN;

/**
 * Money's cost check (PD spec §6.3): per typical customer and level, what partners earn over five years, the running
 * costs, what a customer through partners costs you and brings you, what partners cost you per 1 brought in (bold), and
 * what selling direct costs you. Then the one call-out.
 */
export function AtAGlance({ company: c, program: p }: { company: CompanyFacts; program: Program }) {
  const r = costCheck(c, p);
  const money = (v: number) => formatMoney(v, c.currency);
  const ratio = (v: number | null) => (v === null ? NOT_KNOWN : formatPerOne(v, c.currency));
  const one = formatPerOne(1, c.currency).replace('.00', '');
  const two = r.pref !== null;
  // What partners earn on margin and commission is a share of what the customer pays: not known until Company facts says.
  const noCustomer = r.value <= 0;
  const earnUnknown = noCustomer && (p.money.model === 'margin' || p.money.model === 'commission');
  const earned = (v: number) => (earnUnknown ? NOT_KNOWN : money(v));
  const rows: { label: string; reg: string; pref: string; strong?: boolean; rule?: boolean }[] = [
    { label: COPY.PROG_GLANCE_EARN, reg: earned(r.reg.total), pref: r.pref ? earned(r.pref.total) : '' },
    { label: COPY.PROG_GLANCE_RUNNING, reg: money(r.running), pref: money(r.running) },
    { label: COPY.PROG_GLANCE_COST, reg: earned(r.costReg), pref: r.costPref === null ? '' : earned(r.costPref), rule: true },
    { label: COPY.PROG_GLANCE_VALUE, reg: noCustomer ? NOT_KNOWN : money(r.value), pref: noCustomer ? NOT_KNOWN : money(r.value) },
    { label: COPY.PROG_GLANCE_RATIO(one), reg: ratio(r.ratioReg), pref: ratio(r.ratioPref), strong: true, rule: true },
    { label: COPY.PROG_GLANCE_DIRECT, reg: r.direct === null ? NOT_KNOWN : formatPerOne(r.direct, c.currency), pref: '' },
  ];
  return (
    <Section title={COPY.PROG_GLANCE_TITLE} description={COPY.PROG_GLANCE_HINT(one)}>
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="text-xs text-ink-3">
            <th scope="col" className="pb-1 text-left font-normal">{COPY.PROG_GLANCE_PER_CUSTOMER}</th>
            <th scope="col" className="pb-1 pl-3.5 text-right font-normal">{levelNames(p).reg}</th>
            {two && <th scope="col" className="pb-1 pl-3.5 text-right font-normal">{levelNames(p).pref}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={cn(row.strong && 'font-semibold', row.rule && 'border-t border-line')}>
              <th scope="row" className={cn('py-[3px] text-left align-baseline text-balance', row.strong ? 'text-ink' : 'font-normal text-ink-2', row.rule && 'pt-[7px]')}>
                {row.label}
              </th>
              <td className={cn('py-[3px] pl-3.5 text-right align-baseline whitespace-nowrap', row.rule && 'pt-[7px]')}>{row.reg}</td>
              {two && <td className={cn('py-[3px] pl-3.5 text-right align-baseline whitespace-nowrap', row.rule && 'pt-[7px]')}>{row.pref}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <Callouts className="mt-3" items={[r.callout]} />
      {/* With a customer value the call-out already says to add them; without one it is about the customer. */}
      {r.direct === null && r.ratioReg === null && (
        <Note>
          {COPY.PROGRAM_DIRECT_UNKNOWN}{' '}
          <Link href="/company-facts" className="font-medium text-brand-strong underline-offset-2 hover:underline">{COPY.NAV_COMPANY_FACTS}</Link>
        </Note>
      )}
    </Section>
  );
}
