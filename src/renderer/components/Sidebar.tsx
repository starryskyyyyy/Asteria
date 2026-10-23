import { useEffect, useRef } from 'react';
import { ConversationList } from './ConversationList';
import { SettingsPanel } from './SettingsPanel';
import type { AgentInfo, ConnectionInfo, Conversation } from '../types';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function Sidebar({
  conversations,
  selectedId,
  loading,
  search,
  settingsOpen,
  agents,
  connections,
  cliPaths,
  developerMode,
  refreshing,
  anyActive,
  theme,
  onSearchChange,
  onSelect,
  onNewConversation,
  onToggleSettings,
  onPathChange,
  onToggleDeveloperMode,
  onApply,
  onThemeChange,
  onOpenLegacy,
}: {
  conversations: Conversation[];
  selectedId: string;
  loading: boolean;
  search: string;
  settingsOpen: boolean;
  agents: AgentInfo[];
  connections: Record<string, ConnectionInfo>;
  cliPaths: Record<string, string>;
  developerMode: boolean;
  refreshing: boolean;
  anyActive: boolean;
  theme: string;
  onSearchChange(value: string): void;
  onSelect(id: string): void;
  onNewConversation(): void;
  onToggleSettings(): void;
  onPathChange(id: string, value: string): void;
  onToggleDeveloperMode(): void;
  onApply(): void;
  onThemeChange(value: string): void;
  onOpenLegacy(): void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const open = conversations.filter((item) => !item.archived).length;

  // The hint under the search box is a real shortcut, not decoration.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-icon" aria-hidden="true">✳</div>
        <div>
          <b>Asteria</b>
          <small>本机 CLI 对话</small>
        </div>
        <button
          className={`plain-icon settings-open${settingsOpen ? ' is-open' : ''}`}
          type="button"
          title="连接设置"
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
        >
          ⚙
        </button>
      </div>

      <button className="new-chat" type="button" onClick={onNewConversation}>
        <span aria-hidden="true">＋</span>
        新建对话
      </button>

      <SettingsPanel
        open={settingsOpen}
        agents={agents}
        connections={connections}
        cliPaths={cliPaths}
        refreshing={refreshing}
        anyActive={anyActive}
        developerMode={developerMode}
        theme={theme}
        onPathChange={onPathChange}
        onApply={onApply}
        onThemeChange={onThemeChange}
        onToggleDeveloperMode={onToggleDeveloperMode}
      />

      <div className="sidebar-section-label">
        <span>对话</span>
        <span>{open}</span>
      </div>
      <label className="history-search">
        <span aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索对话"
          aria-label="搜索对话"
        />
        <kbd>{IS_MAC ? '⌘ K' : 'Ctrl K'}</kbd>
      </label>

      <ConversationList items={conversations} selectedId={selectedId} loading={loading} search={search} onSelect={onSelect} />

      <div className="sidebar-bottom">
        <span className="connection-dot" aria-hidden="true" />
        <span>本地保存</span>
        <span className="build-tag">2.0</span>
        <button className="plain-button" type="button" onClick={() => void onOpenLegacy()}>V1 历史</button>
      </div>
    </aside>
  );
}
