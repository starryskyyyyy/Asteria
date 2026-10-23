import { THEMES } from '../hooks/useTheme';
import { useExitPresence } from '../hooks/useExitPresence';
import { Spinner } from './Spinner';

/** Connection / appearance settings; slides in and out instead of popping. */
export function SettingsPanel({
  open,
  codexPath,
  dshPath,
  refreshing,
  anyActive,
  theme,
  onCodexPathChange,
  onDshPathChange,
  onApply,
  onThemeChange,
}: {
  open: boolean;
  codexPath: string;
  dshPath: string;
  refreshing: boolean;
  anyActive: boolean;
  theme: string;
  onCodexPathChange(value: string): void;
  onDshPathChange(value: string): void;
  onApply(): void;
  onThemeChange(value: string): void;
}) {
  const { mounted, closing } = useExitPresence(open, 220);
  if (!mounted) return null;

  return (
    <section className={`settings-card panel${closing ? ' is-closing' : ''}`} aria-label="连接设置">
      <div className="settings-title">连接设置</div>
      <label>
        Codex 入口
        <input value={codexPath} onChange={(event) => onCodexPathChange(event.target.value)} placeholder="自动发现 .js / .exe" spellCheck={false} />
      </label>
      <label>
        DSH 入口
        <input value={dshPath} onChange={(event) => onDshPathChange(event.target.value)} placeholder="自动发现 .js / .exe" spellCheck={false} />
      </label>
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
    </section>
  );
}
