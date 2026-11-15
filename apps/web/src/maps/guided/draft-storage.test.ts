// @vitest-environment jsdom
import { newMapPlan } from '@partner-desk/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, draftKey, loadDraft, saveDraft } from './draft-storage';

const draft = newMapPlan({ partnerId: 'p_1', partnerType: 'reseller', contacts: [] });

beforeEach(() => sessionStorage.clear());

describe('the guided draft in sessionStorage', () => {
  it('keeps a draft and its step per MAP, and clears it', () => {
    saveDraft(sessionStorage, 'map_a', { draft, index: 2 });
    expect(loadDraft(sessionStorage, 'map_a')).toEqual({ draft, index: 2 });
    expect(loadDraft(sessionStorage, 'map_b')).toBeNull();
    clearDraft(sessionStorage, 'map_a');
    expect(loadDraft(sessionStorage, 'map_a')).toBeNull();
  });

  it('drops what it can’t read, and works without storage', () => {
    sessionStorage.setItem(draftKey('map_a'), '{not json');
    expect(loadDraft(sessionStorage, 'map_a')).toBeNull();
    sessionStorage.setItem(draftKey('map_a'), JSON.stringify({ draft: { ...draft, people: 'x' }, index: 0 }));
    expect(loadDraft(sessionStorage, 'map_a')).toBeNull();
    sessionStorage.setItem(draftKey('map_a'), JSON.stringify({ draft, index: 9 }));
    expect(loadDraft(sessionStorage, 'map_a')).toBeNull();
    expect(loadDraft(null, 'map_a')).toBeNull();
    expect(() => saveDraft(null, 'map_a', { draft, index: 0 })).not.toThrow();
  });
});
