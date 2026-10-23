import { keyFor } from '../lib/state';
import type { AgentInfo, CatalogModel, Cli } from '../types';

export function RouteBar({
  cli,
  agents,
  models,
  chosenKey,
  efforts,
  effort,
  hasConversation,
  onCliChange,
  onModelChange,
  onEffortChange,
}: {
  cli: Cli;
  /** Only the CLIs the user may pick (verified, or developer mode is on). */
  agents: AgentInfo[];
  models: CatalogModel[];
  chosenKey: string;
  efforts: string[];
  effort: string;
  hasConversation: boolean;
  onCliChange(cli: Cli): void;
  onModelChange(key: string): void;
  onEffortChange(value: string): void;
}) {
  return (
    <section className="route-bar">
      <label className="route-select">
        <span className="select-caption">CLI</span>
        <select value={cli} onChange={(event) => onCliChange(event.target.value)}>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </label>
      <span className="route-divider" aria-hidden="true">/</span>
      <label className="route-select model-select">
        <span className="select-caption">模型</span>
        <select value={chosenKey} disabled={models.length === 0} onChange={(event) => onModelChange(event.target.value)}>
          <option value="">{models.length ? '选择实时模型' : '未发现模型'}</option>
          {models.map((model) => (
            <option key={keyFor(model)} value={keyFor(model)}>{model.name || model.id}</option>
          ))}
        </select>
      </label>
      {efforts.length ? (
        <label className="effort-select">
          <span className="select-caption">推理</span>
          <select value={effort} onChange={(event) => onEffortChange(event.target.value)}>
            <option value="">默认</option>
            {efforts.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      ) : null}
      {hasConversation ? null : <span className="route-hint">所选模型将用于新对话</span>}
    </section>
  );
}
