import type { ApprovalRequest } from '../types';
import { agentName } from '../lib/agents';

/** One-shot approval prompt; the border pulses to draw the eye, the text stays still. */
export function ApprovalPrompt({
  request,
  onResolve,
}: {
  request: ApprovalRequest;
  onResolve(request: ApprovalRequest, accepted: boolean): void;
}) {
  const allow = request.options?.find((item) => item.kind === 'allow_once');
  const reject = request.options?.find((item) => item.kind === 'reject_once');
  // ACP approvals arrive with explicit option ids; app-server approvals are a plain yes/no.
  const hasOptions = Boolean(request.options?.length);
  const names = (request.options || []).map((item) => item.name).filter(Boolean).join(' · ');

  return (
    <div className="approval-card" role="alertdialog" aria-label="一次性审批请求">
      <div className="approval-icon" aria-hidden="true">!</div>
      <div className="approval-copy">
        <b>{`${agentName(request.cli)} 请求一次性审批`}</b>
        <p>{request.prompt || '该操作需要你确认后才能继续。'}</p>
        <small>{names || '本次操作只对当前请求生效。'}</small>
      </div>
      <div className="approval-actions">
        <button className="secondary-button" type="button" onClick={() => onResolve(request, false)}>
          {hasOptions && !reject ? '取消请求' : '拒绝一次'}
        </button>
        <button
          className="send-button"
          type="button"
          disabled={hasOptions && !allow}
          title={hasOptions && !allow ? '该请求没有一次允许选项' : '只允许这一次'}
          onClick={() => onResolve(request, true)}
        >
          允许一次
        </button>
      </div>
    </div>
  );
}
