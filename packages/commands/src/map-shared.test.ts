import { describe, expect, it } from 'vitest';
import { plannedStart, startedOn } from './map-shared';

describe('startedOn', () => {
  it('a MAP made before keeps its UTC date', () => {
    // Made at 00:30 in Berlin before a MAP kept its own start date: it keeps the UTC date it always had.
    expect(startedOn({ createdAt: '2026-11-03T23:30:00.000Z', startedOn: null })).toBe('2026-11-03');
    expect(startedOn({ createdAt: '2026-11-03T23:30:00.000Z', startedOn: '2026-11-04' })).toBe('2026-11-04');
  });

  it('is the planned start until the open dates were moved for a signing', () => {
    expect(plannedStart({ createdAt: '2026-11-03T23:30:00.000Z', startedOn: '2026-11-04', datesMovedFor: null })).toBe('2026-11-04');
    expect(plannedStart({ createdAt: '2026-11-03T23:30:00.000Z', startedOn: null, datesMovedFor: null })).toBe('2026-11-03');
    expect(plannedStart({ createdAt: '2026-11-03T23:30:00.000Z', startedOn: '2026-11-04', datesMovedFor: '2026-10-30' })).toBe('2026-10-30');
  });
});
