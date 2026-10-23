import { useState } from 'react';
import { dateLabel, matchesSearch } from '../lib/state';
import type { Conversation } from '../types';
import { LiveDot } from './StatusBadge';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/** Conversation history: skeleton shimmer on first load, quiet empty states, animated rows. */
export function ConversationList({
  items,
  selectedId,
  loading,
  search,
  onSelect,
}: {
  items: Conversation[];
  selectedId: string;
  loading: boolean;
  search: string;
  onSelect(id: string): void;
}) {
  const [showArchived, setShowArchived] = useState(false);

  if (loading) {
    return (
      <div className="conversation-list" aria-busy="true" aria-label="正在载入对话">
        {SKELETON_ROWS.map((index) => (
          <div className="skeleton-row" key={index} style={{ animationDelay: `${index * 90}ms` }}>
            <span className="skeleton-dot" />
            <span className="skeleton-line" />
          </div>
        ))}
      </div>
    );
  }

  const visible = items.filter((item) => matchesSearch(item, search));
  if (visible.length === 0) {
    return (
      <div className="conversation-list">
        <div className="sidebar-empty">{items.length ? `没有匹配「${search}」的对话。` : '你的对话会保存在本机'}</div>
      </div>
    );
  }

  const row = (item: Conversation) => (
    <button
      key={item.id}
      className={`conversation-item${item.id === selectedId ? ' selected' : ''}${item.archived ? ' is-archived' : ''}`}
      type="button"
      role="listitem"
      onClick={() => onSelect(item.id)}
    >
      <LiveDot status={item.status} />
      <span className="conversation-label">
        <b>{item.title}</b>
        <small>{`${item.route?.cli === 'dsh' ? 'DSH' : 'Codex'} · ${item.route?.model || '未选择模型'}`}</small>
      </span>
      {item.archived ? <span className="archive-chip">已归档</span> : null}
      <time>{dateLabel(item.updatedAt)}</time>
    </button>
  );

  const current = visible.filter((item) => !item.archived);
  const archived = visible.filter((item) => item.archived);

  return (
    <div className="conversation-list" role="list">
      {current.map(row)}
      {archived.length ? (
        <div className="conversation-group">
          <button
            className={`group-toggle${showArchived ? ' is-open' : ''}`}
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((value) => !value)}
          >
            <span aria-hidden="true" className="group-caret">▸</span>
            <span>已归档</span>
            <span className="group-count">{archived.length}</span>
          </button>
          {showArchived ? archived.map(row) : null}
        </div>
      ) : null}
    </div>
  );
}
