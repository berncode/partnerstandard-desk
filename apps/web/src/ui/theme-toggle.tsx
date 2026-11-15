'use client';

import { COPY } from '@partner-desk/copy';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from './button';
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './menu';
import { currentTheme, parsePreference, setPreference, storedPreference, subscribeTheme, type Theme, type ThemePreference } from './theme';

const OPTIONS = [
  { value: 'light', label: COPY.THEME_LIGHT, Icon: Sun },
  { value: 'dark', label: COPY.THEME_DARK, Icon: Moon },
  { value: 'system', label: COPY.THEME_SYSTEM, Icon: Monitor },
] as const;

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, storedPreference, () => 'light');
}

export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, currentTheme, () => 'light');
}

export function ThemeToggle() {
  const preference = useThemePreference();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={COPY.THEME}>
          <Sun className="h-5 w-5 dark:hidden" aria-hidden />
          <Moon className="hidden h-5 w-5 dark:block" aria-hidden />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>{COPY.THEME}</MenuLabel>
        <MenuRadioGroup value={preference} onValueChange={(value) => setPreference(parsePreference(value))}>
          {OPTIONS.map(({ value, label, Icon }) => (
            <MenuRadioItem key={value} value={value}>
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
