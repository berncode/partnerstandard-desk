import type { z } from 'zod';
import { PARTNER_TYPE_LABELS, type PartnerType, type RecruitmentStep, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { newId } from '../ids';
import { PARTNER_ENTITY_SCHEMAS } from './schemas';
import { toFieldErrors } from '../shared/schemas';
import type { ApplyOutcome } from '../shared/outcome';
import type { ChangeStamp } from '../shared/stamp';
import { checkClose, checkCorrectExit, checkExit, checkSign, checkStage, checkStep, checkUndoSigned, type RuleResult } from './lifecycle';
import type { Health } from '../maps/derived';
import type { ClosedAs, IsoDate, IsoDateTime, Partner, PartnerBook, PartnerEntity } from './types';

export const COLLECTION = {
  account: 'accounts',
  partner: 'partners',
  person: 'people',
  call: 'calls',
  qualification: 'qualifications',
  marketLink: 'marketLinks',
  proposalItem: 'proposalItems',
} as const satisfies Record<PartnerEntity, keyof Omit<PartnerBook, 'companyId'>>;

/** In `add` values and `update` patches, object fields (scores, notes, call topics, CASO letters) name only the sub-fields they set. */
export type PartnerChange =
  | { kind: 'add'; entity: PartnerEntity; values: Record<string, unknown> }
  | { kind: 'update'; entity: PartnerEntity; id: string; patch: Record<string, unknown>; expectedUpdatedAt?: IsoDateTime | null }
  | { kind: 'delete'; entity: PartnerEntity; id: string }
  | { kind: 'setStep'; partnerId: string; to: RecruitmentStep }
  | { kind: 'markSigned'; partnerId: string; signedDate: IsoDate }
  | { kind: 'setStage'; partnerId: string; to: Stage }
  | { kind: 'close'; partnerId: string; as: ClosedAs; reason: string }
  | { kind: 'reopen'; partnerId: string }
  | { kind: 'markExited'; partnerId: string; exitedDate: IsoDate; reason: string }
  | { kind: 'undoSigned'; partnerId: string }
  | { kind: 'correctExit'; partnerId: string; exitedDate: IsoDate; reason: string }
  /**
   * A partner type's MAP health and next milestone (spec 5.7), written by the MAP commands only: `partnerChangeSchema`
   * never parses it. It sets the two fields and nothing else, without stamping the row's Updated and Updated by, so a
   * screen holding the row is not sent a conflict by a MAP change or the daily refresh (controller ruling R5).
   */
  | { kind: 'setMapSummary'; partnerId: string; health: Health | null; nextMilestone: IsoDate | null; expectedUpdatedAt?: IsoDateTime | null };

/**
 * Which changes move a partner type's stage when they apply: each of them sends `partner.stage_changed` (spec 7.2).
 * A new kind of change must say whether it does; a test applies one of each and checks the answer.
 */
export const MOVES_STAGE: Readonly<Record<PartnerChange['kind'], boolean>> = {
  add: false, update: false, delete: false, setStep: false, close: false, reopen: false, correctExit: false, setMapSummary: false,
  markSigned: true, setStage: true, markExited: true, undoSigned: true,
};

export type { ApplyOutcome } from '../shared/outcome';

type Failure = Extract<ApplyOutcome<never>, { ok: false }>;
type Outcome = ApplyOutcome<PartnerBook>;
type Row = { id: string; updatedAt: IsoDateTime | null } & Record<string, unknown>;

const GONE: Failure = { ok: false, error: 'not_found', message: COPY.GONE };
const CONFLICT: Failure = { ok: false, error: 'conflict', message: COPY.CONFLICT };
/** Fields the app sets; values and patches never do. */
const MANAGED = ['id', 'updatedAt', 'updatedBy'];
/** Partner fields only the lifecycle changes may set, so the lifecycle rules always apply. */
export const LIFECYCLE_FIELDS = ['stage', 'step', 'closed', 'closedReason', 'signedDate', 'exitedDate', 'exitReason'] as const;

const emptyScores = () => ({ customerBase: null, credibility: null, capability: null, commitment: null });
const emptyNotes = () => ({ customerBase: '', credibility: '', capability: '', commitment: '' });
const emptyCaso = () => ({ answer: null, note: '' });

/** What a new row of each kind starts with. A new partner needs its `accountId` and `partnerType` in the values. */
function defaults(book: PartnerBook, entity: PartnerEntity, now: IsoDateTime): Record<string, unknown> {
  switch (entity) {
    case 'account':
      return { company: '', website: '', country: '', vertical: '', subVertical: '', targetCustomerType: 'unknown', comments: '' };
    case 'partner':
      return {
        companyId: book.companyId,
        stage: 'recruitment', step: 'researched', closed: null, closedReason: '', signedDate: null, exitedDate: null, exitReason: '',
        source: 'research', sourceDetail: '', whyItFits: '', desk: emptyScores(), confirmed: emptyScores(),
        mapFilled: false, mapLink: '', programId: null, level: null, mapHealth: null, mapNextMilestone: null,
      };
    case 'person':
      return { name: '', title: '', email: null, role: 'contact', activeSeller: false };
    case 'call':
      return {
        date: now.slice(0, 10), kind: 'discovery', notes: '',
        topics: { revenueModel: '', costDrivers: '', differentiators: '', strategicBets: '', customerPains: '', partnershipExperience: '' },
      };
    case 'qualification':
      return {
        deskNotes: emptyNotes(), confirmedNotes: emptyNotes(), q1Overlap: '', q2DealFit: '', q4MapAgreed: '',
        caso: { culture: emptyCaso(), additionalValue: emptyCaso(), sponsorship: emptyCaso(), alignedObjectives: emptyCaso() },
      };
    case 'marketLink':
      return { hypothesisId: null };
    // Its proposal, kind, what and times come in the values: the proposals commands always set them.
    case 'proposalItem':
      return {
        accountId: null, partnerId: null, marketId: null, hypothesisId: null, about: '', proposed: '', details: '', evidence: '',
        proposedBy: '', status: 'waiting', answerNote: '', answeredOn: null, targetUpdated: null,
      };
  }
}

const list = (book: PartnerBook, entity: PartnerEntity) => book[COLLECTION[entity]] as unknown as Row[];
const withList = (book: PartnerBook, entity: PartnerEntity, items: Row[]) => ({ ...book, [COLLECTION[entity]]: items }) as PartnerBook;

function stripManaged(values: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...values };
  for (const key of MANAGED) delete copy[key];
  return copy;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `base` with `patch` laid over it, merging objects key by key: a patch names only the sub-fields it changes (one
 * desk score, one call topic, one CASO letter's note), so a sibling edited by hand in the sheet keeps its value.
 */
function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? merge(current, value) : value;
  }
  return out;
}

