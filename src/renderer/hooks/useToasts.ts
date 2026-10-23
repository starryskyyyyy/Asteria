import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastKind = 'notice' | 'error';
export type ToastItem = { id: number; kind: ToastKind; text: string; leaving?: boolean };

const ERROR_TTL_MS = 7000;
const NOTICE_TTL_MS = 2600;
const EXIT_MS = 170;

export type ToastOptions = {
  error: string;
  notice: string;
  setError(value: string): void;
  setNotice(value: string): void;
};

/**
 * Turns the plain `error` / `notice` strings into self-dismissing toasts while
 * keeping the original strings as the single source of truth for the app.
 */
export function useToasts({ error, notice, setError, setNotice }: ToastOptions) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const sequence = useRef(0);
  const kinds = useRef(new Map<number, ToastKind>());

  const retire = useCallback((id: number) => {
    setToasts((items) => items.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), EXIT_MS);
  }, []);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++sequence.current;
    kinds.current.set(id, kind);
    // One live toast per kind: a new error should not stack under an old one.
    setToasts((items) => [...items.filter((item) => item.kind !== kind), { id, kind, text }]);
    return id;
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = push('error', error);
    const timer = window.setTimeout(() => { retire(id); setError(''); }, ERROR_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [error, push, retire, setError]);

  useEffect(() => {
    if (!notice) return;
    const id = push('notice', notice);
    const timer = window.setTimeout(() => { retire(id); setNotice(''); }, NOTICE_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [notice, push, retire, setNotice]);

  const dismiss = useCallback((id: number) => {
    const kind = kinds.current.get(id);
    kinds.current.delete(id);
    retire(id);
    if (kind === 'error') setError('');
    if (kind === 'notice') setNotice('');
  }, [retire, setError, setNotice]);

  return { toasts, dismiss };
}
