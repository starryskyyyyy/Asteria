import { useEffect, useState } from 'react';

export const THEMES = [
  { id: 'mocha', label: 'Mocha 深色' },
  { id: 'latte', label: 'Latte 浅色' },
] as const;

/** Mirrors the theme onto <html data-theme>, the native frame, and localStorage. */
export function useTheme() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('asteria.theme') || 'mocha');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('asteria.theme', theme);
    // Keep the Windows title bar / menu colour in step with the in-app palette.
    window.asteria?.setTheme?.(theme);
  }, [theme]);

  return { theme, setTheme };
}
