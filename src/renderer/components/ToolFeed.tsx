import { dateLabel } from '../lib/state';
import type { ToolEvent } from '../types';

const VISIBLE_EVENT = /tool|delegate|handoff|approval|session_update|agent_thought/;

/** The collapsible raw event log behind the ☷ toggle. */
export function ToolFeed({ events, onClose }: { events: ToolEvent[]; onClose(): void }) {
  const visible = events.filter((event) => VISIBLE_EVENT.test(event.type)).slice(-100);
  return (
    <div className="tool-feed">
      <div className="tool-feed-heading">
        <span>工具与子代理事件</span>
        <button type="button" onClick={onClose}>收起</button>
      </div>
      {visible.length === 0 ? <div className="muted">本轮还没有工具事件。</div> : null}
      {visible.map((event) => (
        <details className="tool-card" key={event.id}>
          <summary>
            <span className={`tool-dot ${event.type}`} aria-hidden="true" />
            <b>{event.type.replaceAll('_', ' ')}</b>
            <span>{event.text || event.route?.model || event.type}</span>
            <time>{dateLabel(event.at)}</time>
          </summary>
          <div className="tool-detail">
            {event.task ? <pre>{event.task}</pre> : null}
            {event.output ? <pre>{event.output}</pre> : null}
            {event.error ? <pre className="error-text">{event.error}</pre> : null}
            {event.raw ? <pre>{JSON.stringify(event.raw, null, 2)}</pre> : null}
          </div>
        </details>
      ))}
    </div>
  );
}
