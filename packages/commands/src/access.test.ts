import { describe, expect, it } from 'vitest';
import type { MarketChange, PartnerChange } from '@partner-desk/core';
import {
  can, COMMAND_NAMES, DECISION_CHANGES, DECISION_COMMANDS, isDecision, isMarketDecision, OWNER_ONLY_COMMANDS, READ_COMMANDS, type CommandName,
} from './access';
import type { WorkspaceRole } from '@partner-desk/core';
import { withProposal, type Actor } from './actor';

const mine = { ownerUserId: 'u1' };
const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const agent = (level: 'read' | 'change' | 'propose'): Actor => ({
  kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' },
});
const ALL: CommandName[] = ['partners.read', 'partners.change', 'partners.import', 'partners.remove', 'markets.read', 'markets.create', 'markets.change', 'markets.copy', 'partners.recreate', 'markets.list', 'markets.archive', 'company.rename',
  'companyFacts.read', 'companyFacts.save', 'programs.list', 'programs.read', 'programs.create', 'programs.save', 'programs.delete',
  'programs.refreshOutputs', 'cases.list', 'cases.read', 'cases.create', 'cases.save', 'cases.copy', 'cases.recalculate', 'cases.delete',
  'cases.share', 'cases.unshare', 'maps.list', 'maps.read', 'maps.start', 'maps.change', 'maps.delete', 'maps.share', 'maps.revoke',
  'maps.shiftDates', 'company.timezone', 'maps.notify', 'reviews.list', 'reviews.read', 'reviews.open', 'reviews.close', 'reviews.share',
  'reviews.revoke', 'week.read', 'webhooks.list', 'webhooks.create', 'webhooks.delete', 'webhooks.test', 'webhooks.deliveries',
  'webhooks.turnOff', 'webhooks.turnOn', 'webhooks.resend',
  'proposals.create', 'proposals.list', 'proposals.withdraw', 'proposals.accept', 'proposals.reject', 'files.export',
  'members.list', 'members.setRole', 'members.remove', 'invites.list', 'invites.create', 'invites.cancel', 'company.read', 'maps.notifyRead',
  'trash.list', 'trash.restore'];
/** A company server's members and invites: never without a member (plan 15). */
const MEMBERS: CommandName[] = ['members.list', 'members.setRole', 'members.remove', 'invites.list', 'invites.create', 'invites.cancel'];
/** Commands only an agent at propose may run; a person never proposes. */
const PROPOSING: CommandName[] = ['proposals.create', 'proposals.withdraw'];
const link: Actor = { kind: 'link', userId: 'u1', linkId: 'ml_1', mapId: 'map_1', personId: 'p_1', side: 'partner', name: 'Lena' };

