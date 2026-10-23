import type { ToastItem } from '../hooks/useToasts';

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss(id: number): void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}${toast.leaving ? ' is-leaving' : ''}`}>
          <span className="toast-icon" aria-hidden="true">{toast.kind === 'error' ? '!' : '✓'}</span>
          <span className="toast-text">{toast.text}</span>
          <button className="toast-close" type="button" title="关闭提示" aria-label="关闭提示" onClick={() => onDismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
