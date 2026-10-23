import { useEffect, useRef, useState } from 'react';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { LegacyModal } from './components/LegacyModal';
import { MessageList } from './components/MessageList';
import { RouteBar } from './components/RouteBar';
import { Sidebar } from './components/Sidebar';
import { ToastStack } from './components/ToastStack';
import { Welcome } from './components/Welcome';
import { useEventStream } from './hooks/useEventStream';
import { useTheme } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { agentName, pathKey, readStoredPaths, setAgentRegistry } from './lib/agents';
import { EMPTY_CATALOGS, catalogFor, errorMessage, isActive, keyFor } from './lib/state';
import type {
  AgentInfo,
  ApprovalRequest,
  BootstrapResult,
  Catalogs,
  Connections,
  Conversation,
  LegacyItem,
  Route,
} from './types';

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [cliPaths, setCliPaths] = useState<Record<string, string>>({});
  const [developerMode, setDeveloperMode] = useState(() => localStorage.getItem('asteria.developerMode') === '1');
  const [selectedId, setSelectedId] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [connections, setConnections] = useState<Connections>({});
  const [catalogs, setCatalogs] = useState<Catalogs>(EMPTY_CATALOGS);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [cli, setCli] = useState('codex');
  const [modelKey, setModelKey] = useState('');
  const [effort, setEffort] = useState('');
  const [workspace, setWorkspace] = useState(() => localStorage.getItem('asteria.workspace') || '');
  const [draft, setDraft] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [legacy, setLegacy] = useState<LegacyItem[]>([]);
  const [showLegacy, setShowLegacy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');
  const [booting, setBooting] = useState(true);
  const conversationLoad = useRef(0);
  const { theme, setTheme } = useTheme();
  const { toasts, dismiss } = useToasts({ error, notice, setError, setNotice });

  const cliOptions = agents.filter((agent) => agent.verified || developerMode);
  const models = catalogFor(catalogs, cli);
  const routeModel = conversation
    ? models.find((item) => item.id === conversation.route.model && (!conversation.route.provider || item.provider === conversation.route.provider))
    : undefined;
  const chosenKey = modelKey || (routeModel ? keyFor(routeModel) : models[0] ? keyFor(models[0]) : '');
  const chosenModel = models.find((item) => keyFor(item) === chosenKey);
  const efforts = chosenModel ? chosenModel.reasoningEfforts?.length ? chosenModel.reasoningEfforts : chosenModel.effortIds || [] : [];
  const anyActive = conversations.some((item) => isActive(item.status));
  const thisActive = isActive(conversation?.status);
  const connected = Boolean(connections[cli]?.connected);
  const cliLabel = agentName(cli);
  const bottomHint = anyActive && !thisActive
    ? '另一段对话正在生成'
    : chosenModel
      ? `${chosenModel.provider || cliLabel} · ${chosenModel.name || chosenModel.id}　·　工作目录内执行`
      : !connected
        ? `未连接 ${cliLabel}，请在连接设置里填写 CLI 路径`
        : conversation?.route?.model
          ? `模型 ${conversation.route.model} 不在当前列表，请重新选择`
          : '请选择模型后发送';

  function updatePaths(next: Record<string, string>) {
    setCliPaths(next);
    for (const [id, value] of Object.entries(next)) {
      if (value) localStorage.setItem(pathKey(id), value);
      else localStorage.removeItem(pathKey(id));
    }
  }

  function setPath(id: string, value: string) {
    updatePaths({ ...cliPaths, [id]: value });
  }

  async function refresh(paths: Record<string, string> = cliPaths) {
    setRefreshing(true);
    setError('');
    try {
      const result = await window.asteria.getConnections(paths);
      setConnections(result.connections || {});
      setCatalogs(result.catalogs || EMPTY_CATALOGS);
      if (!result.catalogs?.[cli]?.length) {
        setError(result.connections?.[cli]?.diagnostic || `${cliLabel} 当前没有可用模型。`);
      }
    } catch (failure) {
      setError(errorMessage(failure, '连接检查失败。'));
    } finally {
      setRefreshing(false);
    }
  }

  async function openConversation(id: string) {
    const load = (conversationLoad.current += 1);
    setSelectedId(id);
    setDraft(drafts[id] || '');
    try {
      const item = await window.asteria.getConversation(id);
      if (load !== conversationLoad.current) return;
      if (item) {
        setConversation(item);
        setWorkspace(item.cwd);
        setCli(item.route.cli);
        setModelKey(item.route.provider ? `${item.route.provider}/${item.route.model}` : item.route.model);
        setEffort(item.route.effort || '');
      }
      setError('');
      setShowEvents(false);
    } catch (failure) {
      setError(errorMessage(failure, '读取对话失败。'));
    }
  }

  async function chooseWorkspace() {
    if (anyActive || busy) return;
    try {
      const folder = await window.asteria.pickFolder();
      if (!folder) return;
      const changed = folder !== workspace;
      setWorkspace(folder);
      localStorage.setItem('asteria.workspace', folder);
      setError('');
      if (changed && conversation) {
        conversationLoad.current += 1;
        setConversation(null);
        setSelectedId('');
        setDraft('');
        setShowEvents(false);
        setNotice('已切换到新对话');
      }
    } catch (failure) {
      setError(errorMessage(failure, '选择工作目录失败。'));
    }
  }

  function newConversation() {
    conversationLoad.current += 1;
    setConversation(null);
    setSelectedId('');
    setDraft('');
    setError('');
    setShowEvents(false);
    if (!workspace) void chooseWorkspace();
  }

  function currentRoute(): Route | null {
    if (!chosenModel) return null;
    return { cli, model: chosenModel.id, provider: chosenModel.provider || null, effort: effort || efforts[0] || '' };
  }

  async function applyRoute(nextCli: string, nextKey: string, nextEffort: string) {
    if (!conversation) return;
    const list = catalogFor(catalogs, nextCli);
    const model = list.find((item) => keyFor(item) === nextKey) || list[0];
    if (!model) return;
    try {
      const updated = await window.asteria.setRoute(conversation.id, {
        cli: nextCli,
        model: model.id,
        provider: model.provider || null,
        effort: nextEffort,
      });
      setConversation({ ...conversation, route: updated.route });
      setError('');
    } catch (failure) {
      setError(errorMessage(failure, '切换模型失败。'));
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || anyActive || busy) return;
    const selectedRoute = currentRoute();
    if (!selectedRoute) {
      setError(`${cliLabel} 还没有可用模型，请检查连接。`);
      return;
    }
    if (!workspace) {
      setError('请先选择工作目录。');
      return;
    }
    setBusy(true);
    try {
      setError('');
      let id = selectedId;
      if (!id) {
        id = await window.asteria.createConversation({ cwd: workspace, ...selectedRoute });
        setSelectedId(id);
      } else if (
        conversation
        && (conversation.route.cli !== selectedRoute.cli
          || conversation.route.model !== selectedRoute.model
          || conversation.route.provider !== selectedRoute.provider
          || conversation.route.effort !== selectedRoute.effort)
      ) {
        await window.asteria.setRoute(id, selectedRoute);
      }
      setDraft('');
      setDrafts((items) => ({ ...items, [id]: '' }));
      await window.asteria.sendMessage(id, text);
      if (!conversation) void openConversation(id);
    } catch (failure) {
      setError(errorMessage(failure, '发送消息失败。'));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    const target = conversations.find((item) => isActive(item.status));
    if (!target) return;
    try {
      await window.asteria.cancel(target.id);
    } catch (failure) {
      setError(errorMessage(failure, '停止失败。'));
    }
  }

  async function resolve(request: ApprovalRequest, accepted: boolean) {
    // ACP approvals carry explicit option ids; app-server approvals are a plain yes/no.
    const options = request.options || [];
    if (!options.length) {
      try {
        await window.asteria.resolveApproval(request.conversationId, request.requestId, accepted);
      } catch (failure) {
        setError(errorMessage(failure, '审批操作失败。'));
      }
      return;
    }
    const allow = options.find((item) => item.kind === 'allow_once');
    const reject = options.find((item) => item.kind === 'reject_once');
    if (accepted && !allow) return;
    const choice = accepted ? allow?.optionId : reject?.optionId || false;
    try {
      await window.asteria.resolveApproval(request.conversationId, request.requestId, choice ?? false);
    } catch (failure) {
      setError(errorMessage(failure, '审批操作失败。'));
    }
  }

  async function archiveCurrent(archived: boolean) {
    if (!conversation || thisActive) return;
    const id = conversation.id;
    try {
      await window.asteria.archive(id, archived);
      // Archive is reversible: keep the conversation open and in place, only flip the flag.
      setConversations((items) => items.map((item) => (item.id === id ? { ...item, archived } : item)));
      setConversation((current) => (current && current.id === id ? { ...current, archived } : current));
      setNotice(archived ? '对话已归档，可在侧栏「已归档」中找回。' : '对话已恢复到对话列表。');
    } catch (failure) {
      setError(errorMessage(failure, archived ? '归档失败。' : '恢复失败。'));
    }
  }

  async function openLegacy() {
    try {
      const items = await window.asteria.legacyArchive();
      setLegacy(items || []);
      setShowLegacy(true);
    } catch (failure) {
      setError(errorMessage(failure, '读取 V1 历史失败。'));
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    setDrafts((items) => ({ ...items, [selectedId]: value }));
  }

  function toggleEvents() {
    setShowEvents((value) => !value);
  }

  useEffect(() => {
    localStorage.setItem('asteria.developerMode', developerMode ? '1' : '0');
  }, [developerMode]);

  useEventStream({
    setConversations,
    setConversation,
    setConnections,
    setCatalogs,
    setApprovals,
    async onBootstrap(result: BootstrapResult, isDisposed: () => boolean) {
      const list = result.agents || [];
      setAgentRegistry(list);
      setAgents(list);
      const stored = readStoredPaths(list);
      setCliPaths(stored);
      setConversations(result.conversations || []);
      if (result.legacyArchive?.length) setLegacy(result.legacyArchive);
      setConnections(result.connections || {});
      setBooting(false);
      // Prefer the CLI the user last picked, but never leave the composer on an unavailable one.
      const options = list.filter((agent) => agent.verified || developerMode);
      const preferred = options.find((agent) => agent.id === (localStorage.getItem('asteria.lastCli') || 'codex')) || options[0];
      if (preferred) setCli(preferred.id);
      if (isDisposed()) return;
      await refresh(stored);
      if (isDisposed()) return;
      const latest = (result.conversations || []).find((item) => !item.archived);
      if (latest) void openConversation(latest.id);
    },
    onBootstrapError(failure: unknown) {
      setError(errorMessage(failure, '读取本地历史失败。'));
      setBooting(false);
    },
  });

  return (
    <div className="app-frame">
      <Sidebar
        conversations={conversations}
        selectedId={selectedId}
        loading={booting}
        search={search}
        settingsOpen={showSettings}
        agents={cliOptions}
        connections={connections}
        cliPaths={cliPaths}
        developerMode={developerMode}
        refreshing={refreshing}
        anyActive={anyActive}
        theme={theme}
        onSearchChange={setSearch}
        onSelect={(id) => void openConversation(id)}
        onNewConversation={newConversation}
        onToggleSettings={() => setShowSettings((value) => !value)}
        onPathChange={setPath}
        onToggleDeveloperMode={() => setDeveloperMode((value) => !value)}
        onApply={() => void refresh()}
        onThemeChange={setTheme}
        onOpenLegacy={() => void openLegacy()}
      />

      <main className="chat-pane">
        <Header
          workspace={workspace}
          anyActive={anyActive}
          cliLabel={cliLabel}
          connected={connected}
          refreshing={refreshing}
          onPickWorkspace={() => void chooseWorkspace()}
          onRefresh={() => void refresh()}
          onStop={() => void stop()}
        />

        <RouteBar
          cli={cli}
          agents={cliOptions}
          models={models}
          chosenKey={chosenKey}
          efforts={efforts}
          effort={effort}
          hasConversation={Boolean(conversation)}
          onCliChange={(nextCli) => {
            localStorage.setItem('asteria.lastCli', nextCli);
            setCli(nextCli);
            const list = catalogFor(catalogs, nextCli);
            const initial = keyFor(list.find((item) => keyFor(item) === modelKey) || list[0] || { id: '' });
            setModelKey(initial);
            setEffort('');
            if (conversation) void applyRoute(nextCli, initial, '');
          }}
          onModelChange={(key) => {
            setModelKey(key);
            setEffort('');
            if (conversation) void applyRoute(cli, key, '');
          }}
          onEffortChange={(value) => {
            setEffort(value);
            if (conversation) void applyRoute(cli, chosenKey, value);
          }}
        />

        <div className="messages-scroll">
          {conversation ? (
            <MessageList
              conversation={conversation}
              approvals={approvals}
              showEvents={showEvents}
              copied={copied}
              onCopied={setCopied}
              onToggleEvents={toggleEvents}
              onArchive={(archived) => void archiveCurrent(archived)}
              onResolveApproval={(request, accepted) => void resolve(request, accepted)}
            />
          ) : (
            <Welcome onPick={(prompt) => updateDraft(prompt)} />
          )}
        </div>

        <ToastStack toasts={toasts} onDismiss={dismiss} />

        <Composer
          draft={draft}
          busy={busy}
          anyActive={anyActive}
          thisActive={thisActive}
          bottomHint={bottomHint}
          onDraftChange={updateDraft}
          onSend={() => void send()}
          onStop={() => void stop()}
        />
      </main>

      <LegacyModal open={showLegacy} items={legacy} onClose={() => setShowLegacy(false)} />
    </div>
  );
}
