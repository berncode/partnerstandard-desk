'use client';

// Settings' Members on a company server (plan 15, task 6). Every member sees who is in the company and their role; an
// admin changes a role, removes someone (asked first), invites an address with a role, and cancels an open invite.
import type { MemberView, WorkspaceInvite } from '@partner-desk/commands';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Field, fieldControl } from '@/markets/fields';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { cancelInvitation, changeMemberRole, inviteMember, removeTeamMember } from './members-actions';
import { dayIn, EmptyLine, Facts, SubSection } from './agents-shared';

export function MembersPanel({ initialMembers, initialInvites, admin, timeZone }: {
  initialMembers: MemberView[]; initialInvites: WorkspaceInvite[]; admin: boolean; timeZone: string;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startPending] = useTransition();
  const router = useRouter();

  const run = (work: () => Promise<{ message?: string } | void>) => startPending(async () => {
    setNote(null);
    try {
      const out = await work();
      if (out?.message) setNote({ ok: false, message: out.message });
    } catch {
      setNote({ ok: false, message: COPY.SETTINGS_WRONG });
    }
  });

  const changeRole = (member: MemberView, role: WorkspaceRole) => run(async () => {
    const out = await changeMemberRole(member.personId, role);
    if (!out.ok) return out;
    setMembers(out.members);
    setNote({ ok: true, message: COPY.MEMBERS_ROLE_SAVED(member.name, COPY.MEMBERS_ROLES[role]) });
    // Your own role changed what this page offers you: ask for it again.
    if (member.you) router.refresh();
  });

  const remove = (member: MemberView) => run(async () => {
    const out = await removeTeamMember(member.personId);
    setRemoving(null);
    if (!out.ok) return out;
    setMembers(out.members);
  });

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-3">{COPY.MEMBERS_HINT}</p>
      <ul aria-labelledby="members-heading" className="divide-y divide-line">
        {members.map((member) => (
          <MemberRow key={member.personId} member={member} admin={admin} disabled={pending}
            onRole={(role) => changeRole(member, role)} onRemove={() => setRemoving(member)} />
        ))}
      </ul>
      {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-sm text-ink-2' : 'text-sm text-danger'}>{note.message}</p>}
      {admin && <Invites invites={invites} setInvites={setInvites} timeZone={timeZone} />}
      <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} busy={pending}
        title={COPY.MEMBERS_REMOVE_TITLE(removing?.name ?? '')} text={COPY.MEMBERS_REMOVE_TEXT} action={COPY.MEMBERS_REMOVE}
        onConfirm={() => { if (removing) remove(removing); }} />
    </div>
  );
}

function MemberRow({ member, admin, disabled, onRole, onRemove }: {
  member: MemberView; admin: boolean; disabled: boolean; onRole: (role: WorkspaceRole) => void; onRemove: () => void;
}) {
  const nameId = useId();
  const label = member.you ? `${member.name} (${COPY.MEMBERS_YOU})` : member.name;
  const facts = [...(member.name === member.email ? [] : [member.email]), ...(admin ? [] : [COPY.MEMBERS_ROLES[member.role]])];
  return (
    <li aria-labelledby={nameId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0">
      <div className="min-w-0 flex-1 basis-48">
        <p id={nameId} className="truncate text-sm font-medium">{label}</p>
        {/* A person without a name goes by their address: it isn't said twice. */}
        {facts.length > 0 && <Facts items={facts} />}
      </div>
      {admin && (
        <>
          <select className={`${fieldControl} w-auto`} aria-label={`${COPY.MEMBERS_ROLE_LABEL}: ${member.name}`} value={member.role} disabled={disabled}
            onChange={(e) => onRole(e.target.value as WorkspaceRole)}>
            {WORKSPACE_ROLES.map((role) => <option key={role} value={role}>{COPY.MEMBERS_ROLES[role]}</option>)}
          </select>
          {/* Leaving is Delete account's, below: an admin removes others here. */}
          {!member.you && (
            <Button size="sm" variant="ghost" aria-label={`${COPY.MEMBERS_REMOVE} ${member.name}`} disabled={disabled} onClick={onRemove}>
              {COPY.MEMBERS_REMOVE}
            </Button>
          )}
        </>
      )}
    </li>
  );
}

function Invites({ invites, setInvites, timeZone }: {
  invites: WorkspaceInvite[]; setInvites: (invites: WorkspaceInvite[]) => void; timeZone: string;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('partnerManager');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startPending] = useTransition();
  const formId = useId();
  const listId = useId();

  const send = () => startPending(async () => {
    setEmailError(null);
    setNote(null);
    try {
      const out = await inviteMember(email, role);
      if (!out.ok) {
        if (out.fieldErrors?.email) setEmailError(out.fieldErrors.email);
        else setNote({ ok: false, message: out.message });
        return;
      }
      setInvites(out.invites);
      setEmail('');
      setNote({ ok: true, message: out.message });
    } catch {
      setNote({ ok: false, message: COPY.SETTINGS_WRONG });
    }
  });

  const cancel = (invite: WorkspaceInvite) => startPending(async () => {
    setNote(null);
    try {
      const out = await cancelInvitation(invite.id);
      if (out.ok) setInvites(out.invites);
      else setNote({ ok: false, message: out.message });
    } catch {
      setNote({ ok: false, message: COPY.SETTINGS_WRONG });
    }
  });

  return (
    <>
      <SubSection id={formId} title={COPY.INVITE_TITLE}>
        <form noValidate className="grid gap-3" onSubmit={(event) => { event.preventDefault(); send(); }}>
          {/* The fields line up at the top: the role's hint below it never pushes the email field down. */}
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1 basis-56">
              <Field label={COPY.INVITE_EMAIL_LABEL} error={emailError ?? undefined}>
                {(describedBy) => (
                  <input type="email" className={fieldControl} value={email} autoComplete="off" aria-describedby={describedBy}
                    aria-invalid={emailError ? true : undefined} onChange={(e) => setEmail(e.target.value)} />
                )}
              </Field>
            </div>
            <Field label={COPY.MEMBERS_ROLE_LABEL} hint={COPY.MEMBERS_ROLE_TEXT[role]}>
              {(describedBy) => (
                <select className={`${fieldControl} w-auto`} value={role} aria-label={COPY.MEMBERS_ROLE_LABEL} aria-describedby={describedBy}
                  onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
                  {WORKSPACE_ROLES.map((r) => <option key={r} value={r}>{COPY.MEMBERS_ROLES[r]}</option>)}
                </select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>{COPY.INVITE_SEND}</Button>
            {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-sm text-ink-2' : 'text-sm text-danger'}>{note.message}</p>}
          </div>
        </form>
      </SubSection>
      <SubSection id={listId} title={COPY.INVITES_OPEN}>
        {invites.length === 0 ? <EmptyLine>{COPY.INVITES_NONE}</EmptyLine> : (
          <ul className="divide-y divide-line">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">{invite.email}</p>
                  <Facts items={[COPY.MEMBERS_ROLES[invite.role], COPY.INVITE_UNTIL(dayIn(invite.expiresAt, timeZone))]} />
                </div>
                <Button size="sm" variant="ghost" aria-label={`${COPY.INVITE_CANCEL}: ${invite.email}`} disabled={pending} onClick={() => cancel(invite)}>
                  {COPY.INVITE_CANCEL}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SubSection>
    </>
  );
}
