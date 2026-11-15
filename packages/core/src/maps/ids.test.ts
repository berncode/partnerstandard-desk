import { describe, expect, it } from 'vitest';
import { newMapEntityId as newId, newMapId } from './ids';

describe('ids', () => {
  it('prefixes entity ids by kind', () => {
    expect(newId('objective')).toMatch(/^o_[0-9a-z]{6}$/);
    expect(newId('activity')).toMatch(/^a_[0-9a-z]{6}$/);
    expect(newId('person')).toMatch(/^p_[0-9a-z]{6}$/);
    expect(newId('milestone')).toMatch(/^m_[0-9a-z]{6}$/);
    expect(newId('exitTrigger')).toMatch(/^x_[0-9a-z]{6}$/);
  });

  it('creates MAP ids with ten random characters', () => {
    expect(newMapId()).toMatch(/^map_[0-9a-z]{10}$/);
  });

  it('does not repeat in practice', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('activity')));
    expect(ids.size).toBe(1000);
  });
});

describe('review ids', () => {
  it('prefixes review rows rv_, rn_ and ri_', () => {
    expect(newId('review')).toMatch(/^rv_[0-9a-z]{6}$/);
    expect(newId('reviewNumber')).toMatch(/^rn_[0-9a-z]{6}$/);
    expect(newId('reviewItem')).toMatch(/^ri_[0-9a-z]{6}$/);
  });
});
