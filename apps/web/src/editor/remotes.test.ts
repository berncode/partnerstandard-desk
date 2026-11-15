import { describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  partnerChange: vi.fn(async () => ({ ok: true })),
  partnerImport: vi.fn(async () => ({ ok: true })),
  partnerRemoveType: vi.fn(async () => ({ ok: true })),
  marketChange: vi.fn(async () => ({ ok: true })),
  marketExclusionsImport: vi.fn(async () => ({ ok: true })),
  proposalAccept: vi.fn(async () => ({ ok: true })),
  proposalReject: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/app/(signed-in)/actions/proposals', () => ({ proposalAccept: actions.proposalAccept, proposalReject: actions.proposalReject }));
vi.mock('@/app/(signed-in)/actions/partners', () => ({
  partnerChange: actions.partnerChange, partnerImport: actions.partnerImport, partnerRemoveType: actions.partnerRemoveType,
}));
vi.mock('@/app/(signed-in)/actions/markets', () => ({ marketChange: actions.marketChange, marketExclusionsImport: actions.marketExclusionsImport }));

const { inTransition, marketRemote, partnersRemote } = await import('./remotes');

describe('the remotes', () => {
  it('send a Partner book change, and an import with its market', async () => {
    const change = { kind: 'reopen', partnerId: 'p_1' } as const;
    await partnersRemote.apply(change);
    expect(actions.partnerChange).toHaveBeenCalledWith(change);
    await partnersRemote.applyMany!([change], { marketId: 'm_1' });
    expect(actions.partnerImport).toHaveBeenCalledWith({ marketId: 'm_1', changes: [change] });
  });

  it('send a batch without a market as one import that names none, and a removal by its partner type alone', async () => {
    const add = { kind: 'add', entity: 'account', values: { company: 'Acme' } } as const;
    await partnersRemote.applyMany!([add], {});
    expect(actions.partnerImport).toHaveBeenLastCalledWith({ changes: [add] });
    const removal = [{ kind: 'delete', entity: 'partner', id: 'p_1' }, { kind: 'delete', entity: 'account', id: 'a_1' }] as const;
    await partnersRemote.applyMany!([...removal], { remove: true });
    expect(actions.partnerRemoveType).toHaveBeenCalledWith({ partnerId: 'p_1', expected: ['p_1', 'a_1'] });
  });

  it('send what happens to the business cases with a removal, when the person chose', async () => {
    const removal = [{ kind: 'delete', entity: 'partner', id: 'p_1' }] as const;
    await partnersRemote.applyMany!([...removal], { remove: true, items: 'trash' });
    expect(actions.partnerRemoveType).toHaveBeenLastCalledWith({ partnerId: 'p_1', expected: ['p_1'], items: 'trash' });
    await partnersRemote.applyMany!([...removal], { remove: true, items: 'keep' });
    expect(actions.partnerRemoveType).toHaveBeenLastCalledWith({ partnerId: 'p_1', expected: ['p_1'], items: 'keep' });
  });

  it('send a signing that moves the MAP’s dates as one change with shiftMapDates, and say whether they moved', async () => {
    const sign = { kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-10-20' } as const;
    const snapshot = { value: {}, updatedAt: null, issues: [] };
    actions.partnerChange.mockResolvedValueOnce({ ok: true, snapshot, entityId: null, mapDates: { moved: false, days: -5 } } as never);
    const onMapDates = vi.fn();
    expect(await partnersRemote.applyMany!([sign], { sign: { onMapDates } })).toEqual({ ok: true, snapshot, entityIds: [null] });
    expect(actions.partnerChange).toHaveBeenLastCalledWith(sign, { shiftMapDates: true });
    expect(onMapDates).toHaveBeenCalledWith({ moved: false, days: -5 });
    // A refused signing is the editor's to show: the MAP's dates weren't asked about.
    actions.partnerChange.mockResolvedValueOnce({ ok: false, error: 'invalid', message: 'No' } as never);
    expect(await partnersRemote.applyMany!([sign], { sign: { onMapDates } })).toMatchObject({ ok: false, message: 'No' });
    expect(onMapDates).toHaveBeenCalledTimes(1);
  });

  it('send an answer to a proposal by its id alone; a signing asks for the MAP’s dates; a refusal is heard with its code', async () => {
    const shown = [{ kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' }] as const;
    const snapshot = { value: {}, updatedAt: null, issues: [] };
    actions.proposalAccept.mockResolvedValueOnce({ ok: true, snapshot, entityIds: [], status: 'accepted' } as never);
    expect(await partnersRemote.applyMany!([...shown], { accept: { proposalId: 'prp_1', expectedUpdatedAt: null } }))
      .toEqual({ ok: true, snapshot, entityIds: [null] });
    expect(actions.proposalAccept).toHaveBeenLastCalledWith({ proposalId: 'prp_1', expectedUpdatedAt: null });
    expect(actions.partnerChange).not.toHaveBeenCalledWith(shown[0]);

    const onMapDates = vi.fn();
    actions.proposalAccept.mockResolvedValueOnce({ ok: true, snapshot, entityIds: [], mapDates: { moved: true, days: 10 } } as never);
    await partnersRemote.applyMany!([], { accept: { proposalId: 'prp_2', signedDate: '2026-10-11', sign: { onMapDates } } });
    expect(actions.proposalAccept).toHaveBeenLastCalledWith({ proposalId: 'prp_2', signedDate: '2026-10-11', shiftMapDates: true });
    expect(onMapDates).toHaveBeenCalledWith({ moved: true, days: 10 });

    const onRefused = vi.fn();
    const failure = { ok: false, error: 'conflict', message: 'Updated elsewhere since you opened it' };
    actions.proposalReject.mockResolvedValueOnce(failure as never);
    expect(await partnersRemote.applyMany!([], { reject: { proposalId: 'prp_3', note: 'No', onRefused } })).toEqual(failure);
    expect(actions.proposalReject).toHaveBeenLastCalledWith({ proposalId: 'prp_3', note: 'No' });
    expect(onRefused).toHaveBeenCalledWith(failure);
  });

  it('a 4C accept that adds the Qualification row answers that row’s id at the add’s place, so the next note goes to it', async () => {
    const shown = [
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: 3 } } },
      { kind: 'add', entity: 'qualification', values: { id: 'qualification_tmp1', partnerId: 'p_1', deskNotes: { credibility: 'x' } } },
      { kind: 'update', entity: 'proposalItem', id: 'r_1', patch: { status: 'accepted' } },
    ] as const;
    const snapshot = { value: { qualifications: [{ id: 'q_other', partnerId: 'p_2' }, { id: 'q_saved', partnerId: 'p_1' }] }, updatedAt: null, issues: [] };
    actions.proposalAccept.mockResolvedValueOnce({ ok: true, snapshot, entityIds: [], status: 'accepted' } as never);
    expect(await partnersRemote.applyMany!([...shown] as never, { accept: { proposalId: 'prp_1' } }))
      .toEqual({ ok: true, snapshot, entityIds: [null, 'q_saved', null] });
  });

  it('send a market change for its own market, and a batch of exclusions as one import', async () => {
    const remote = marketRemote('m_1');
    const change = { kind: 'updateInfo', patch: { statusNote: 'x' } } as const;
    await remote.apply(change);
    expect(actions.marketChange).toHaveBeenCalledWith('m_1', change);
    const exclusion = { kind: 'add', entity: 'exclusion', values: { company: 'A' } } as const;
    await remote.applyMany!([exclusion], undefined);
    expect(actions.marketExclusionsImport).toHaveBeenCalledWith('m_1', [exclusion]);
  });

  it('pass a thrown error on, so the editor can offer a retry', async () => {
    await expect(inTransition(async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow('Failed to fetch');
  });
});