describe('can', () => {
  it('lets the owner do everything', () => {
    const needChange: CommandName[] = ['partners.change', 'partners.import', 'partners.remove', 'markets.change'];
    for (const command of ALL.filter((c) => !needChange.includes(c) && !PROPOSING.includes(c) && !MEMBERS.includes(c))) expect(can(owner, command, mine)).toBe(true);
    expect(can(owner, 'markets.change', mine, { kind: 'updateInfo', patch: { status: 'validated' } })).toBe(true);
    expect(can(owner, 'partners.import', mine, { kind: 'add', entity: 'partner', values: { company: 'Acme' } })).toBe(true);
    expect(can(owner, 'partners.change', mine, { kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-01-01' })).toBe(true);
  });
  it('refuses another user', () => {
    const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
    for (const command of ALL) expect(can(other, command, mine)).toBe(false);
    expect(can({ ...agent('change'), userId: 'u2' }, 'partners.read', mine)).toBe(false);
  });
  it('fails closed when a partner change, import or market change names no change', () => {
    expect(can(owner, 'partners.change', mine)).toBe(false);
    expect(can(agent('change'), 'partners.import', mine)).toBe(false);
    expect(can(owner, 'markets.change', mine)).toBe(false);
    expect(can(agent('change'), 'markets.change', mine)).toBe(false);
  });
  it('lets only the owner remove a partner type, and fails closed without the partner type', () => {
    const removal = { kind: 'delete', entity: 'partner', id: 'p_1' } as const;
    expect(can(owner, 'partners.remove', mine, removal)).toBe(true);
    expect(can(owner, 'partners.remove', mine)).toBe(false);
    for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), 'partners.remove', mine, removal)).toBe(false);
  });
  it('never lets an agent delete a partner', () => {
    expect(can(agent('change'), 'partners.change', mine, { kind: 'delete', entity: 'partner', id: 'p_1' })).toBe(false);
    expect(can(agent('change'), 'partners.change', mine, { kind: 'delete', entity: 'call', id: 'k_1' })).toBe(true);
    expect(can(owner, 'partners.change', mine, { kind: 'delete', entity: 'partner', id: 'p_1' })).toBe(true);
  });
  it('lets an agent read', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(can(agent(level), 'partners.read', mine)).toBe(true);
      expect(can(agent(level), 'markets.read', mine)).toBe(true);
    }
  });
  it('lets an agent list markets at any level, but never recreate a book', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(can(agent(level), 'markets.list', mine)).toBe(true);
      expect(can(agent(level), 'partners.recreate', mine)).toBe(false);
    }
    expect(can(owner, 'partners.recreate', mine)).toBe(true);
  });
  it('never lets an agent archive a market or rename the company', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(can(agent(level), 'markets.archive', mine)).toBe(false);
      expect(can(agent(level), 'company.rename', mine)).toBe(false);
    }
  });
  it('lets a change-level agent update a call', () => {
    const change = { kind: 'update', entity: 'call', id: 'k_1', patch: { notes: 'x' } } as const;
    expect(can(agent('change'), 'partners.change', mine, change)).toBe(true);
    expect(can(agent('change'), 'markets.create', mine)).toBe(true);
    expect(can(agent('read'), 'partners.change', mine, change)).toBe(false);
    expect(can(agent('propose'), 'partners.change', mine, change)).toBe(true);
    expect(can(agent('read'), 'markets.create', mine)).toBe(false);
  });
  it('never lets an agent sign, close, exit, undo a signing or correct an exit', () => {
    const decisions = [
      { kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' },
      { kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-01-01' },
      { kind: 'setStage', partnerId: 'p_1', to: 'onboarding' },
      { kind: 'close', partnerId: 'p_1', as: 'no', reason: 'x' },
      { kind: 'reopen', partnerId: 'p_1' },
      { kind: 'markExited', partnerId: 'p_1', exitedDate: '2026-01-01', reason: 'x' },
      { kind: 'undoSigned', partnerId: 'p_1' },
      { kind: 'correctExit', partnerId: 'p_1', exitedDate: '2026-02-01', reason: 'x' },
    ] as const;
    expect(decisions.map((d) => d.kind).sort()).toEqual([...DECISION_CHANGES].sort());
    for (const d of decisions) {
      for (const level of ['change', 'propose'] as const) expect(can(agent(level), 'partners.change', mine, d)).toBe(false);
      expect(can(owner, 'partners.change', mine, d)).toBe(true);
    }
  });
  it('lets an agent read Company facts and programs at any level', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      for (const command of ['companyFacts.read', 'programs.list', 'programs.read'] as const) expect(can(agent(level), command, mine)).toBe(true);
    }
  });
  it('lets program and Company facts writes follow the grant', () => {
    const writes = ['companyFacts.save', 'programs.create', 'programs.save', 'programs.refreshOutputs'] as const;
    for (const command of writes) {
      expect(can(owner, command, mine)).toBe(true);
      expect(can(agent('change'), command, mine)).toBe(true);
      expect(can(agent('read'), command, mine)).toBe(false);
      expect(can(agent('propose'), command, mine)).toBe(true);
    }
  });
  it('lets an agent list and read business cases at any level', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      for (const command of ['cases.list', 'cases.read'] as const) expect(can(agent(level), command, mine)).toBe(true);
    }
  });
  it('lets business case changes follow the grant, turning a link off included', () => {
    const writes = ['cases.create', 'cases.save', 'cases.copy', 'cases.recalculate', 'cases.unshare'] as const;
    for (const command of writes) {
      expect(can(owner, command, mine)).toBe(true);
      expect(can(agent('change'), command, mine)).toBe(true);
      expect(can(agent('read'), command, mine)).toBe(false);
      expect(can(agent('propose'), command, mine)).toBe(true);
    }
  });
  it('treats sharing and deleting a business case as decisions: a person only', () => {
    for (const command of ['cases.share', 'cases.delete'] as const) {
      expect(can(owner, command, mine)).toBe(true);
      for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), command, mine)).toBe(false);
    }
  });
  it('treats deleting a program as a decision: a person only', () => {
    expect(DECISION_COMMANDS).toEqual(['programs.delete', 'cases.share', 'cases.delete', 'maps.share', 'maps.delete', 'reviews.close', 'reviews.share']);
    expect(can(owner, 'programs.delete', mine)).toBe(true);
    for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), 'programs.delete', mine)).toBe(false);
  });

  it('keeps the timezone and a MAP’s email settings to the person', () => {
    for (const command of ['company.timezone', 'maps.notify'] as const) {
      expect(can(owner, command, mine)).toBe(true);
      for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), command, mine)).toBe(false);
      expect(can(link, command, { ...mine, mapId: 'map_1' })).toBe(false);
    }
  });

  it('keeps a database file’s download to the person: no agent, no link', () => {
    expect(can(owner, 'files.export', mine)).toBe(true);
    for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), 'files.export', mine)).toBe(false);
    expect(can(link, 'files.export', { ...mine, mapId: 'map_1' })).toBe(false);
  });

  it('names every command', () => {
    expect([...COMMAND_NAMES].sort()).toEqual([...ALL].sort());
  });
  it('lets an agent list webhooks and their deliveries at any level, and add, delete, test and turn them off and on at level change only', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      for (const command of ['webhooks.list', 'webhooks.deliveries'] as const) expect(can(agent(level), command, mine)).toBe(true);
    }
    expect(can(link, 'webhooks.deliveries', mine)).toBe(false);
    for (const command of ['webhooks.create', 'webhooks.delete', 'webhooks.test', 'webhooks.turnOff', 'webhooks.turnOn'] as const) {
      expect(can(owner, command, mine)).toBe(true);
      expect(can(agent('change'), command, mine)).toBe(true);
      expect(can(agent('read'), command, mine)).toBe(false);
      expect(can(agent('propose'), command, mine)).toBe(true);
      expect(can(link, command, mine)).toBe(false);
    }
  });
  it('webhooks.resend is owner only', () => {
    expect(OWNER_ONLY_COMMANDS).toContain('webhooks.resend');
    expect(READ_COMMANDS).not.toContain('webhooks.resend');
    expect(can(owner, 'webhooks.resend', mine)).toBe(true);
    for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), 'webhooks.resend', mine)).toBe(false);
    expect(can(link, 'webhooks.resend', mine)).toBe(false);
    expect(can({ ...owner, userId: 'u2' }, 'webhooks.resend', mine)).toBe(false);
  });
  it('lets an agent list and read MAPs at any level, and start, change and revoke links at level change', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      for (const command of ['maps.list', 'maps.read'] as const) expect(can(agent(level), command, mine)).toBe(true);
    }
    for (const command of ['maps.start', 'maps.change', 'maps.revoke'] as const) {
      expect(can(owner, command, mine)).toBe(true);
      expect(can(agent('change'), command, mine)).toBe(true);
      expect(can(agent('read'), command, mine)).toBe(false);
      expect(can(agent('propose'), command, mine)).toBe(true);
    }
  });
  it('treats sharing and deleting a MAP as decisions, and moving its dates as the owner’s only', () => {
    for (const command of ['maps.share', 'maps.delete', 'maps.shiftDates'] as const) {
      expect(can(owner, command, mine)).toBe(true);
      for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), command, mine)).toBe(false);
    }
  });
  it('lets an agent read reviews and This week at any level, open a review and revoke its summary at level change, and only propose closing and sharing', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      for (const command of ['reviews.list', 'reviews.read', 'week.read'] as const) expect(can(agent(level), command, mine)).toBe(true);
      for (const command of ['reviews.close', 'reviews.share'] as const) expect(can(agent(level), command, mine)).toBe(false);
    }
    for (const command of ['reviews.open', 'reviews.revoke'] as const) {
      expect(can(owner, command, mine)).toBe(true);
      expect(can(agent('change'), command, mine)).toBe(true);
      expect(can(agent('read'), command, mine)).toBe(false);
      expect(can(agent('propose'), command, mine)).toBe(true);
    }
    for (const command of ['reviews.close', 'reviews.share'] as const) expect(can(owner, command, mine)).toBe(true);
  });
  it('lets a person with a link only read and change their own MAP', () => {
    const theirs = { ownerUserId: 'u1', mapId: 'map_1' };
    expect(can(link, 'maps.read', theirs)).toBe(true);
    expect(can(link, 'maps.change', theirs)).toBe(true);
    expect(can(link, 'maps.read', { ownerUserId: 'u1', mapId: 'map_2' })).toBe(false);
    expect(can(link, 'maps.change', { ownerUserId: 'u1', mapId: 'map_2' })).toBe(false);
    expect(can(link, 'maps.read', mine)).toBe(false);
    expect(can(link, 'maps.read', { ownerUserId: 'u2', mapId: 'map_1' })).toBe(false);
    for (const command of ALL.filter((c) => c !== 'maps.read' && c !== 'maps.change')) {
      expect(can(link, command, theirs, { kind: 'updateInfo', patch: { marketName: 'x' } })).toBe(false);
      expect(can(link, command, theirs, { kind: 'update', entity: 'call', id: 'k_1', patch: { notes: 'x' } })).toBe(false);
      expect(can(link, command, theirs)).toBe(false);
    }
  });

  describe('the decisions, refused to every agent', () => {
    const levels = ['change', 'propose'] as const;
    const partnerUpdate = (patch: Record<string, unknown>): PartnerChange => ({ kind: 'update', entity: 'partner', id: 'p_1', patch });
    it('can refuses every agent a desk score', () => {
      const change = partnerUpdate({ desk: { credibility: 3 } });
      expect(isDecision(change)).toBe(true);
      for (const level of levels) expect(can(agent(level), 'partners.change', mine, change)).toBe(false);
      expect(can(owner, 'partners.change', mine, change)).toBe(true);
    });
    it('can refuses every agent a confirmed score', () => {
      const change = partnerUpdate({ confirmed: { commitment: 2 } });
      expect(isDecision(change)).toBe(true);
      for (const level of levels) expect(can(agent(level), 'partners.change', mine, change)).toBe(false);
      expect(can(owner, 'partners.change', mine, change)).toBe(true);
      const both: PartnerChange = { kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'reseller', desk: { capability: 1 } } };
      for (const level of levels) expect(can(agent(level), 'partners.change', mine, both)).toBe(false);
    });
    it('can still lets an agent change a partner type’s other fields', () => {
      const change = partnerUpdate({ whyItFits: 'Strong in Austria', notes: { credibility: 'Two references' } });
      expect(isDecision(change)).toBe(false);
      for (const level of levels) expect(can(agent(level), 'partners.change', mine, change)).toBe(true);
    });
    it('can refuses every agent an import', () => {
      const change: PartnerChange = { kind: 'add', entity: 'account', values: { company: 'Acme' } };
      for (const level of ['read', ...levels] as const) expect(can(agent(level), 'partners.import', mine, change)).toBe(false);
      const call: PartnerChange = { kind: 'add', entity: 'call', values: { notes: 'x' } };
      for (const level of levels) expect(can(agent(level), 'partners.import', mine, call)).toBe(false);
      expect(can(owner, 'partners.import', mine, change)).toBe(true);
    });
    it('can refuses every agent adding a partner or an account through partners.change', () => {
      const adds: PartnerChange[] = [
        { kind: 'add', entity: 'account', values: { company: 'Acme' } },
        { kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'reseller' } },
      ];
      for (const change of adds) {
        expect(isDecision(change)).toBe(true);
        for (const level of levels) expect(can(agent(level), 'partners.change', mine, change)).toBe(false);
        expect(can(owner, 'partners.change', mine, change)).toBe(true);
      }
      const person: PartnerChange = { kind: 'add', entity: 'person', values: { accountId: 'a_1', name: 'Lena' } };
      expect(isDecision(person)).toBe(false);
      for (const level of levels) expect(can(agent(level), 'partners.change', mine, person)).toBe(true);
      const account: PartnerChange = { kind: 'update', entity: 'account', id: 'a_1', patch: { website: 'acme.at' } };
      for (const level of levels) expect(can(agent(level), 'partners.change', mine, account)).toBe(true);
    });
    it('can refuses every agent a hypothesis status', () => {
      const changes = [
        marketChange({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { status: 'holds' } }),
        marketChange({ kind: 'add', entity: 'hypothesis', values: { name: 'Banks', status: 'holds' } }),
      ];
      for (const change of changes) {
        expect(isMarketDecision(change)).toBe(true);
        for (const level of levels) expect(can(agent(level), 'markets.change', mine, change)).toBe(false);
        expect(can(owner, 'markets.change', mine, change)).toBe(true);
      }
      const texts = marketChange({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { theirSide: 'More margin' } });
      expect(isMarketDecision(texts)).toBe(false);
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, texts)).toBe(true);
      const draft = marketChange({ kind: 'add', entity: 'hypothesis', values: { name: 'Banks' } });
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, draft)).toBe(true);
    });
    it('can refuses every agent deleting a hypothesis: dropping one is the person\'s decision', () => {
      const change = marketChange({ kind: 'delete', entity: 'hypothesis', id: 'h_1' });
      expect(isMarketDecision(change)).toBe(true);
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, change)).toBe(false);
      expect(can(owner, 'markets.change', mine, change)).toBe(true);
      const valuePoint = marketChange({ kind: 'delete', entity: 'valuePoint', id: 'v_1' });
      expect(isMarketDecision(valuePoint)).toBe(false);
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, valuePoint), level).toBe(true);
    });
    it('can refuses every agent a market status', () => {
      const change = marketChange({ kind: 'updateInfo', patch: { status: 'validated' } });
      expect(isMarketDecision(change)).toBe(true);
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, change)).toBe(false);
      expect(can(owner, 'markets.change', mine, change)).toBe(true);
      const texts = marketChange({ kind: 'updateInfo', patch: { marketName: 'Austria' } });
      expect(isMarketDecision(texts)).toBe(false);
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, texts)).toBe(true);
      expect(can(agent('read'), 'markets.change', mine, texts)).toBe(false);
      const note = marketChange({ kind: 'updateInfo', patch: { statusNote: 'Three banks said yes' } });
      expect(isMarketDecision(note)).toBe(true);
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, note)).toBe(false);
      expect(can(owner, 'markets.change', mine, note)).toBe(true);
      const exclusion = marketChange({ kind: 'add', entity: 'exclusion', values: { company: 'Evil Inc' } });
      for (const level of levels) expect(can(agent(level), 'markets.change', mine, exclusion)).toBe(true);
    });
    it('can refuses every agent a market made with a status, and lets it make one without', () => {
      const decided = marketChange({ kind: 'updateInfo', patch: { marketName: 'Austria', status: 'validated' } });
      const plain = marketChange({ kind: 'updateInfo', patch: { marketName: 'Austria' } });
      for (const level of levels) {
        expect(can(agent(level), 'markets.create', mine, decided)).toBe(false);
        expect(can(agent(level), 'markets.create', mine, plain)).toBe(true);
      }
      expect(can(agent('read'), 'markets.create', mine, plain)).toBe(false);
      expect(can(owner, 'markets.create', mine, decided)).toBe(true);
    });
    it('can refuses every agent any write of a Proposals row: only the proposal commands write those, as the owner', () => {
      const writes: PartnerChange[] = [
        { kind: 'add', entity: 'proposalItem', values: { proposalId: 'pr_1' } },
        { kind: 'update', entity: 'proposalItem', id: 'pi_1', patch: { status: 'accepted' } },
        { kind: 'delete', entity: 'proposalItem', id: 'pi_1' },
      ];
      for (const change of writes) {
        expect(isDecision(change)).toBe(true);
        for (const level of levels) expect(can(agent(level), 'partners.change', mine, change)).toBe(false);
        expect(can(owner, 'partners.change', mine, change)).toBe(true);
      }
    });
    it('can refuses every agent a step, a stage, a signing and a close, as before', () => {
      const changes: PartnerChange[] = [
        { kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' },
        { kind: 'setStage', partnerId: 'p_1', to: 'onboarding' },
        { kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-01-01' },
        { kind: 'close', partnerId: 'p_1', as: 'no', reason: 'x' },
      ];
      for (const change of changes) {
        expect(isDecision(change)).toBe(true);
        for (const level of levels) expect(can(agent(level), 'partners.change', mine, change)).toBe(false);
      }
    });
  });

  it('a propose-level agent may do what a change-level agent may, and propose and withdraw; a change-level agent may not propose', () => {
    const call: PartnerChange = { kind: 'update', entity: 'call', id: 'k_1', patch: { notes: 'x' } };
    for (const command of ALL) {
      const change = command === 'markets.change' ? marketChange({ kind: 'updateInfo', patch: { marketName: 'x' } })
        : command.startsWith('partners.') ? call : undefined;
      if (PROPOSING.includes(command)) continue;
      expect(can(agent('propose'), command, mine, change)).toBe(can(agent('change'), command, mine, change));
    }
    for (const command of PROPOSING) {
      expect(can(agent('propose'), command, mine)).toBe(true);
      expect(can(agent('change'), command, mine)).toBe(false);
      expect(can(agent('read'), command, mine)).toBe(false);
      expect(can({ ...agent('propose'), userId: 'u2' }, command, mine)).toBe(false);
    }
    for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), 'proposals.list', mine)).toBe(true);
    expect(READ_COMMANDS).toContain('proposals.list');
  });

  it('a person may not propose; only the owner accepts or rejects', () => {
    for (const command of PROPOSING) {
      expect(can(owner, command, mine)).toBe(false);
      expect(can(link, command, { ...mine, mapId: 'map_1' })).toBe(false);
    }
    expect(can(owner, 'proposals.list', mine)).toBe(true);
    for (const command of ['proposals.accept', 'proposals.reject'] as const) {
      expect(OWNER_ONLY_COMMANDS).toContain(command);
      expect(can(owner, command, mine)).toBe(true);
      expect(can(withProposal({ kind: 'owner', userId: 'u1', displayName: 'Ruth' }, { id: 'pr_1', agentName: 'Claude' }), command, mine)).toBe(true);
      for (const level of ['read', 'change', 'propose'] as const) expect(can(agent(level), command, mine)).toBe(false);
      expect(can(link, command, { ...mine, mapId: 'map_1' })).toBe(false);
      expect(can({ ...owner, userId: 'u2' }, command, mine)).toBe(false);
    }
  });
});