function invalid(fieldErrors: Record<string, string>, message: string = COPY.FIX_FIELDS): Failure {
  return { ok: false, error: 'invalid', message, fieldErrors };
}

const refused = (message: string, fieldErrors?: Record<string, string>): Failure =>
  ({ ok: false, error: 'invalid', message, ...(fieldErrors ? { fieldErrors } : {}) });

/** Validates `row` and puts it in place of row `index` of the entity's list (or at the end when index is -1). */
function write(book: PartnerBook, entity: PartnerEntity, index: number, row: Record<string, unknown>): Outcome {
  const result = (PARTNER_ENTITY_SCHEMAS[entity] as z.ZodType).safeParse(row);
  if (!result.success) return invalid(toFieldErrors(result.error));
  const value = result.data as Row;
  const items = list(book, entity).slice();
  if (index === -1) items.push(value);
  else items[index] = value;
  return { ok: true, value: withList(book, entity, items), entityId: value.id };
}

/** Runs the lifecycle `rule`, then applies `edit` to the partner and writes it back, stamped. */
function editPartner(
  book: PartnerBook, partnerId: string, stamp: ChangeStamp,
  rule: (p: Partner) => RuleResult | Failure,
  edit: (p: Partner) => Partial<Partner>,
): Outcome {
  const index = book.partners.findIndex((p) => p.id === partnerId);
  if (index === -1) return GONE;
  const current = book.partners[index]!;
  const verdict = rule(current);
  if ('error' in verdict) return verdict;
  if (!verdict.ok) return refused(verdict.message);
  return write(book, 'partner', index, { ...current, ...edit(current), updatedAt: stamp.now, updatedBy: stamp.actor });
}

