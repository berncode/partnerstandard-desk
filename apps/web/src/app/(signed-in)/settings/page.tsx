import { addressHash, listInvites, listMembers, listTrash, timeZoneSetting } from '@partner-desk/commands';
import { NOTIFICATION_TYPES } from '@partner-desk/core';
import { COPY, copyFor } from '@partner-desk/copy';
import { Suspense, type ReactNode } from 'react';
import { actorFor, companyFor, emailPrefs, mailConfigured, requireOwner, updateStatus } from '@/server/runtime';
import { agentsPanelData } from './agents-data';
import { AgentsPanel, AgentsUnavailable } from './agents-panel';
import { CompanyForm } from './company-form';
import { DeleteAccount } from './delete-account';
import { EmailPreferences } from './email-prefs';
import { MembersPanel } from './members-panel';
import { TrashPanel } from './trash-panel';
import { VersionPanel } from './version-panel';
import { TimeZoneForm } from './time-zone-form';
import { SettingsConnectionsLine } from './google-connections';
import { Storage } from './storage-panel';
import { StackLoading } from '@/ui/loading';
import { canReconnectGoogle } from '@/storage-kind';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.SETTINGS_TITLE };
// The company name and the timezone are saved through server actions on this page (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** The settings page: Google only, inside the app frame. */
export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">{COPY.SETTINGS_TITLE}</h1>
      <Suspense fallback={<div className="mt-6"><StackLoading /></div>}>
        <WithStorage><Sections /></WithStorage>
      </Suspense>
    </div>
  );
}

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-xl border border-line bg-surface p-4">
      <h2 id={`${id}-heading`} className="text-[15px] font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A company setting shown to a partner manager or a viewer: its value, and who changes it (plan 15). */
function AdminOnly({ value }: { value: string }) {
  return (
    <div>
      <p className="text-sm font-medium">{value}</p>
      <p className="mt-0.5 text-[13px] text-ink-3">{COPY.SETTINGS_ADMIN_ONLY}</p>
    </div>
  );
}

/** Every timezone this runtime knows, with the one in use first among them if it is missing from the list. */
function timeZoneChoices(current: string): string[] {
  const all = Intl.supportedValuesOf('timeZone');
  return all.includes(current) ? all : [current, ...all];
}

/** The version and the update notice, for a company server's admins; nothing on hosted or with UPDATE_CHECK=off. */
async function VersionSection() {
  const status = await updateStatus();
  if (!status) return null;
  return (
    <Panel id="version" title={COPY.VERSION_TITLE}>
      <VersionPanel status={status} howToUpdate={`https://github.com/${status.repo}/blob/main/docs/self-hosting.md#updating`} />
    </Panel>
  );
}

/** Metadata only: no spreadsheet is read here. */
async function Sections() {
  const { session, deps } = await requireOwner('/settings');
  const { name } = await companyFor(session);
  const actor = actorFor(session);
  const zone = await timeZoneSetting(deps, actor, {});
  const timeZone = zone.ok ? zone.value.timeZone : 'Europe/Berlin';
  const off = new Set((await emailPrefs().listForHash(addressHash(session.email))).map((p) => p.type));
  const agents = await agentsPanelData(session, deps, actor, timeZone);
  // A company server's member (plan 15): the members, and the company's settings for its admins only.
  const role = session.member?.role;
  const admin = role === undefined || role === 'admin';
  const members = role ? await listMembers(deps, actor, {}) : null;
  const invites = role === 'admin' ? await listInvites(deps, actor, {}) : null;
  // A company server's trash, for its admins (plan 16). Hosted has none: Drive keeps its trash.
  // A trash that can't be read leaves the rest of Settings, Delete account too, as it is.
  const trash = session.storage === 'database' && admin
    ? await listTrash(deps, actor, {}).catch(() => ({ ok: false as const, message: COPY.SETTINGS_WRONG }))
    : null;
  // A viewer gets only the reminders a MAP sends to its people; the digest, warnings and alerts go to admins and partner managers.
  const emailTypes = role === 'viewer' ? NOTIFICATION_TYPES.filter((type) => type === 'nudges') : NOTIFICATION_TYPES;
  return (
    <>
      <p className="mt-1 text-sm text-ink-3">{copyFor(session.storage).SETTINGS_INTRO}</p>
      <div className="mt-5 space-y-4">
        <Panel id="company" title={COPY.SETTINGS_COMPANY}>
          {admin ? <CompanyForm initial={name} /> : <AdminOnly value={name || COPY.COMPANY_UNNAMED} />}
        </Panel>
        {members && (
          <Panel id="members" title={COPY.MEMBERS_TITLE}>
            {members.ok
              ? <MembersPanel initialMembers={members.value} initialInvites={invites?.ok ? invites.value : []} admin={role === 'admin'} timeZone={timeZone} />
              : <p className="text-sm text-danger">{COPY.SETTINGS_WRONG}</p>}
          </Panel>
        )}
        <Panel id="time-zone" title={COPY.SETTINGS_TIME_ZONE}>
          {admin ? <TimeZoneForm initial={timeZone} choices={timeZoneChoices(timeZone)} /> : <AdminOnly value={timeZone} />}
        </Panel>
        <Panel id="emails" title={COPY.SETTINGS_EMAILS}>
          <EmailPreferences email={session.email} mailConfigured={mailConfigured()} initial={emailTypes.map((type) => ({ type, on: !off.has(type) }))} />
        </Panel>
        <Panel id="storage" title={COPY.SETTINGS_STORAGE}>
          <Storage session={session} />
        </Panel>
        <Panel id="agents" title={COPY.AGENTS_TITLE}>
          {agents ? <AgentsPanel {...agents} /> : <AgentsUnavailable />}
        </Panel>
        {trash && (
          <Panel id="trash" title={COPY.TRASH_TITLE}>
            {trash.ok ? <TrashPanel initial={trash.value} timeZone={timeZone} /> : <p className="text-sm text-danger">{trash.message}</p>}
          </Panel>
        )}
        {role === 'admin' && <Suspense fallback={null}><VersionSection /></Suspense>}
        <Panel id="delete" title={COPY.SETTINGS_DELETE}>
          <DeleteAccount />
          {canReconnectGoogle(session.storage) && <SettingsConnectionsLine className="mt-3 text-sm text-ink-2" />}
        </Panel>
      </div>
    </>
  );
}
