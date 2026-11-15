import { readCompanyFacts } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { FactsProblem } from '@/programs/facts-problem';
import { FactsForm } from '@/programs/facts-form';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { CardSkeleton, Loading, Skeleton } from '@/ui/loading';
import { hasFileLink } from '@/storage-kind';

const PATH = '/company-facts';

/**
 * Reads the company's facts through the command (the first read makes the file), or says why they can't be shown.
 * The form is keyed by what it shows: Reload after a refused save brings a fresh form with the file's facts.
 */
export async function FactsLoader() {
  const { session, deps } = await requireOwner(PATH);
  const { companyId, name } = await companyFor(session);
  const read = await readCompanyFacts(deps, actorFor(session), { companyId });
  if (!read.ok) return <FactsProblem failure={read} next={PATH} storage={session.storage} />;
  const facts = read.value.value;
  return (
    <FactsForm
      key={JSON.stringify(facts)}
      initial={facts}
      companyName={name}
      // A test user's files live in memory: there is no spreadsheet to open.
      fileUrl={hasFileLink(session.storage) ? read.value.fileUrl : null}
    />
  );
}

export function FactsSkeleton() {
  return (
    <Loading label={COPY.FACTS_LOADING} className="mx-auto grid w-full max-w-3xl gap-4">
      <Skeleton className="h-14 rounded-xl" />
      {[0, 1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}
    </Loading>
  );
}
