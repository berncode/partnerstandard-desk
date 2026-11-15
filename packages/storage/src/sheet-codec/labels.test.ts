// The label cases for PartnerStandard Desk's lists.
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SIDES, ACTIVITY_STATUSES, CASE_SOURCES, CATEGORIES, EXIT_STATUSES, HYPOTHESIS_ANSWERS, REVIEW_ITEM_KINDS, REVIEW_STATES, ROLES,
  SCORE_KEYS, SIDES,
  CALL_KINDS, CASO_ANSWERS, CHANGE_ENTITIES, CLOSED_AS, HOW_MARKET_BUYS, HYPOTHESIS_STATUSES, LEVELS, MAP_HEALTHS, MARKET_STATUSES,
  PERSON_ROLES, PROPOSAL_FIELDS, PROPOSAL_ITEM_STATUSES, PROPOSAL_KINDS, SOURCES, TARGET_CUSTOMER_TYPES, VALUE_KINDS, VALUE_STATES,
} from '@partner-desk/core';
import {
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  RECRUITMENT_PARTNER_TYPES,
  RECRUITMENT_STEPS,
  STAGES,
  STAGE_LABELS,
  STEP_LABELS,
} from '@partner-desk/method';
import { ENUM_LABELS, labelFor, labelsOf, valueFor, type EnumName } from './labels';

describe('labels', () => {
  it('covers exactly the core enum values, in core order', () => {
    const domain: Record<EnumName, readonly string[]> = {
      partnerType: PARTNER_TYPES, marketPartnerType: RECRUITMENT_PARTNER_TYPES, stage: STAGES, step: RECRUITMENT_STEPS,
      targetCustomerType: TARGET_CUSTOMER_TYPES, closed: CLOSED_AS, source: SOURCES, personRole: PERSON_ROLES,
      callKind: CALL_KINDS, casoAnswer: CASO_ANSWERS, marketStatus: MARKET_STATUSES, howMarketBuys: HOW_MARKET_BUYS,
      valueKind: VALUE_KINDS, valueState: VALUE_STATES, hypothesisStatus: HYPOTHESIS_STATUSES, changeEntity: CHANGE_ENTITIES, level: LEVELS,
      mapHealth: MAP_HEALTHS, mapSide: SIDES, mapActivitySide: ACTIVITY_SIDES, mapCategory: CATEGORIES, mapActivityStatus: ACTIVITY_STATUSES,
      mapRole: ROLES, mapExitStatus: EXIT_STATUSES, reviewState: REVIEW_STATES, scoreKey: SCORE_KEYS, reviewItemKind: REVIEW_ITEM_KINDS,
      hypothesisAnswer: HYPOTHESIS_ANSWERS, caseSource: CASE_SOURCES,
      proposalKind: PROPOSAL_KINDS, proposalField: PROPOSAL_FIELDS, proposalStatus: PROPOSAL_ITEM_STATUSES,
    };
    expect(Object.keys(ENUM_LABELS).sort()).toEqual(Object.keys(domain).sort());
    for (const name of Object.keys(domain) as EnumName[]) expect(Object.keys(ENUM_LABELS[name]), name).toEqual([...domain[name]]);
  });

  it('uses the words from the method package', () => {
    expect(ENUM_LABELS.partnerType).toEqual(PARTNER_TYPE_LABELS);
    expect(ENUM_LABELS.stage).toEqual(STAGE_LABELS);
    expect(ENUM_LABELS.step).toEqual(STEP_LABELS);
    expect(labelsOf('step')).toEqual(['Researched', 'Discovery call', 'Qualification', 'MAP']);
    expect(labelsOf('closed')).toEqual(['Not now', 'No']);
    expect(labelsOf('level')).toEqual(['Registered', 'Preferred']);
    expect(labelsOf('marketStatus')).toEqual(['Open', 'Validated', 'Partly validated', 'Invalidated']);
    expect(labelFor('marketPartnerType', 'var')).toBe('Value Added Reseller');
    expect(labelFor('source', 'existing_partner')).toBe('Existing partner');
    expect(labelsOf('proposalKind')).toEqual(['4C scores', 'Stage', 'Close', 'Signed', 'New partner', 'Hypothesis status', 'Market status']);
    expect(labelsOf('proposalField')).toEqual([
      'Customer base (desk check)', 'Credibility (desk check)', 'Capability (desk check)', 'Commitment (desk check)', 'Step', 'Stage',
      'Close as', 'Signed date', 'New partner', 'Hypothesis status', 'Market status',
    ]);
    expect(labelsOf('proposalStatus')).toEqual(['Waiting', 'Accepted', 'Rejected', 'Withdrawn', 'Replaced', 'Expired', 'Not sent']);
  });

  it('round-trips every value through its label', () => {
    for (const name of Object.keys(ENUM_LABELS) as EnumName[]) {
      for (const value of Object.keys(ENUM_LABELS[name])) expect(valueFor(name, labelFor(name, value)), `${name}.${value}`).toBe(value);
    }
  });

  it('accepts loosely typed input and the ids themselves', () => {
    expect(valueFor('step', ' discovery CALL ')).toBe('discovery_call');
    expect(valueFor('step', 'discovery_call')).toBe('discovery_call');
    expect(valueFor('step', 'discovery')).toBe('discovery_call');
    expect(valueFor('step', 'map')).toBe('map');
    expect(valueFor('stage', 'GROWTH')).toBe('growth');
    expect(valueFor('closed', 'not now')).toBe('not_now');
    expect(valueFor('marketStatus', 'partly-validated')).toBe('partly_validated');
    expect(valueFor('callKind', 'Follow up')).toBe('follow_up');
    expect(valueFor('partnerType', 'VAR')).toBe('var');
    expect(valueFor('partnerType', 'SI')).toBe('system-integrator');
    expect(valueFor('partnerType', 'msp')).toBe('managed');
    expect(valueFor('marketPartnerType', 'SI')).toBe('system-integrator');
    expect(valueFor('targetCustomerType', 'smb')).toBe('smb');
  });

  it('returns null for unknown or empty input', () => {
    expect(valueFor('stage', 'Pending')).toBeNull();
    expect(valueFor('stage', '  ')).toBeNull();
    expect(valueFor('marketPartnerType', 'technology')).toBeNull();
    expect(valueFor('marketPartnerType', 'Technology Partner')).toBeNull();
  });
});
