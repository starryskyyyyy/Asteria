import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from 'react';
import { parseMarkdown } from './markdown.js';

type Route = { cli: 'codex' | 'dsh'; model: string; provider?: string | null; effort?: string };
type Message = { id: string; turnId: string; role: 'user' | 'assistant'; text: string; route?: Route; status?: string; at: string };
type Conversation = { id: string; title: string; cwd: string; route: Route; status: string; updatedAt: string; messages: Message[]; error?: string; archived?: boolean; events?: any[] };
type CatalogModel = { id: string; name: string; cli: string; provider?: string; reasoningEfforts?: string[]; effortIds?: string[] };
type Connections = Record<string, any>;

declare global {
  interface Window { asteria: {
    bootstrap(): Promise<any>; getConnections(paths: any): Promise<any>; pickFolder(): Promise<string | null>;
    listConversations(): Promise<Conversation[]>; getConversation(id: string): Promise<Conversation | null>;
    createConversation(request: any): Promise<string>; setRoute(id: string, route: Route): Promise<Conversation>;
    sendMessage(id: string, text: string): Promise<any>; cancel(id: string): Promise<boolean>; archive(id: string): Promise<boolean>;
    resolveApproval(id: string, requestId: string | number, choice: boolean | string): Promise<boolean>;
    legacyArchive(): Promise<any[]>; onEvent(listener: (event: any) => void): () => void;
  } }
}

