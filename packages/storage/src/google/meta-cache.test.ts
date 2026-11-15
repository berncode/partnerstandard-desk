import { describe, expect, it } from 'vitest';
import { createSheetMetaCache } from './meta-cache';

const META = { sheetIds: { Market: 1, People: 5 }, rowCounts: { Market: 1000, People: 1500 } };

function setup() {
  let now = 0;
  const cache = createSheetMetaCache({ ttlMs: 600_000, clock: () => now });
  return { cache, advance: (ms: number) => { now += ms; } };
}

describe('createSheetMetaCache', () => {
  it('keeps a layout for ten minutes, then forgets it', () => {
    const { cache, advance } = setup();
    expect(cache.get('f1')).toBeNull();
    cache.set('f1', META);
    advance(599_999);
    expect(cache.get('f1')).toEqual(META);
    advance(1);
    expect(cache.get('f1')).toBeNull();
  });

  it('drops one file’s layout and keeps the others', () => {
    const { cache } = setup();
    cache.set('f1', META);
    cache.set('f2', META);
    cache.drop('f1');
    expect(cache.get('f1')).toBeNull();
    expect(cache.get('f2')).toEqual(META);
  });

  it('hands out copies, so a caller can’t change a cached layout', () => {
    const { cache } = setup();
    const meta = { sheetIds: { Market: 1 }, rowCounts: { Market: 1000 } };
    cache.set('f1', meta);
    meta.sheetIds.Market = 99;
    meta.rowCounts.Market = 5;
    cache.get('f1')!.sheetIds.Market = 42;
    cache.get('f1')!.rowCounts.Market = 6;
    expect(cache.get('f1')).toEqual({ sheetIds: { Market: 1 }, rowCounts: { Market: 1000 } });
  });
});