const hasLifecycleField = (values: Record<string, unknown>) => LIFECYCLE_FIELDS.some((key) => key in values);

/** True when any row in the book already uses `id`. */
function idTaken(book: PartnerBook, id: string): boolean {
  return (Object.values(COLLECTION) as Array<keyof Omit<PartnerBook, 'companyId'>>)
    .some((key) => (book[key] as ReadonlyArray<{ id: string }>).some((row) => row.id === id));
}

/**
 * The id a new row is saved under. A stamp that mints one wins (a batch replaces a provisional id that way).
 * Otherwise a non-empty `values.id` that no row already has is kept. `updatedAt` and `updatedBy` never come from the client.
 */
function idForAdd(book: PartnerBook, entity: PartnerEntity, requested: unknown, stamp: ChangeStamp): string | Failure {
  if (stamp.newId) return stamp.newId(entity);
  if (typeof requested === 'string' && requested !== '') {
    if (idTaken(book, requested)) return refused(COPY.ID_TAKEN, { id: COPY.ID_TAKEN });
    return requested;
  }
  return newId(entity);
}

/** A section and a person belong to an account that is in the book. */
function unknownAccount(book: PartnerBook, accountId: unknown): Failure | null {
  return book.accounts.some((a) => a.id === accountId) ? null : refused(COPY.PARTNER_GONE, { accountId: COPY.PARTNER_GONE });
}

/** One section per account and partner type. */
function sameTypeTaken(book: PartnerBook, accountId: unknown, partnerType: unknown): Failure | null {
  if (!book.partners.some((p) => p.accountId === accountId && p.partnerType === partnerType)) return null;
  const account = book.accounts.find((a) => a.id === accountId);
  const message = COPY.ALREADY_THIS_TYPE(account?.company ?? '', PARTNER_TYPE_LABELS[partnerType as PartnerType]);
  return refused(message, { partnerType: message });
}

/** A section's type and account are fixed: a wrong one is added again and deleted. */
function fixedSectionField(patch: Record<string, unknown>): Failure | null {
  if ('partnerType' in patch) return refused(COPY.TYPE_FIXED, { partnerType: COPY.TYPE_FIXED });
  if ('accountId' in patch) return refused(COPY.COMPANY_FIXED, { accountId: COPY.COMPANY_FIXED });
  return null;
}

/** A missing reason names the reason field; any other refusal stays a plain message. */
function withReasonError<T>(out: ApplyOutcome<T>): ApplyOutcome<T> {
  return !out.ok && out.error === 'invalid' && out.message === COPY.REASON_NEEDED && !out.fieldErrors
    ? { ...out, fieldErrors: { reason: COPY.REASON_NEEDED } }
    : out;
}

