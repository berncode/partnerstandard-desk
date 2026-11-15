/**
 * Color theme. The page is light unless the viewer picked Dark, or System on a dark-mode device.
 * The preference lives in this browser's localStorage only; `<html data-theme>` holds the resolved theme.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'map-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function parsePreference(value: unknown): ThemePreference {
  return value === 'dark' || value === 'system' ? value : 'light';
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  return preference === 'dark' || (preference === 'system' && prefersDark) ? 'dark' : 'light';
}

/** Runs in <head> before the first paint, so a dark-theme viewer never sees a light flash. Mirrors resolveTheme. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=p==="dark"||(p==="system"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function storedPreference(): ThemePreference {
  try {
    return parsePreference(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'light';
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark());
}

const listeners = new Set<() => void>();

export function setPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

/** useSyncExternalStore subscriber: our own changes, the device switching dark mode, and other tabs. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const refresh = () => {
    applyTheme(storedPreference());
    listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY) refresh();
  };
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  media?.addEventListener('change', refresh);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', refresh);
    window.removeEventListener('storage', onStorage);
  };
}
