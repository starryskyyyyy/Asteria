import { isActive, statusLabel } from '../lib/state';
import { Spinner } from './Spinner';

const busyHint: Record<string, string> = {
  connecting: '正在连接 CLI…',
  running: '模型正在生成回复…',
  'awaiting-approval': '等待你确认一次性审批',
};

export function StatusBadge({ status }: { status: string }) {
  const label = statusLabel[status] || status;
  return (
    <span className={`status-badge ${status}`} title={busyHint[status] || `当前状态：${label}`}>
      {status === 'connecting' ? <Spinner size={10} /> : <i className={`status-dot ${status}`} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** Bottom-bar / connection usage: a dot that softly pulses while a turn is live. */
export function LiveDot({ status, className = 'mini-state' }: { status?: string; className?: string }) {
  return <i className={`${className} ${status || ''} ${isActive(status) ? 'is-live' : ''}`} aria-hidden="true" />;
}
