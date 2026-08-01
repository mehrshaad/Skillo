import { useEffect, useState } from 'react';
import { getSettings, saveSettings, type UiPrefs } from '@/lib/storage';

/**
 * A remembered panel preference, e.g. whether a score card is expanded. Lives in
 * synced settings so the choice follows the user between machines.
 */
export function useUiPref(
  key: keyof UiPrefs,
  fallback = false,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    void getSettings().then((settings) => {
      const stored = settings.ui?.[key];
      if (typeof stored === 'boolean') setValue(stored);
    });
  }, [key]);

  const update = (next: boolean) => {
    setValue(next);
    void getSettings().then((settings) =>
      saveSettings({ ui: { ...settings.ui, [key]: next } }),
    );
  };

  return [value, update];
}