const activeStatus = new Set(['connecting', 'running', 'awaiting-approval']);
const statusLabel: Record<string, string> = { idle: '就绪', connecting: '连接中', running: '生成中', completed: '已完成', failed: '出错', cancelled: '已停止', interrupted: '已中断' };

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [connections, setConnections] = useState<Connections>({});
  const [catalogs, setCatalogs] = useState<Record<string, CatalogModel[]>>({ codex: [], dsh: [] });
  const [cli, setCli] = useState<'codex' | 'dsh'>('codex');
  const [modelKey, setModelKey] = useState('');
  const [effort, setEffort] = useState('');
  const [workspace, setWorkspace] = useState(localStorage.getItem('asteria.workspace') || '');
  const [codexPath, setCodexPath] = useState(localStorage.getItem('asteria.codexPath') || '');
  const [dshPath, setDshPath] = useState(localStorage.getItem('asteria.dshPath') || '');
  const [draft, setDraft] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [legacy, setLegacy] = useState<any[]>([]);
  const [showLegacy, setShowLegacy] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('asteria.theme') || 'mocha');
  const [showSettings, setShowSettings] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const conversationLoad = useRef(0);
  const [copiedBlock, setCopiedBlock] = useState('');

  const models = catalogs[cli] || [];
  const routeModel = conversation ? models.find((item) => item.id === conversation.route.model && (cli !== 'dsh' || item.provider === conversation.route.provider)) : null;
  const chosenKey = modelKey || (routeModel ? keyFor(routeModel) : models[0] ? keyFor(models[0]) : '');
  const chosenModel = models.find((item) => keyFor(item) === chosenKey) || models[0];
  const efforts = cli === 'codex' ? (chosenModel?.reasoningEfforts || []) : (chosenModel?.effortIds || []);
  const anyActive = conversations.some((item) => activeStatus.has(item.status));
  const thisActive = Boolean(conversation && activeStatus.has(conversation.status));
  const messageEvents = useMemo(() => conversation?.events || [], [conversation?.events]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('asteria.theme', theme);
  }, [theme]);

  useEffect(() => {
    let disposed = false;
    window.asteria.bootstrap().then(async (result) => {
      if (disposed) return;
      setConversations(result.conversations || []);
      if (result.legacyArchive?.length) setLegacy(result.legacyArchive);
      setConnections(result.connections || {});
      await refresh();
      const latestActive = result.conversations?.find((item: Conversation) => !item.archived);
      if (!disposed && latestActive) openConversation(latestActive.id);
    }).catch((failure) => setError(failure?.message || '读取本地历史失败。'));
    const unsubscribe = window.asteria.onEvent((event) => {
      if (event.kind === 'connections') { setConnections(event.connections || {}); setCatalogs(event.catalogs || { codex: [], dsh: [] }); return; }
      if (event.kind === 'approval') { setApprovals((items) => [...items.filter((item) => item.requestId !== event.requestId), event]); return; }
      if (event.kind === 'conversation') {
        const item = event.conversation as Conversation;
        setConversations((items) => [item, ...items.filter((previous) => previous.id !== item.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setConversation((current) => current?.id === item.id ? { ...current, ...item } : current);
      } else if (event.kind === 'message') {
        setConversation((current) => current && current.id === event.conversationId ? upsertMessage(current, event.message) : current);
      } else if (event.kind === 'event') {
        if (event.event.type === 'approval_decision') setApprovals((items) => items.filter((item) => item.requestId !== event.event.requestId));
        setConversation((current) => {
          if (!current || current.id !== event.conversationId) return current;
          const previous = current.events || [];
          if (previous.some((item) => item.id === event.event.id)) return current;
          return { ...current, events: [...previous, event.event] };
        });
      }
      if (event.kind === 'turn_complete') setApprovals((items) => items.filter((item) => item.conversationId !== event.conversationId));
    });
    return () => { disposed = true; unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [conversation?.messages]);

  async function refresh() {
    setRefreshing(true); setError('');
    try {
      const result = await window.asteria.getConnections({ codex: codexPath, dsh: dshPath });
      setConnections(result.connections || {}); setCatalogs(result.catalogs || { codex: [], dsh: [] });
      localStorage.setItem('asteria.codexPath', codexPath); localStorage.setItem('asteria.dshPath', dshPath);
      if (!result.catalogs?.[cli]?.length) setError(result.connections?.[cli]?.diagnostic || `${cli} 当前没有可用模型。`);
    } catch (failure: any) { setError(failure?.message || '连接检查失败。'); }
    finally { setRefreshing(false); }
  }

  async function openConversation(id: string) {
    const request = ++conversationLoad.current;
    setSelectedId(id);
    setDraft(drafts[id] || '');
    try {
      const item = await window.asteria.getConversation(id);
      if (!item || request !== conversationLoad.current) return;
      setConversation(item); setWorkspace(item.cwd);
      setCli(item.route.cli); setModelKey(item.route.provider ? `${item.route.provider}/${item.route.model}` : item.route.model); setEffort(item.route.effort || '');
      setError(''); setShowEvents(false);
    } catch (failure: any) { setError(failure?.message || '读取对话失败。'); }
  }

  async function newConversation() {
    conversationLoad.current++;
    setConversation(null); setSelectedId(''); setDraft(''); setError(''); setShowEvents(false);
    if (!workspace) await chooseWorkspace();
  }

  async function chooseWorkspace() {
    if (anyActive || busy) return;
    const folder = await window.asteria.pickFolder();
    if (folder) {
      const changed = folder !== workspace;
      setWorkspace(folder); localStorage.setItem('asteria.workspace', folder);
      if (changed && conversation) {
        conversationLoad.current++;
        setConversation(null); setSelectedId(''); setDraft(''); setShowEvents(false);
        setError('');
        setNotice('已切换到新对话');
        window.setTimeout(() => setNotice(''), 2400);
      }
    }
  }

  function route(): Route | null {
    if (!chosenModel) return null;
    return { cli, model: chosenModel.id, provider: chosenModel.provider || null, effort: effort || (efforts[0] || '') };
  }

  async function applyRoute(nextCli = cli, nextKey = chosenKey, nextEffort = effort) {
    if (!conversation) return;
    const model = (catalogs[nextCli] || []).find((item) => keyFor(item) === nextKey) || (catalogs[nextCli] || [])[0];
    if (!model) return;
    try {
      const selected = { cli: nextCli, model: model.id, provider: model.provider || null, effort: nextEffort };
      await window.asteria.setRoute(conversation.id, selected);
      setConversation((current) => current ? { ...current, route: selected } : current); setError('');
    } catch (failure: any) { setError(failure?.message || '切换模型失败。'); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || anyActive || busy) return;
    const selectedRoute = route();
    if (!selectedRoute) { setError(`${cli} 还没有可用模型，请检查连接。`); return; }
    if (!workspace) { setError('请先选择工作目录。'); return; }
    setBusy(true); setError('');
    try {
      let id = selectedId;
      if (!id) {
        id = await window.asteria.createConversation({ cwd: workspace, ...selectedRoute });
        setSelectedId(id);
      } else if (conversation && (conversation.route.cli !== selectedRoute.cli || conversation.route.model !== selectedRoute.model || conversation.route.provider !== selectedRoute.provider || conversation.route.effort !== selectedRoute.effort)) {
        await window.asteria.setRoute(id, selectedRoute);
      }
      setDraft(''); setDrafts((items) => ({ ...items, [id]: '' }));
      await window.asteria.sendMessage(id, text);
      if (!conversation) await openConversation(id);
    } catch (failure: any) { setError(failure?.message || '发送消息失败。'); }
    finally { setBusy(false); }
  }

  async function stop() {
    const active = conversations.find((item) => activeStatus.has(item.status));
    if (!active) return;
    try { await window.asteria.cancel(active.id); }
    catch (failure: any) { setError(failure?.message || '停止失败。'); }
  }

  async function resolveApproval(request: any, accepted: boolean) {
    const allow = request.options?.find((item: any) => item.kind === 'allow_once');
    const reject = request.options?.find((item: any) => item.kind === 'reject_once');
    if (request.cli === 'dsh' && accepted && !allow) return;
    const choice = request.cli === 'dsh' ? (accepted ? allow?.optionId : reject?.optionId || false) : accepted;
    try { await window.asteria.resolveApproval(request.conversationId, request.requestId, choice ?? false); }
    catch (failure: any) { setError(failure?.message || '审批操作失败。'); }
  }

  async function archiveCurrent() {
    if (!conversation || thisActive) return;
    await window.asteria.archive(conversation.id);
    setConversation(null); setSelectedId('');
    setConversations((items) => items.filter((item) => item.id !== conversation.id));
  }

  function updateDraft(value: string) {
    setDraft(value);
    if (selectedId) setDrafts((items) => ({ ...items, [selectedId]: value }));
  }

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="brand-row"><div className="brand-icon">✳</div><div><b>Asteria</b><small>本机 CLI 对话</small></div><button className="plain-icon settings-open" title="连接与外观" onClick={() => setShowSettings(!showSettings)}>⚙</button></div>
      <button className="new-chat" onClick={() => void newConversation()}><span>＋</span> 新建对话</button>
      {showSettings && <section className="settings-card">
        <div className="settings-title">连接设置</div>
        <label>Codex 入口<input value={codexPath} onChange={(event) => setCodexPath(event.target.value)} placeholder="自动发现 .js / .exe" /></label>
        <label>DSH 入口<input value={dshPath} onChange={(event) => setDshPath(event.target.value)} placeholder="自动发现 .js / .exe" /></label>
        <button className="secondary-button" disabled={refreshing || anyActive} onClick={() => void refresh()}>{refreshing ? '检查中…' : '应用并检查模型'}</button>
        <label>外观<select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="mocha">Mocha 深色</option><option value="latte">Latte 浅色</option></select></label>
      </section>}
      <div className="sidebar-section-label">对话 <span>{conversations.filter((item) => !item.archived).length}</span></div>
      <label className="history-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索对话" /><kbd>⌘ K</kbd></label>
      <div className="conversation-list">
        {conversations.filter((item) => !item.archived && (!search || `${item.title} ${item.cwd} ${item.route?.model}`.toLowerCase().includes(search.toLowerCase()))).map((item) => <button key={item.id} className={`conversation-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => void openConversation(item.id)}>
          <span className={`mini-state ${item.status}`} /><span className="conversation-label"><b>{item.title || '新对话'}</b><small>{item.route?.cli === 'dsh' ? 'DSH' : 'Codex'} · {item.route?.model || '未选择模型'}</small></span><time>{dateLabel(item.updatedAt)}</time>
        </button>)}
        {!conversations.length && <div className="sidebar-empty">你的对话会保存在本机</div>}
      </div>
      <div className="sidebar-bottom"><span className="connection-dot" />本地保存 <span className="build-tag">2.0</span><button className="plain-button" onClick={async () => { const items = await window.asteria.legacyArchive(); setLegacy(items); setShowLegacy(true); }}>V1 历史</button></div>
    </aside>

    <main className="chat-pane">
      <header className="topbar">
        <div className="workspace-chip" title={workspace || '选择工作目录'}><span>⌂</span><span>{workspace || '选择工作目录'}</span><button disabled={anyActive || busy} onClick={() => void chooseWorkspace()} aria-label="选择工作目录" title={anyActive ? '请先停止当前生成' : '选择工作目录'}>⌄</button></div>
        <div className="top-right">{anyActive && <button className="stop-button header-stop" onClick={() => void stop()}>■ 停止生成</button>}<div className={`connection-pill ${connections[cli]?.connected ? 'online' : ''}`}><span />{cli === 'codex' ? 'Codex' : 'DSH'} {connections[cli]?.connected ? '在线' : '未连接'}</div><button className="icon-button" title="刷新 CLI 模型" disabled={refreshing || anyActive} onClick={() => void refresh()}>{refreshing ? '…' : '↻'}</button></div>
      </header>

      <section className="route-bar">
        <label className="route-select"><span className="select-caption">CLI</span><select value={cli} disabled={anyActive} onChange={(event) => { const next = event.target.value as 'codex' | 'dsh'; setCli(next); setModelKey(''); setEffort(''); void applyRoute(next, (catalogs[next] || [])[0] ? keyFor(catalogs[next][0]) : '', ''); }}><option value="codex">Codex</option><option value="dsh">DSH</option></select></label>
        <span className="route-divider">/</span>
        <label className="route-select model-select"><span className="select-caption">模型</span><select value={chosenKey} disabled={anyActive || !models.length} onChange={(event) => { const next = event.target.value; setModelKey(next); setEffort(''); void applyRoute(cli, next, ''); }}><option value="" disabled>选择实时模型</option>{models.map((item) => <option key={keyFor(item)} value={keyFor(item)}>{item.provider ? `${item.provider} / ` : ''}{item.name || item.id}</option>)}</select></label>
        {efforts.length > 0 && <label className="effort-select"><span className="select-caption">推理</span><select value={effort || efforts[0]} disabled={anyActive} onChange={(event) => { setEffort(event.target.value); void applyRoute(cli, chosenKey, event.target.value); }}>{efforts.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
        {!conversation && <span className="route-hint">所选模型将用于新对话</span>}
      </section>

      <div className="messages-scroll">
        {!conversation?.messages?.length ? <div className="welcome">
          <div className="welcome-mark">✳</div><h1>你好，今天想做什么？</h1><p>选择 CLI 和模型，开始一段本机项目对话。主模型也可以通过真实工具委派其他模型。</p>
          <div className="welcome-cards"><button onClick={() => updateDraft('先阅读项目结构，再告诉我关键模块和运行方式。')}><span>⌕</span><b>理解项目</b><small>梳理代码结构与入口</small></button><button onClick={() => updateDraft('请检查当前项目并实现：')}><span>⌘</span><b>编写代码</b><small>描述要实现的功能</small></button><button onClick={() => updateDraft('请检查这个项目中最值得优先修复的问题，并解释理由。')}><span>⌁</span><b>检查问题</b><small>审查并提出可执行建议</small></button></div>
        </div> : <div className="message-list">
          <div className="chat-title"><div><h1>{conversation.title}</h1><span>{conversation.cwd}</span></div><div className="title-actions"><span className={`status-badge ${conversation.status}`}>{statusLabel[conversation.status] || conversation.status}</span><button className="icon-button" title="查看工具与事件" onClick={() => setShowEvents(!showEvents)}>☷</button><button className="icon-button" title="归档对话" disabled={thisActive} onClick={() => void archiveCurrent()}>⌫</button></div></div>
          {conversation.messages.map((message) => <article key={message.id} className={`message ${message.role}`}>
            <div className="avatar">{message.role === 'user' ? '我' : '✳'}</div><div className="message-body"><div className="message-heading"><b>{message.role === 'user' ? '你' : message.route?.cli === 'dsh' ? 'DSH' : 'Codex'}</b>{message.role === 'assistant' && <span>{message.route?.provider ? `${message.route.provider} · ` : ''}{message.route?.model}</span>}</div><div className="message-content">{renderText(message.text, copiedBlock, setCopiedBlock)}{message.role === 'assistant' && message.status === 'running' && <i className="typing-caret" />}</div>
              {message.role === 'assistant' && message.status === 'failed' && <div className="message-error">{conversation.error || '本轮发生错误，可以继续发送下一条消息。'}</div>}
              {message.role === 'assistant' && <TurnTools events={messageEvents.filter((event) => event.turnId === message.turnId)} />}
            </div>
          </article>)}
          {approvals.filter((item) => item.conversationId === conversation.id).map((item) => <section className="approval-card" key={String(item.requestId)}><div className="approval-icon">!</div><div className="approval-copy"><b>{item.cli === 'codex' ? 'Codex' : 'DSH'} 请求一次性审批</b><p>{item.prompt}</p><small>{item.options?.map((option: any) => option.name).join(' · ') || '本次操作只对当前请求生效。'}</small></div><div className="approval-actions"><button className="secondary-button" onClick={() => void resolveApproval(item, false)}>{item.cli === 'dsh' && !item.options?.some((option: any) => option.kind === 'reject_once') ? '取消请求' : '拒绝一次'}</button><button className="send-button" disabled={item.cli === 'dsh' && !item.options?.some((option: any) => option.kind === 'allow_once')} title={item.cli === 'dsh' && !item.options?.some((option: any) => option.kind === 'allow_once') ? '该请求没有一次允许选项' : ''} onClick={() => void resolveApproval(item, true)}>允许一次</button></div></section>)}
          {showEvents && <section className="tool-feed"><div className="tool-feed-heading">工具与子代理事件<button onClick={() => setShowEvents(false)}>收起</button></div>{messageEvents.filter((item) => /tool|delegate|handoff|approval|session_update|agent_thought/.test(item.type)).slice(-100).map((event) => <details key={event.id} className="tool-card"><summary><span className={`tool-dot ${event.type}`} /><b>{event.type.replaceAll('_', ' ')}</b><span>{event.text || event.route?.model || ''}</span><time>{dateLabel(event.at)}</time></summary><div className="tool-detail">{event.task && <pre>{event.task}</pre>}{event.output && <pre>{event.output}</pre>}{event.error && <pre className="error-text">{event.error}</pre>}{event.raw && <pre>{JSON.stringify(event.raw, null, 2)}</pre>}</div></details>)}{!messageEvents.length && <p className="muted">本轮还没有工具事件。</p>}</section>}
          <div ref={endRef} />
        </div>}
      </div>

      {notice && <div className="inline-notice">{notice}</div>}
      {error && <div className="inline-error"><span>!</span>{error}<button onClick={() => setError('')}>×</button></div>}
      <footer className="composer-wrap">
          <div className="composer-box"><textarea value={draft} disabled={anyActive} onChange={(event) => updateDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && !anyActive) { event.preventDefault(); void send(); } }} placeholder={thisActive ? '正在生成…请使用停止按钮中止。' : '给模型发送消息…（Enter 发送，Shift+Enter 换行）'} rows={2} />
          <div className="composer-bottom"><span>{anyActive && !thisActive ? '另一段对话正在生成' : chosenModel ? `${chosenModel.provider ? `${chosenModel.provider} · ` : ''}${chosenModel.name || chosenModel.id}　·　工作目录内执行` : '请先连接 CLI 并选择模型'}</span>{thisActive ? <button className="stop-button" onClick={() => void stop()}><span>■</span> 停止</button> : <button className="send-button" disabled={!draft.trim() || busy || anyActive} onClick={() => void send()}>{busy ? '发送中…' : '发送'} <span>↵</span></button>}</div>
        </div><div className="composer-footnote">模型可通过 Asteria 工具委派其他 CLI 代理。子代理共享本对话工作目录并受任务时限约束。</div>
      </footer>
    </main>

    {showLegacy && <div className="modal-scrim" onClick={() => setShowLegacy(false)}><section className="legacy-modal" onClick={(event) => event.stopPropagation()}><header><div><h2>V1 任务归档</h2><p>历史记录只读展示，不会自动执行或重放。</p></div><button className="plain-icon" onClick={() => setShowLegacy(false)}>×</button></header>{legacy.map((item) => <article key={item.id}><b>{item.title}</b><span>{item.status} · {item.cwd}</span><small>{item.summary}</small></article>)}{!legacy.length && <p className="muted">未找到 V1 历史任务。</p>}</section></div>}
  </div>;
}

function keyFor(model: CatalogModel) { return model.provider ? `${model.provider}/${model.id}` : model.id; }
function upsertMessage(current: Conversation, message: Message): Conversation { return { ...current, messages: current.messages.some((item) => item.id === message.id) ? current.messages.map((item) => item.id === message.id ? message : item) : [...current.messages, message] }; }
function dateLabel(value?: string) { if (!value) return ''; const date = new Date(value); return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }); }

/** Render a safe, intentionally small Markdown subset using React text nodes only. */
function TurnTools({ events }: { events: any[] }) {
  const agents = new Map<string, any>();
  for (const event of events) {
    if (!event.agentId || !['delegate_started', 'delegate_finished'].includes(event.type)) continue;
    agents.set(event.agentId, { ...(agents.get(event.agentId) || {}), ...event, route: event.route || agents.get(event.agentId)?.route });
  }
  if (!agents.size) return null;
  return <div className="turn-tools">{[...agents.values()].map((agent) => <details className="agent-card" key={agent.agentId}>
    <summary><span className={`agent-state ${agent.status || 'running'}`} /><b>{agent.route?.cli?.toUpperCase() || agent.provider?.toUpperCase() || agent.cli?.toUpperCase()} · {agent.route?.provider ? `${agent.route.provider}/` : ''}{agent.route?.model || ''}</b><span className="agent-task">{agent.task || '子代理任务'}</span><em>{statusLabel[agent.status || 'running'] || agent.status || '运行中'}</em></summary>
    <div className="agent-result"><p><strong>任务</strong>{agent.task}</p>{agent.output && <p><strong>返回结果</strong>{agent.output}</p>}{agent.error && <p className="error-text"><strong>错误</strong>{agent.error}</p>}</div>
  </details>)}</div>;
}

function renderText(text: string, copied: string, setCopied: (value: string) => void) {
  return parseMarkdown(text).map((block) => {
    if (block.type === 'code') {
      const key = `code-${block.start}`;
      return <pre className="code-block" key={key}><span className="code-title">{block.language || '代码'}<button onClick={async () => { try { await navigator.clipboard.writeText(block.text); setCopied(key); setTimeout(() => setCopied(''), 1200); } catch {} }}>{copied === key ? '已复制' : '复制'}</button></span><code>{block.text}</code></pre>;
    }
    if (block.type === 'heading') {
      const Tag: ElementType = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[block.level - 1];
      return <Tag className="markdown-heading" key={`heading-${block.start}`}>{renderInline(block.text, `heading-${block.start}`)}</Tag>;
    }
    if (block.type === 'list') {
      const List = block.ordered ? 'ol' : 'ul';
      return <List className="markdown-list" key={`list-${block.start}`}>{block.items.map((item, index) => <li key={`li-${block.start}-${index}`}>{renderInline(item, `li-${block.start}-${index}`)}</li>)}</List>;
    }
    return <p className="markdown-paragraph" key={`paragraph-${block.start}`}>{renderInline(block.text, `paragraph-${block.start}`)}</p>;
  });
}

function renderInline(text: string, key: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_))/g);
  return parts.map((part, index) => {
    const itemKey = `${key}-${index}`;
    if (part.startsWith('`') && part.endsWith('`')) return <code className="inline-code" key={itemKey}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={itemKey}>{part.slice(2, -2)}</strong>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={itemKey}>{part.slice(1, -1)}</em>;
    return <span key={itemKey}>{part}</span>;
  });
}
