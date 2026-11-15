// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePreference, resolveTheme, setPreference, storedPreference, THEME_KEY, THEME_SCRIPT } from './theme';

function fakeDarkDevice(dark: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)', media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme', () => {
  it('is light unless Dark, or System on a dark device, was chosen', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('treats anything unknown as light', () => {
    expect(parsePreference(null)).toBe('light');
    expect(parsePreference('purple')).toBe('light');
    expect(parsePreference('system')).toBe('system');
  });

  it.each([
    [null, true, 'light'],
    ['dark', false, 'dark'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
  ] as const)('the head script resolves %s on a dark=%s device to %s', (stored, dark, expected) => {
    fakeDarkDevice(dark);
    if (stored) localStorage.setItem(THEME_KEY, stored);
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it('stores the choice and applies it at once', () => {
    fakeDarkDevice(true);
    setPreference('system');
    expect(storedPreference()).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setPreference('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('still applies the choice when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    setPreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storedPreference()).toBe('light');
  });
});
