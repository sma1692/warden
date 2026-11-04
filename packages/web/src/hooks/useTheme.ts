import { useEffect, useState } from 'react';
import { StorageKeys, readStorage, writeStorage } from '../utils/storage';

export type ThemeMode = 'light' | 'dark';

/** Dashboard theme: persisted, applied to <html>, and mirrored to theme-color. */
export function useTheme(): [ThemeMode, React.Dispatch<React.SetStateAction<ThemeMode>>] {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = readStorage(StorageKeys.theme);
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
    writeStorage(StorageKeys.theme, theme);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#0B121C' : '#F7F3E8');
    }
  }, [theme]);

  return [theme, setTheme];
}
