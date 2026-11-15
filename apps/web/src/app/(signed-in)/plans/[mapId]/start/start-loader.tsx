import { listCases, readCase, readMap, readPartners, type Actor, type Deps } from '@partner-desk/commands';
import type { PersonRole, Role } from '@partner-desk/core';
import { redirect } from 'next/navigation';
import { mapFill } from '@/app/(signed-in)/actions/maps';
import { GuidedFlow } from '@/maps/guided/guided-flow';
import type { Contact } from '@/maps/guided/steps';
import { mapPath } from '@/maps/plan-card';
import { LoadProblem } from '@/markets/load-problem';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';

/** A contact's role in Partners, as the MAP's people roles name it [builder's call]. */
const ROLE_OF: Record<PersonRole, Role> = { sponsor: 'exec_sponsor', seller: 'sales_lead', contact: 'other' };

/**
 * What the partner type's business cases name "Beyond the money", newest case first, each once (spec 5.2): offered as
 * the partner's objectives. A case that can't be read adds nothing. One read after another, as Google allows.
 */
async function caseBenefits(deps: Deps, actor: Actor, companyId: string, partnerId: string): Promise<string[]> {
  const listed = await listCases(deps, actor, { companyId, partnerId });
  if (!listed.ok) return [];
  const benefits: string[] = [];
  for (const { caseId } of listed.value) {
    const read = await readCase(deps, actor, { caseId });
    if (!read.ok) continue;
    for (const benefit of read.value.value.benefits) {
      const text = benefit.trim();
      if (text && !benefits.includes(text)) benefits.push(text);
    }
  }
  return benefits;
}

/**
 * Reads the new MAP, the partner's contacts in Partners and its business cases' benefits for the guided steps. A MAP that holds objectives,
 * activities or exit triggers already opens as itself: the steps are for a new MAP only.
 */
export async function StartLoader({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  const here = `${mapPath(mapId)}/start`;
  const { session, deps } = await requireOwner(here);
  // A company server's viewer fills in no MAP: the guided steps send them to the MAP itself (owner, 2026-11-14).
  if (session.member?.role === 'viewer') redirect(mapPath(mapId));
  const { companyId, name } = await companyFor(session);
  const actor = actorFor(session);
  const [read, book] = await Promise.all([readMap(deps, actor, { mapId }), readPartners(deps, actor, { companyId })]);
  if (!read.ok) return <LoadProblem failure={read} next={here} storage={session.storage} />;
  const plan = read.value.value;
  if (plan.objectives.length + plan.activities.length + plan.exitTriggers.length > 0) redirect(mapPath(mapId));
  const partners = book.ok ? book.value.value : null;
  const accountId = partners?.partners.find((p) => p.id === plan.info.partnerId)?.accountId;
  const benefits = await caseBenefits(deps, actor, companyId, plan.info.partnerId);
  const contacts: Contact[] = (partners?.people ?? [])
    .filter((p) => accountId !== undefined && p.accountId === accountId && p.name.trim() !== '')
    .map((p) => ({ name: p.name.trim(), title: p.title, email: p.email, role: ROLE_OF[p.role] }));
  return (
    <GuidedFlow mapId={mapId} plan={plan} record={read.value.record} plannedStart={read.value.plannedStart}
      ours={name.trim() || session.owner.displayName} ownerName={session.owner.displayName} contacts={contacts} caseBenefits={benefits} onSave={mapFill} />
  );
}
