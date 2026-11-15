import { describe, expect, it } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it('keeps in-app paths', () => {
    expect(safeNextPath('/m/m_abc?created=1')).toBe('/m/m_abc?created=1');
    expect(safeNextPath('/partners')).toBe('/partners');
  });

  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/\t/evil.test', '/\n/evil.test', '/.//evil.test', '/a/..//evil.test', '/x/../\\evil.test', '/./\\evil.test', '/..//evil.test', '/%2e%2e//evil.test', 'javascript:alert(1)', 'markets', '', null, undefined, 42, ['/a']])(
    'falls back for %j', (value) => {
      expect(safeNextPath(value)).toBe('/this-week');
    },
  );

  it('lands on This week when there is no next', () => {
    expect(safeNextPath(undefined)).toBe('/this-week');
  });

  it('uses a custom fallback', () => {
    expect(safeNextPath('//evil.test', '/partners/new')).toBe('/partners/new');
  });
});
