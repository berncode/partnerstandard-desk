import { listMaps, readMap, readPartners, ownerToday, type Actor, type Deps } from '@partner-desk/commands';
import { daysBetween } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { connection } from 'next/server';
import { mapDelete } from '@/app/(signed-in)/actions/maps';
import { DeleteMap } from '@/maps/delete-map';
import { MapPage } from '@/maps/map-page';
import { mapPath } from '@/maps/plan-card';
import { snapshotOf } from '@/maps/remote';
import { mayDeleteAfter } from '@/maps/view-model';
import { LoadProblem } from '@/markets/load-problem';
import { partnerHref } from '@/partner/partner-model';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { hasFileLink } from '@/storage-kind';

/**
 * Reads the MAP and Partners: the MAP app's plan page (MAP 3.3) inside the app frame, named as Partners names the
 * partner now, with a link back to the partner's page (to Plans when its partner type is gone from Partners). A MAP no
 * longer listed says so. Its health counts progress from the MAP's one "last progress" (ruling R6).
 */
export async function MapLoader({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  const here = mapPath(mapId);
  const { session, deps } = await requireOwner(here);
  const company = await companyFor(session);
  const actor = actorFor(session);
  const read = await readMap(deps, actor, { mapId });
  if (!read.ok) {
    const problem = <LoadProblem failure={read} next={here} storage={session.storage} />;
    const listed = mayDeleteAfter(read.error) ? await stillListed(deps, actor, company.companyId, mapId) : null;
    if (!listed) return problem;
    return (
      <div className="grid gap-3">
        {problem}
        <div><DeleteMap mapId={mapId} name={listed.displayName} remove={mapDelete} goTo={listed.goTo} /></div>
      </div>
    );
  }
  const book = await readPartners(deps, actor, { companyId: company.companyId });
  await connection();
  const today = await ownerToday(deps, session.owner.userId);
  const { record, plannedStart, datesMoveFailed } = read.value;
  const label = PARTNER_TYPE_LABELS[record.partnerType];
  const partner = book.ok ? book.value.value.partners.find((p) => p.id === read.value.value.info.partnerId) : undefined;
  const back = partner
    ? { href: partnerHref(partner.accountId, partner.partnerType), label: COPY.MAP_BACK_TO(record.partnerName || label) }
    : { href: '/plans', label: COPY.MAP_BACK_TO_PLANS };
  const datesMove = datesMoveFailed && record.signedDate ? { days: daysBetween(plannedStart, record.signedDate) } : null;
  return (
    <MapPage
      mapId={mapId}
      name={record.partnerName ? COPY.PARTNER_AS_TYPE(record.partnerName, label) : label}
      deletedTo={back.href}
      initial={snapshotOf(read.value)}
      today={today}
      actorName={session.owner.displayName}
      fileUrl={hasFileLink(session.storage) ? read.value.fileUrl : null}
      ourName={company.name}
      ownerName={session.owner.displayName}
      datesMove={datesMove && datesMove.days !== 0 ? datesMove : null}
      storage={session.storage}
      back={(
        <div>
          <Link href={back.href} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {back.label}
          </Link>
        </div>
      )}
    />
  );
}

/**
 * A MAP that couldn't be read but is still listed: its name, and where Delete goes after (its partner's page, which
 * offers Start the MAP again, or Plans). Null when it isn't listed (deleted already, or not this person's).
 */
async function stillListed(deps: Deps, actor: Actor, companyId: string, mapId: string): Promise<{ displayName: string; goTo: string } | null> {
  const listed = await listMaps(deps, actor, { companyId });
  const item = listed.ok ? listed.value.find((m) => m.mapId === mapId) : undefined;
  if (!item) return null;
  const book = await readPartners(deps, actor, { companyId });
  const partner = book.ok ? book.value.value.partners.find((p) => p.id === item.partnerId && p.partnerType === item.partnerType) : undefined;
  return { displayName: item.displayName, goTo: partner ? partnerHref(partner.accountId, partner.partnerType) : '/plans' };
}
