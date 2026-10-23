import { useEffect, useState } from 'react';

/**
 * Keeps a panel mounted long enough to play its exit animation.
 * `mounted` says whether to render at all, `closing` says which animation to use.
 */
export function useExitPresence(open: boolean, duration = 200) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => { setMounted(false); setClosing(false); }, duration);
    return () => window.clearTimeout(timer);
  }, [open, mounted, duration]);

  return { mounted, closing };
}
