// The inverse of a change, for the Partner book (its lifecycle changes included) and for a Market.
import {
  COLLECTION, LIFECYCLE_FIELDS, MAP_FIELDS, MARKET_COLLECTION, type InfoPatch, type Market, type MarketChange, type MarketInfo, type PartnerBook,
  type Partner, type PartnerChange, type PartnerEntity,
} from '@partner-desk/core';
import { RECRUITMENT_STEPS, STAGES } from '@partner-desk/method';

/** Fields the app sets; an undo of an update never carries them. */
const MANAGED = new Set(['id', 'updatedAt', 'updatedBy']);
/**
 * Left off an add that puts a deleted row back. `id` is still sent, as the provisional id other adds carry.
 * A section's lifecycle fields and `companyId` are left off too: an add may not set them (`USE_OWN_CHANGES`; the book
 * owns `companyId`). The commands after the add put the lifecycle back. The MAP fields are left off too (only MAP
 * commands write them); the next health refresh fills them again.
 */
const OMIT_ON_RESTORE = new Set<string>(['updatedAt', 'updatedBy', 'companyId', ...MAP_FIELDS, ...LIFECYCLE_FIELDS]);

type Row = { id: string } & Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What `previous` held at the places `patch` names: for an object field, only the sub-fields the patch sets. */
function restore(previous: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch) || !isPlainObject(previous)) return previous;
  return Object.fromEntries(Object.keys(patch).map((key) => [key, restore(previous[key], patch[key])]));
}

/** The patch that puts back what `patch` changed on `previous`. */
function restorePatch(previous: Row, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) if (!MANAGED.has(key)) out[key] = restore(previous[key], patch[key]);
  return out;
}

/** An add of the account, section or person `id` named, as `before` had it, or null when that row is not there. */
function restoreRow(before: PartnerBook, entity: PartnerEntity, id: string): PartnerChange | null {
  if (entity !== 'account' && entity !== 'partner' && entity !== 'person') return null;
  const previous = (before[COLLECTION[entity]] as unknown as Row[]).find((row) => row.id === id);
  if (!previous) return null;
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(previous)) if (!OMIT_ON_RESTORE.has(key)) values[key] = value;
  return { kind: 'add', entity, values };
}

/** Signing again with the date `previous` had, then one stage at a time up to its stage (signing lands in Onboarding). */
function signAgain(previous: Partner & { signedDate: string }): PartnerChange[] {
  const steps: PartnerChange[] = [{ kind: 'markSigned', partnerId: previous.id, signedDate: previous.signedDate }];
  const from = STAGES.indexOf('onboarding');
  const to = STAGES.indexOf(previous.stage);
  for (let i = from + 1; i <= to; i += 1) steps.push({ kind: 'setStage', partnerId: previous.id, to: STAGES[i]! });
  return steps;
}

/**
 * The add of a section, then the commands that reach its previous lifecycle from a new section (recruitment,
 * researched, open, unsigned). A close follows the steps, because a step move is refused while closed. An exit
 * follows the signing and sets the stage itself, so the stages are not walked.
 */
function restoreSection(before: PartnerBook, id: string): PartnerChange[] | null {
  const previous = before.partners.find((p) => p.id === id);
  const add = restoreRow(before, 'partner', id);
  if (!previous || !add) return null;
  const steps: PartnerChange[] = [add];
  if (previous.exitedDate && previous.signedDate) {
    steps.push({ kind: 'markSigned', partnerId: id, signedDate: previous.signedDate });
    steps.push({ kind: 'markExited', partnerId: id, exitedDate: previous.exitedDate, reason: previous.exitReason });
    return steps;
  }
  if (previous.signedDate) {
    steps.push(...signAgain({ ...previous, signedDate: previous.signedDate }));
    return steps;
  }
  if (previous.step && previous.step !== 'researched') {
    const to = RECRUITMENT_STEPS.indexOf(previous.step);
    for (let i = 1; i <= to; i += 1) steps.push({ kind: 'setStep', partnerId: id, to: RECRUITMENT_STEPS[i]! });
  }
  if (previous.closed) steps.push({ kind: 'close', partnerId: id, as: previous.closed, reason: previous.closedReason });
  return steps;
}

/**
 * The change that undoes `change`, given the Partner book as it was before it, or null when there is none. `entityId`
 * is the id an add created. A delete of a call, a qualification or a market link has no inverse: the editor holds a
 * single delete back for the undo window. An exit has none either. Undoing a signing signs again with the date the
 * section had, then walks the stages back up to the one it was in. Undoing an exit correction puts the old date and reason back. Undoing a delete of an account or a
 * person adds that row back. Undoing a delete of a section adds it back, then the commands that restore its lifecycle.
 */
