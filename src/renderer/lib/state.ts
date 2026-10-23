import type { Catalogs, Conversation, Message } from '../types';

/** Statuses that mean "a turn is live", mirroring conversation-manager.js. */
export const activeStatus = new Set(['connecting', 'running', 'awaiting-approval']);

export const statusLabel: Record<string, string> = {
  idle: '就绪',
  connecting: '连接中',
  running: '生成中',
  'awaiting-approval': '等待审批',
  completed: '已完成',
  failed: '出错',
  cancelled: '已停止',
  interrupted: '已中断',
};

export const EMPTY_CATALOGS: Catalogs = { codex: [], dsh: [] };

export function isActive(status?: string) {
  return Boolean(status && activeStatus.has(status));
}

/** Catalog keys fold the provider in only when there is one (DSH routes). */
export function keyFor(model: { id: string; provider?: string | null }) {
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

export function upsertMessage(conversation: Conversation, message: Message): Conversation {
  const messages = conversation.messages || [];
  const index = messages.findIndex((item) => item.id === message.id);
  const next = messages.slice();
  if (index === -1) next.push(message);
  else next[index] = { ...messages[index], ...message };
  return { ...conversation, messages: next };
}

/** Keeps the sidebar newest-first without trusting the incoming order. */
export function mergeConversation(items: Conversation[], item: Conversation): Conversation[] {
  const index = items.findIndex((entry) => entry.id === item.id);
  const rest = index === -1 ? items : [...items.slice(0, index), ...items.slice(index + 1)];
  const merged = index === -1 ? { ...item } : { ...items[index], ...item };
  return [merged, ...rest].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function dateLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function errorMessage(failure: unknown, fallback: string) {
  if (failure instanceof Error && failure.message) return failure.message;
  if (typeof failure === 'string' && failure) return failure;
  return fallback;
}

export function matchesSearch(conversation: Conversation, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [conversation.title, conversation.route?.model, conversation.route?.cli, conversation.cwd]
    .some((field) => String(field || '').toLowerCase().includes(query));
}