export function applyPartnerChange(book: PartnerBook, change: PartnerChange, stamp: ChangeStamp): Outcome {
  switch (change.kind) {
    case 'add': {
      const { entity } = change;
      if (entity === 'partner' && hasLifecycleField(change.values)) return refused(COPY.USE_OWN_CHANGES);
      const values = stripManaged(change.values);
      const refusal = entity === 'person' ? unknownAccount(book, values.accountId)
        : entity === 'partner' ? unknownAccount(book, values.accountId) ?? sameTypeTaken(book, values.accountId, values.partnerType)
        : null;
      if (refusal) return refusal;
      if (entity === 'qualification' && book.qualifications.some((q) => q.partnerId === values.partnerId)) {
        return invalid({ partnerId: COPY.ALREADY_QUALIFIED });
      }
      if (entity === 'marketLink' && book.marketLinks.some((l) => l.partnerId === values.partnerId && l.marketId === values.marketId)) {
        return refused(COPY.ALREADY_LINKED, { marketId: COPY.ALREADY_LINKED });
      }
      const id = idForAdd(book, entity, change.values.id, stamp);
      if (typeof id !== 'string') return id;
      return write(book, entity, -1, {
        ...merge(defaults(book, entity, stamp.now), values), id, updatedAt: stamp.now, updatedBy: stamp.actor,
      });
    }

    case 'update': {
      if (change.entity === 'partner' && hasLifecycleField(change.patch)) return refused(COPY.USE_OWN_CHANGES);
      const refusal = change.entity === 'partner' ? fixedSectionField(change.patch)
        : change.entity === 'person' && 'accountId' in change.patch ? unknownAccount(book, change.patch.accountId)
        : null;
      if (refusal) return refusal;
      const items = list(book, change.entity);
      const index = items.findIndex((item) => item.id === change.id);
      if (index === -1) return GONE;
      const current = items[index]!;
      if (change.expectedUpdatedAt !== undefined && current.updatedAt !== change.expectedUpdatedAt) return CONFLICT;
      const row = { ...merge(current, stripManaged(change.patch)), id: current.id, updatedAt: stamp.now, updatedBy: stamp.actor };
      return write(book, change.entity, index, row);
    }

    case 'delete': {
      // No cascade: rows that point at the deleted one keep their reference, and danglingRefs reports them. An account
      // goes only once its sections have (deleteSectionChanges), so no section is left without its company.
      const items = list(book, change.entity);
      if (!items.some((item) => item.id === change.id)) return GONE;
      if (change.entity === 'account' && book.partners.some((p) => p.accountId === change.id)) return refused(COPY.PARTNER_HAS_TYPES);
      // Nor while a contact still names it: deleteSectionChanges deletes the people first, so no contact is left behind.
      if (change.entity === 'account' && book.people.some((p) => p.accountId === change.id)) return refused(COPY.PARTNER_HAS_CONTACTS);
      return { ok: true, value: withList(book, change.entity, items.filter((item) => item.id !== change.id)), entityId: null };
    }

    case 'setStep':
      return editPartner(book, change.partnerId, stamp, (p) => checkStep(p, change.to), () => ({ step: change.to }));

    case 'markSigned':
      return editPartner(book, change.partnerId, stamp, checkSign, () => ({
        stage: 'onboarding', step: null, signedDate: change.signedDate,
      }));

    case 'setStage':
      return editPartner(book, change.partnerId, stamp, (p) => checkStage(p, change.to), () => ({ stage: change.to }));

    case 'close': {
      const reason = change.reason.trim();
      return withReasonError(editPartner(book, change.partnerId, stamp, (p) => checkClose(p, reason), () => ({ closed: change.as, closedReason: reason })));
    }

    case 'reopen':
      return editPartner(book, change.partnerId, stamp, () => ({ ok: true }), () => ({ closed: null, closedReason: '' }));

    case 'undoSigned':
      // Back to the MAP step, the last one before a signing. Calls, MAP fields and links stay as they are.
      return editPartner(book, change.partnerId, stamp, checkUndoSigned, () => ({ stage: 'recruitment', step: 'map', signedDate: null }));

    case 'correctExit': {
      const reason = change.reason.trim();
      return withReasonError(editPartner(
        book, change.partnerId, stamp,
        (p) => {
          const verdict = checkCorrectExit(p, change.exitedDate);
          if (verdict.ok) return reason === '' ? refused(COPY.REASON_NEEDED) : verdict;
          return verdict.message === COPY.EXIT_DATE_BEFORE_SIGNING ? refused(verdict.message, { exitedDate: verdict.message }) : verdict;
        },
        () => ({ exitedDate: change.exitedDate, exitReason: reason }),
      ));
    }

    case 'setMapSummary': {
      const index = book.partners.findIndex((p) => p.id === change.partnerId);
      if (index === -1) return GONE;
      const current = book.partners[index]!;
      if (change.expectedUpdatedAt !== undefined && current.updatedAt !== change.expectedUpdatedAt) return CONFLICT;
      return write(book, 'partner', index, { ...current, mapHealth: change.health, mapNextMilestone: change.nextMilestone });
    }

    case 'markExited': {
      const reason = change.reason.trim();
      return withReasonError(editPartner(
        book, change.partnerId, stamp,
        (p) => {
          const verdict = checkExit(p, reason);
          if (!verdict.ok) return verdict;
          return p.signedDate !== null && change.exitedDate < p.signedDate
            ? refused(COPY.EXIT_DATE_BEFORE_SIGNING, { exitedDate: COPY.EXIT_DATE_BEFORE_SIGNING })
            : verdict;
        },
        () => ({ stage: 'exit', exitedDate: change.exitedDate, exitReason: reason }),
      ));
    }
  }
}
