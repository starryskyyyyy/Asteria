import { useEffect, useRef } from 'react';
import { isActive } from '../lib/state';
import type { ApprovalRequest, Conversation } from '../types';
import { ApprovalPrompt } from './ApprovalPrompt';
import { MessageBubble } from './MessageBubble';
import { StatusBadge } from './StatusBadge';
import { ToolFeed } from './ToolFeed';

export function MessageList({
  conversation,
  approvals,
  showEvents,
  copied,
  onCopied,
  onToggleEvents,
  onArchive,
  onResolveApproval,
}: {
  conversation: Conversation;
  approvals: ApprovalRequest[];
  showEvents: boolean;
  copied: string;
  onCopied(key: string): void;
  onToggleEvents(): void;
  onArchive(archived: boolean): void;
  onResolveApproval(request: ApprovalRequest, accepted: boolean): void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  }, [conversation.messages]);

  const events = conversation.events || [];
  const active = isActive(conversation.status);

  return (
    <div className="message-list">
      <div className="chat-title">
        <div>
          <h1>{conversation.title}</h1>
          <span>{conversation.cwd}</span>
        </div>
        <div className="title-actions">
          {conversation.archived ? <span className="archive-chip">已归档</span> : null}
          <StatusBadge status={conversation.status} />
          <button
            className="icon-button"
            type="button"
            title="查看工具与事件"
            aria-pressed={showEvents}
            onClick={onToggleEvents}
          >
            ☷
          </button>
          <button
            className="icon-button"
            type="button"
            title={conversation.archived ? '恢复对话' : '归档对话'}
            disabled={active}
            onClick={() => onArchive(!conversation.archived)}
          >
            {conversation.archived ? '↺' : '⌫'}
          </button>
        </div>
      </div>
      {conversation.messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          events={events.filter((event) => event.turnId === message.turnId)}
          errorText={message.status === 'failed' ? conversation.error || '本轮发生错误，可以继续发送下一条消息。' : undefined}
          copied={copied}
          onCopied={onCopied}
        />
      ))}
      {approvals.map((request) => (
        <ApprovalPrompt key={String(request.requestId)} request={request} onResolve={onResolveApproval} />
      ))}
      {showEvents ? <ToolFeed events={events} onClose={onToggleEvents} /> : null}
      <div ref={endRef} />
    </div>
  );
}
