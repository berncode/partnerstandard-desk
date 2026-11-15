import { readCase, readPartners } from '@partner-desk/commands';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { ReactNode } from 'react';
import { CaseHost } from '@/cases/case-host';
import { caseTabPath } from '@/cases/case-nav';
import { LoadProblem } from '@/markets/load-problem';
import { partnerHref } from '@/partner/partner-model';
import { programsFor } from '@/partner/program-model';
import { programOptionsFor } from '@/server/request-programs';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { hasFileLink } from '@/storage-kind';

/**
 * Reads the case, Partners and the company's programs, once for every tab of the case. `readCase` gives the case with
 * the directory's partner type (never a hand edit of the file's, final review) and the partner as Partners names it
 * now, so the header ("Acme as reseller") and every tab use one name (owner, 2026-10-30); the header links back to the
 * partner's page. A partner type gone from Partners (a hand edit) still opens: it is named as the case stores the
 * partner ("Acme as reseller", else the type's label alone), says so, and links back to the Business cases page
 * (Review Focus 2). A case no longer in the directory says so (`CASE_NOT_LISTED`, in the words of where the work
 * lives). The editor is keyed by the case as read: after an Update or Reload, a fresh editor starts from the file's case.
 */
export async function CaseLoader({ params, children }: { params: Promise<{ caseId: string }>; children: ReactNode }) {
  const { caseId } = await params;
  const here = caseTabPath(caseId, 'offer');
  const { session, deps } = await requireOwner(here);
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const [read, book, programs] = await Promise.all([
    readCase(deps, actor, { caseId }), readPartners(deps, actor, { companyId }), programOptionsFor(session),
  ]);
  if (!read.ok) return <LoadProblem failure={read} next={here} storage={session.storage} />;
  const c = read.value.value;
  const row = book.ok ? book.value.value.partners.find((p) => p.id === c.partnerId && p.partnerType === c.partnerType) : undefined;
  const account = row && book.ok ? book.value.value.accounts.find((a) => a.id === row.accountId) : undefined;
  const label = PARTNER_TYPE_LABELS[c.partnerType];
  const company = account?.company.trim() || c.partner.trim();
  const back = account
    ? { href: partnerHref(account.id, c.partnerType), label: COPY.CASE_BACK_TO(company) }
    : { href: '/business-cases', label: COPY.CASE_BACK_TO_CASES };
  return (
    <CaseHost
      key={JSON.stringify(c)}
      initial={c}
      heading={company ? COPY.PARTNER_AS_TYPE(company, label) : label}
      back={back}
      programs={programs.ok ? programsFor(programs.value, c.partnerType) : []}
      // Only when Partners was read: an unreadable file says nothing about the partner type.
      typeGone={book.ok && !row}
      shared={read.value.shared}
      // A test account's files live in memory: a memory:// address leads nowhere, so no link (as Company facts).
      fileUrl={hasFileLink(session.storage) ? read.value.fileUrl : null}
    >
      {children}
    </CaseHost>
  );
}
