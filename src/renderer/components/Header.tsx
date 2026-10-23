import { Spinner } from './Spinner';

export function Header({
  workspace,
  anyActive,
  cliLabel,
  connected,
  refreshing,
  onPickWorkspace,
  onRefresh,
  onStop,
}: {
  workspace: string;
  anyActive: boolean;
  cliLabel: string;
  connected: boolean;
  refreshing: boolean;
  onPickWorkspace(): void;
  onRefresh(): void;
  onStop(): void;
}) {
  return (
    <header className="topbar">
      <div className="workspace-chip">
        <span aria-hidden="true">⌂</span>
        <span title={workspace || '尚未选择工作目录'}>{workspace || '尚未选择工作目录'}</span>
        <button
          type="button"
          title={anyActive ? '请先停止当前生成' : '选择工作目录'}
          disabled={anyActive}
          onClick={() => void onPickWorkspace()}
        >
          ⌄
        </button>
      </div>
      <div className="top-right">
        {anyActive ? (
          <button className="stop-button header-stop" type="button" onClick={() => void onStop()}>
            ■ 停止生成
          </button>
        ) : null}
        <span className={`connection-pill${connected ? ' online' : ''}`} title={connected ? `${cliLabel} 已连接` : `${cliLabel} 未连接`}>
          <span aria-hidden="true" />
          {`${cliLabel} ${connected ? '在线' : '未连接'}`}
        </span>
        <button className="icon-button refresh-button" type="button" title="重新检查 CLI 与模型" disabled={refreshing} onClick={() => void onRefresh()}>
          {refreshing ? <Spinner size={12} /> : '↻'}
        </button>
      </div>
    </header>
  );
}
