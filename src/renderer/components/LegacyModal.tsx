import { useEffect } from 'react';
import { useExitPresence } from '../hooks/useExitPresence';
import type { LegacyItem } from '../types';

/** Read-only V1 archive; backdrop and dialog fade/slide, Escape closes it. */
export function LegacyModal({ open, items, onClose }: { open: boolean; items: LegacyItem[]; onClose(): void }) {
  const { mounted, closing } = useExitPresence(open, 180);

  useEffect(() => {
    if (!open) return undefined;
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className={`modal-scrim${closing ? ' is-closing' : ''}`} role="presentation" onClick={onClose}>
      <div
        className={`legacy-modal panel${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="V1 任务归档"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>V1 任务归档</h2>
            <p>历史记录只读展示，不会自动执行或重放。</p>
          </div>
          <button className="plain-icon" type="button" title="关闭" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        {items.length === 0 ? <p className="muted">未找到 V1 历史任务。</p> : null}
        {items.map((item) => (
          <article key={item.id}>
            <b>{item.title}</b>
            <span>{`${item.status || '未知状态'} · ${item.cwd || '—'}`}</span>
            {item.summary ? <small>{item.summary}</small> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
