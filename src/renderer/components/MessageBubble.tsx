import type { Message, ToolEvent } from '../types';
import { DelegationPanel } from './DelegationPanel';
import { Markdown } from './Markdown';

/**
 * One chat bubble. The blinking caret only shows while THIS message is streaming,
 * which is the visual equivalent of `status === 'running'`.
 */
export function MessageBubble({
  message,
  events,
  errorText,
  copied,
  onCopied,
}: {
  message: Message;
  events: ToolEvent[];
  errorText?: string;
  copied: string;
  onCopied(key: string): void;
}) {
  const isUser = message.role === 'user';
  const cliLabel = message.route?.cli === 'dsh' ? 'DSH' : 'Codex';
  const caption = `${message.route?.provider ? `${message.route.provider} · ` : ''}${message.route?.model || ''}`;
  const streaming = !isUser && message.status === 'running';

  return (
    <article className={`message ${isUser ? 'user' : 'assistant'}`}>
      <i className="avatar" aria-hidden="true">{isUser ? '我' : '✳'}</i>
      <div className="message-body">
        <div className="message-heading">
          <b>{isUser ? '你' : cliLabel}</b>
          <span>{caption}</span>
        </div>
        <div className="message-content">
          <Markdown text={message.text || ''} copied={copied} onCopied={onCopied} />
          {streaming ? <i className="typing-caret" aria-hidden="true" /> : null}
        </div>
        {errorText ? <div className="message-error">{errorText}</div> : null}
        <DelegationPanel events={events} />
      </div>
    </article>
  );
}
