import { statusLabel } from '../lib/state';
import type { ToolEvent } from '../types';

type AgentCard = {
  agentId: string;
  cli: string;
  provider?: string | null;
  model: string;
  task?: string;
  status?: string;
  output?: string;
  error?: string;
};

/**
 * Sub-agent cards are derived from the durable delegate_started / delegate_finished
 * events, so they survive a reload exactly like they did before.
 */
export function DelegationPanel({ events }: { events: ToolEvent[] }) {
  const agents = new Map<string, AgentCard>();
  for (const event of events) {
    if (!event.agentId) continue;
    if (event.type !== 'delegate_started' && event.type !== 'delegate_finished') continue;
    const previous = agents.get(event.agentId);
    agents.set(event.agentId, {
      agentId: event.agentId,
      cli: event.route?.cli || event.provider || previous?.cli || 'codex',
      provider: event.route?.provider ?? previous?.provider ?? null,
      model: event.route?.model || previous?.model || '',
      task: event.task || previous?.task,
      status: event.status || previous?.status,
      output: event.output ?? previous?.output,
      error: event.error ?? previous?.error,
    });
  }
  if (!agents.size) return null;

  return (
    <div className="turn-tools">
      {[...agents.values()].map((agent) => (
        <details className="agent-card" key={agent.agentId}>
          <summary>
            <i className={`agent-state ${agent.status || ''}`} aria-hidden="true" />
            <b>{`${agent.cli.toUpperCase()} · ${agent.provider ? `${agent.provider}/` : ''}${agent.model}`}</b>
            <span className="agent-task">{agent.task || '子代理任务'}</span>
            <em>{statusLabel[agent.status || ''] || agent.status || '运行中'}</em>
          </summary>
          <div className="agent-result">
            <p><strong>任务</strong>{agent.task || '—'}</p>
            {agent.output ? <p><strong>返回结果</strong>{agent.output}</p> : null}
            {agent.error ? <p><strong>错误</strong>{agent.error}</p> : null}
          </div>
        </details>
      ))}
    </div>
  );
}
