import { useEffect, useState } from 'react';

export const THEMES = [
  { id: 'mocha', label: 'Mocha 深色' },
  { id: 'latte', label: 'Latte 浅色' },
] as const;

/** Mirrors the theme onto <html data-theme> and remembers it across launches. */
export function useTheme() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('asteria.theme') || 'mocha');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('asteria.theme', theme);
  }, [theme]);

  return { theme, setTheme };
}