export function partnerInverse(change: PartnerChange, before: PartnerBook, entityId: string | null = null): PartnerChange | PartnerChange[] | null {
  const partner = (id: string) => before.partners.find((p) => p.id === id);
  switch (change.kind) {
    case 'add':
      return entityId ? { kind: 'delete', entity: change.entity, id: entityId } : null;
    case 'update': {
      const previous = (before[COLLECTION[change.entity]] as unknown as Row[]).find((row) => row.id === change.id);
      return previous ? { kind: 'update', entity: change.entity, id: change.id, patch: restorePatch(previous, change.patch) } : null;
    }
    case 'delete':
      return change.entity === 'partner' ? restoreSection(before, change.id) : restoreRow(before, change.entity, change.id);
    case 'markSigned': {
      const p = partner(change.partnerId);
      return p ? { kind: 'undoSigned', partnerId: p.id } : null;
    }
    case 'markExited':
      return null;
    case 'undoSigned': {
      // Signing again lands in Onboarding: the stages after it are walked back too, so a Growth partner is in Growth again.
      const p = partner(change.partnerId);
      if (!p?.signedDate) return null;
      const steps = signAgain({ ...p, signedDate: p.signedDate });
      return steps.length === 1 ? steps[0]! : steps;
    }
    case 'correctExit': {
      const p = partner(change.partnerId);
      return p?.exitedDate ? { kind: 'correctExit', partnerId: p.id, exitedDate: p.exitedDate, reason: p.exitReason } : null;
    }
    case 'setStep': {
      const p = partner(change.partnerId);
      return p?.step ? { kind: 'setStep', partnerId: p.id, to: p.step } : null;
    }
    case 'setStage': {
      const p = partner(change.partnerId);
      return p ? { kind: 'setStage', partnerId: p.id, to: p.stage } : null;
    }
    case 'close': {
      const p = partner(change.partnerId);
      if (!p) return null;
      return p.closed ? { kind: 'close', partnerId: p.id, as: p.closed, reason: p.closedReason } : { kind: 'reopen', partnerId: p.id };
    }
    case 'reopen': {
      const p = partner(change.partnerId);
      return p?.closed ? { kind: 'close', partnerId: p.id, as: p.closed, reason: p.closedReason } : null;
    }
    case 'setMapSummary':
      // Written by the MAP commands only, never by a screen's edit: there is nothing to undo.
      return null;
  }
}

/**
 * The change that undoes `change`, given the market as it was before it, or null when there is none. `entityId` is the
 * id an add created. Deletes have no inverse: the editor holds them back for the undo window instead.
 */
export function marketInverse(change: MarketChange, before: Market, entityId: string | null = null): MarketChange | null {
  switch (change.kind) {
    case 'updateInfo': {
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(change.patch)) if (!MANAGED.has(key)) patch[key] = before.info[key as keyof MarketInfo];
      // The edit cleared the flags of the fields it named; undo puts them back.
      if (!('checkAgain' in patch) && before.info.checkAgain.some((field) => field in change.patch)) patch.checkAgain = before.info.checkAgain;
      return { kind: 'updateInfo', patch: patch as InfoPatch };
    }
    case 'add':
      return entityId ? { kind: 'delete', entity: change.entity, id: entityId } : null;
    case 'update': {
      const previous = (before[MARKET_COLLECTION[change.entity]] as unknown as Row[]).find((row) => row.id === change.id);
      if (!previous) return null;
      const patch = restorePatch(previous, change.patch);
      // Editing a value point or hypothesis clears its check-again flag; undo restores it.
      if ((change.entity === 'valuePoint' || change.entity === 'hypothesis') && previous.checkAgain === true) patch.checkAgain = true;
      return { kind: 'update', entity: change.entity, id: change.id, patch };
    }
    case 'delete':
      return null;
    case 'clearCheckAgain': {
      const { target } = change;
      if (target.entity === 'market') return { kind: 'updateInfo', patch: { checkAgain: before.info.checkAgain } };
      const previous = (before[MARKET_COLLECTION[target.entity]] as unknown as Row[]).find((row) => row.id === target.id);
      return previous ? { kind: 'update', entity: target.entity, id: target.id, patch: { checkAgain: previous.checkAgain } } : null;
    }
  }
}
