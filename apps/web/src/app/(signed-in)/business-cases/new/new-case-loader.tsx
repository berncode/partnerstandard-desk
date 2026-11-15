import { readPartners } from '@partner-desk/commands';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewCaseScreen } from '@/cases/new-case-screen';
import type { CasePartnerOption } from '@/cases/new-case-form';
import { FileProblem } from '@/problems/file-problem';
import { programOptionsFor } from '@/server/request-programs';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';

const PATH = '/business-cases/new';

/**
 * Every partner type in Partners, as "Acme as reseller", and the company's programs (for the pick). Request data is
 * read only here, inside Suspense.
 */
export async function NewCaseLoader({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const wanted = typeof query.partner === 'string' ? query.partner : undefined;
  const { session, deps } = await requireOwner(wanted ? `${PATH}?partner=${encodeURIComponent(wanted)}` : PATH);
  // A company server's viewer makes nothing: the page they reached by its address sends them to the list (owner, 2026-11-14).
  if (session.member?.role === 'viewer') redirect('/business-cases');
  const { companyId } = await companyFor(session);
  const [book, programs] = await Promise.all([readPartners(deps, actorFor(session), { companyId }), programOptionsFor(session)]);
  if (!book.ok) return <FileProblem failure={book} next={PATH} storage={session.storage} />;
  const { accounts, partners } = book.value.value;
  const options: CasePartnerOption[] = partners.flatMap((p) => {
    const company = accounts.find((a) => a.id === p.accountId)?.company.trim();
    return company ? [{ partnerId: p.id, partnerType: p.partnerType, label: COPY.PARTNER_AS_TYPE(company, PARTNER_TYPE_LABELS[p.partnerType]) }] : [];
  }).sort((a, b) => a.label.localeCompare(b.label));
  if (options.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
        <p className="text-ink-2">{COPY.NEW_CASE_NO_PARTNERS}</p>
        <Link href="/partners" className={buttonVariants({ variant: 'primary', className: 'mt-4' })}>{COPY.GO_TO_PARTNERS}</Link>
      </div>
    );
  }
  return <NewCaseScreen partners={options} programs={programs.ok ? programs.value : []} initialPartnerId={wanted} />;
}