const marketChange = (change: MarketChange) => change;

describe('can by role on a company server (plan 15, task 3)', () => {
  const ws = { ownerUserId: 'ws_aaaaaaaaaa' };
  const as = (role: WorkspaceRole): Actor => ({ kind: 'owner', userId: 'ws_aaaaaaaaaa', displayName: 'Anna', member: { personId: 'u_anna', role } });
  const agentAs = (role: WorkspaceRole, level: 'read' | 'change' | 'propose'): Actor => ({
    kind: 'agent', userId: 'ws_aaaaaaaaaa', displayName: 'Anna', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' },
    member: { personId: 'u_anna', role },
  });
  const hostedOwner: Actor = { kind: 'owner', userId: 'ws_aaaaaaaaaa', displayName: 'Anna' };
  const hostedAgent = (level: 'read' | 'change' | 'propose'): Actor => ({
    kind: 'agent', userId: 'ws_aaaaaaaaaa', displayName: 'Anna', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' },
  });
  /** A change that isn't a decision, for the commands judged change by change. */
  const changeFor = (command: CommandName): PartnerChange | MarketChange | undefined => {
    if (command === 'markets.change') return { kind: 'updateInfo', patch: { marketName: 'DACH' } };
    if (command === 'partners.change' || command === 'partners.import') return { kind: 'add', entity: 'person', values: { accountId: 'a_1', name: 'Lena' } };
    if (command === 'partners.remove') return { kind: 'delete', entity: 'person', id: 'e_1' };
    return undefined;
  };
  const allowed = (actor: Actor) => COMMAND_NAMES.filter((c) => can(actor, c, ws, changeFor(c)));

  // Written out, not taken from access.ts: the table is the spec's (§7.1).
  const VIEWER: CommandName[] = [
    'partners.read', 'markets.read', 'markets.list', 'companyFacts.read', 'programs.list', 'programs.read', 'cases.list', 'cases.read', 'maps.list',
    'maps.read', 'reviews.list', 'reviews.read', 'week.read', 'webhooks.list', 'webhooks.deliveries', 'proposals.list', 'members.list', 'files.export',
    'company.read', 'maps.notifyRead', 'webhooks.turnOff', 'webhooks.delete',
  ];
  const ADMIN_ONLY: CommandName[] = [
    'members.setRole', 'members.remove', 'invites.list', 'invites.create', 'invites.cancel', 'company.rename', 'company.timezone',
    'trash.list', 'trash.restore',
  ];

  it('nobody without a member manages members or invites: hosted, a test user, a link (plan 15)', () => {
    for (const command of MEMBERS) {
      expect(can(hostedOwner, command, ws)).toBe(false);
      expect(can(hostedAgent('propose'), command, ws)).toBe(false);
      expect(can({ ...link, userId: 'ws_aaaaaaaaaa' }, command, { ...ws, mapId: 'map_1' })).toBe(false);
    }
  });

  it('an admin may all a hosted owner may, and the members and invites', () => {
    expect(allowed(as('admin'))).toEqual([...allowed(hostedOwner), ...MEMBERS].sort((a, b) => COMMAND_NAMES.indexOf(a) - COMMAND_NAMES.indexOf(b)));
    for (const command of ADMIN_ONLY) expect(allowed(as('admin'))).toContain(command);
  });

  it('a partner manager may all but the admin’s commands', () => {
    expect(allowed(as('partnerManager'))).toEqual(allowed(hostedOwner).filter((c) => !ADMIN_ONLY.includes(c)).concat('members.list')
      .sort((a, b) => COMMAND_NAMES.indexOf(a) - COMMAND_NAMES.indexOf(b)));
    expect(allowed(as('partnerManager'))).toContain('partners.change');
    expect(allowed(as('partnerManager'))).toContain('proposals.accept');
    expect(allowed(as('partnerManager'))).toContain('webhooks.create');
  });

  it('a viewer reads, sees the members, downloads a file and stops their own webhooks, and changes nothing', () => {
    expect(allowed(as('viewer')).sort()).toEqual([...VIEWER].sort());
    expect(can(as('viewer'), 'markets.change', ws, { kind: 'updateInfo', patch: { status: 'validated' } })).toBe(false);
    expect(can(as('viewer'), 'partners.change', ws, { kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-01-01' })).toBe(false);
  });

  it('an agent acts within its member’s role: a viewer’s agent reads only, at any level', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      const reads = allowed(hostedAgent(level)).filter((c) => READ_COMMANDS.includes(c));
      expect(allowed(agentAs('viewer', level))).toEqual(reads);
      expect(allowed(agentAs('partnerManager', level))).toEqual(allowed(hostedAgent(level)));
      expect(allowed(agentAs('admin', level))).toEqual(allowed(hostedAgent(level)));
    }
    expect(allowed(agentAs('viewer', 'propose'))).not.toContain('proposals.create');
  });

  it('no agent manages members or invites, or reads the members list, at any role or level', () => {
    for (const role of ['admin', 'partnerManager', 'viewer'] as const) {
      for (const level of ['read', 'change', 'propose'] as const) {
        for (const command of ['members.list', 'company.read', 'maps.notifyRead', ...ADMIN_ONLY] as const) expect(can(agentAs(role, level), command, ws)).toBe(false);
      }
    }
  });

  it('still refuses another workspace, whatever the role', () => {
    expect(COMMAND_NAMES.filter((c) => can(as('admin'), c, mine, changeFor(c)))).toEqual([]);
  });
});
