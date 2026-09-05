'use client';

import { MoonIcon, SunIcon, SunMoonIcon } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { ThemePreference } from '@/lib/theme';
import { isThemePreference, setThemePreference, THEME_STORAGE_KEY } from '@/lib/theme';
import { useThemePreference } from '@/lib/use-theme-preference';

const OPTIONS: readonly { readonly value: ThemePreference; readonly label: string; readonly Icon: typeof SunIcon }[] = [
  { value: 'system', label: 'System', Icon: SunMoonIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

/** Header control: follow the system by default, or pin light or dark. */
export function ThemeMenu() {
  const preference = useThemePreference();
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0];

  // Another tab changing the preference updates storage but not this
  // document's attribute; mirror it so both tabs agree.
  useEffect(() => {
    const sync = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const value = event.newValue;
      if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
      else delete document.documentElement.dataset.theme;
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  if (current === undefined) return null;
  const CurrentIcon = current.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Theme: ${current.label}`} />}>
        <CurrentIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value: unknown) => {
            if (isThemePreference(value)) setThemePreference(value);
          }}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
