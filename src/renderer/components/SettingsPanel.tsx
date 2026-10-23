import { THEMES } from '../hooks/useTheme';
import { useExitPresence } from '../hooks/useExitPresence';
import { Spinner } from './Spinner';
import type { AgentInfo, ConnectionInfo } from '../types';

/** Connection / appearance settings; slides in and out instead of popping. */
export function SettingsPanel({
  open,
  agents,
  connections,
  cliPaths,
  refreshing,
  anyActive,
  developerMode,
  theme,
  onPathChange,
  onApply,
  onThemeChange,
  onToggleDeveloperMode,
}: {
  open: boolean;
  agents: AgentInfo[];
  connections: Record<string, ConnectionInfo>;
  cliPaths: Record<string, string>;
  refreshing: boolean;
  anyActive: boolean;
  developerMode: boolean;
  theme: string;
  onPathChange(id: string, value: string): void;
  onApply(): void;
  onThemeChange(value: string): void;
  onToggleDeveloperMode(): void;
}) {
  const { mounted, closing } = useExitPresence(open, 220);
  if (!mounted) return null;

  return (
    <section className={`settings-card panel${closing ? ' is-closing' : ''}`} aria-label="连接设置">
      <div className="settings-title">连接设置</div>
      {agents.map((agent) => {
        const info = connections[agent.id];
        const state = info?.connected ? info.version || '已连接' : info?.diagnostic ? '未就绪' : '未检测';
        return (
          <label key={agent.id} className={`cli-field${info?.connected ? ' is-online' : ''}`}>
            <span className="cli-field-head">
              {agent.name}
              <small title={info?.diagnostic || agent.install}>{state}</small>
            </span>
            <input
              value={cliPaths[agent.id] || ''}
              onChange={(event) => onPathChange(agent.id, event.target.value)}
              placeholder="自动发现；可填 .js / .exe 绝对路径"
              spellCheck={false}
            />
          </label>
        );
      })}
      <button
        className="secondary-button"
        type="button"
        disabled={refreshing}
        title={anyActive ? '生成中也能重新检查连接' : '重新检查 CLI 与模型'}
        onClick={() => void onApply()}
      >
        {refreshing ? <><Spinner size={11} />检查中…</> : '应用并检查模型'}
      </button>
      <label>
        外观
        <select value={theme} onChange={(event) => onThemeChange(event.target.value)}>
          {THEMES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={developerMode} onChange={onToggleDeveloperMode} />
        开发者模式（显示未验证的 CLI）
      </label>
    </section>
  );
}
