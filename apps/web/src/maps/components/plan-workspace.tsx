'use client';

// The MAP page's workspace, inside the app frame. A MAP file's row issues name a tab and a row, so they are listed together above the plan.
import type { IsoDate, MapActor } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { RowIssue } from '@partner-desk/storage';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ReconnectBanner } from '@/editor/reconnect-banner';
import { useViewer } from '@/storage-context';
import { ourSideName } from '../format';
import type { Notify } from '../notify';
import type { MapSnapshot, PlanRemote } from '../remote';
import { usePlanEditor } from '../use-plan-editor';
import { ActivitiesSection } from './activities';
import { ObjectivesSection } from './objectives';
import { PlanContext, type PlanContextValue } from './plan-context';
import { PlanHeader } from './plan-header';
import { SidePanel } from './side-panel';
import type { StorageKind } from '@/storage-kind';

export interface PlanWorkspaceProps {
  /** Referentially stable; a new object (a fresh server render on a revisit) replaces the confirmed plan. */
  initial: MapSnapshot;
  /** Must be referentially stable (module-level, useState or useCallback). */
  remote: PlanRemote;
  actor: MapActor;
  /** Who makes the changes, as Updated by names them until the server's answer comes back. */
  actorName: string;
  today: IsoDate;
  fileUrl?: string | null;
  presentHref?: string | null;
  /** The owner's review page (reviews spec 6); never given to a person with a link. */
  reviewHref?: string | null;
  /** Above the header: the link back, and notes such as the date move that failed at signing. */
  banner?: ReactNode;
  /** Extra header controls (the owner's Share button), shown next to Present. */
  headerActions?: ReactNode;
  notify?: Notify;
  /** The company's name in Settings, naming our side for every viewer. Empty or absent: `ownerName`. */
  ourName?: string | null;
  /** The owner's display name: names our side until the company has a name. */
  ownerName: string;
  /** Nothing can be changed: a person with a link after the partner type's exit (spec 5.3). */
  readOnly?: boolean;
  /**
   * The owner's page: when a save needs Google again, the Reconnect Google banner, and `next` is where Google brings them
   * back (question 16). Without it (a person with a link) the toast says so instead.
   */
  reconnect?: { next: string; storage: StorageKind };
}

export function PlanWorkspace({
  initial, remote, actor, actorName, today, fileUrl = null, presentHref = null, reviewHref = null, banner, headerActions, notify, ourName = null, ownerName, readOnly = false, reconnect,
}: PlanWorkspaceProps) {
  const editor = usePlanEditor({ initial, remote, actor, actorName, showsReconnect: reconnect !== undefined, ...(notify ? { notify } : {}) });
  // A company server's viewer reads the MAP and changes nothing (plan 15). A person with a link is never one.
  const viewer = useViewer() && actor.kind !== 'link';
  const value: PlanContextValue = {
    ...editor,
    allowed: readOnly || viewer || editor.needsGoogle ? () => false : editor.allowed,
    actor,
    today,
    presentHref,
    reviewHref: actor.kind === 'link' ? null : reviewHref,
    names: { ours: ourSideName(ourName, ownerName), partner: editor.plan.info.partnerName },
  };

  return (
    <PlanContext value={value}>
      <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {(editor.needsGoogle || viewer) && reconnect && <ReconnectBanner next={reconnect.next} storage={reconnect.storage} />}
          {banner}
          <SheetIssues issues={editor.issues} />
          <PlanHeader fileUrl={fileUrl} presentHref={presentHref} actions={headerActions} />
          {actor.kind === 'owner' && !ourName?.trim() && <CompanyNameHint />}
        </div>
        <div className="min-w-0 space-y-4">
          <ObjectivesSection />
          <ActivitiesSection />
        </div>
        <aside aria-label={COPY.MAP_PEOPLE_PANEL} className="min-w-0 space-y-4">
          <SidePanel />
        </aside>
      </div>
    </PlanContext>
  );
}

/** For an owner whose company has no name: our side shows their own name until it has one. Never shown to link holders. */
function CompanyNameHint() {
  const [before, after] = COPY.MAP_COMPANY_HINT;
  return (
    <p className="px-1 text-xs text-ink-3">
      {before}{' '}
      <Link href="/settings" className="font-medium text-brand-strong underline-offset-2 hover:underline">{COPY.NAV_SETTINGS}</Link>
      {' '}{after}
    </p>
  );
}

function SheetIssues({ issues }: { issues: RowIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{COPY.MAP_SHEET_ISSUES}</p>
        <ul className="mt-1 list-disc pl-4">
          {issues.map((issue) => <li key={`${issue.tab}-${issue.row}-${issue.message}`} className="break-words">{issue.tab}: {issue.message}</li>)}
        </ul>
      </div>
    </div>
  );
}
