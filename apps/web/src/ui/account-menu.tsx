'use client';

import { COPY } from '@partner-desk/copy';
import { CircleUserRound, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { authClient } from './auth-client';
import { Button } from './button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from './menu';
import { parsePreference, setPreference } from './theme';
import { useThemePreference } from './theme-toggle';

export interface AccountMenuNotify { error: (message: string) => void }
const toastNotify: AccountMenuNotify = { error: (message) => { toast.error(message); } };

const THEMES = [
  { value: 'light', label: COPY.THEME_LIGHT, Icon: Sun },
  { value: 'dark', label: COPY.THEME_DARK, Icon: Moon },
  { value: 'system', label: COPY.THEME_SYSTEM, Icon: Monitor },
] as const;

/**
 * The theme choice sits in this menu, because the frame has no header toggle. The button shows the name next to the
 * icon; a parent with `group` and `data-collapsed=true` (the shrunk sidebar) hides the name and leaves the icon.
 */
export function AccountMenu({ name, email, notify = toastNotify }: { name: string; email: string; notify?: AccountMenuNotify }) {
  const router = useRouter();
  const preference = useThemePreference();
  /** Leaves only once the server has ended the session; otherwise says so and stays put. */
  const signOut = async () => {
    let failed: boolean;
    try {
      failed = Boolean((await authClient.signOut()).error);
    } catch {
      failed = true;
    }
    if (failed) {
      notify.error(COPY.SIGN_OUT_FAILED);
      return;
    }
    router.push('/');
    router.refresh();
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" aria-label={COPY.ACCOUNT(name)} className="h-10 w-full justify-start px-2 group-data-[collapsed=true]:w-10 group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0">
          <CircleUserRound className="h-5 w-5 shrink-0" aria-hidden />
          <span className="truncate text-sm group-data-[collapsed=true]:hidden">{name}</span>
        </Button>
      </MenuTrigger>
      <MenuContent align="start" side="top">
        <MenuLabel>
          <span className="block text-sm font-medium text-ink">{name}</span>
          <span className="block truncate">{email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" aria-hidden />
            {COPY.NAV_SETTINGS}
          </Link>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>{COPY.THEME}</MenuLabel>
        <MenuRadioGroup value={preference} onValueChange={(value) => setPreference(parsePreference(value))}>
          {THEMES.map(({ value, label, Icon }) => (
            <MenuRadioItem key={value} value={value}>
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onSelect={() => { void signOut(); }}>
          <LogOut className="h-4 w-4" aria-hidden />
          {COPY.SIGN_OUT}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
