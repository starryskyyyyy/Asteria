import { useRef, useState } from 'react';
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
import { EMPTY_CATALOGS, errorMessage, isActive, keyFor } from './lib/state';
import type {
  ApprovalRequest,
  BootstrapResult,
  Catalogs,
  Cli,
  Connections,
  Conversation,
  LegacyItem,
  Route,
} from './types';

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [connections, setConnections] = useState<Connections>({});
  const [catalogs, setCatalogs] = useState<Catalogs>(EMPTY_CATALOGS);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [cli, setCli] = useState<Cli>('codex');
  const [modelKey, setModelKey] = useState('');
  const [effort, setEffort] = useState('');
  const [workspace, setWorkspace] = useState(() => localStorage.getItem('asteria.workspace') || '');
  const [codexPath, setCodexPath] = useState(() => localStorage.getItem('asteria.codexPath') || '');
  const [dshPath, setDshPath] = useState(() => localStorage.getItem('asteria.dshPath') || '');
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

  const models = catalogs[cli] || [];
  const routeModel = conversation
    ? models.find((item) => item.id === conversation.route.model && (cli !== 'dsh' || !conversation.route.provider || item.provider === conversation.route.provider))
    : undefined;
  const chosenKey = modelKey || (routeModel ? keyFor(routeModel) : models[0] ? keyFor(models[0]) : '');
  const chosenModel = models.find((item) => keyFor(item) === chosenKey);
  const efforts = chosenModel ? (cli === 'codex' ? chosenModel.reasoningEfforts || [] : chosenModel.effortIds || []) : [];
  const anyActive = conversations.some((item) => isActive(item.status));
  const thisActive = isActive(conversation?.status);
  const connected = Boolean(connections[cli]?.connected);
  const cliLabel = cli === 'dsh' ? 'DSH' : 'Codex';
  const bottomHint = anyActive && !thisActive
    ? '另一段对话正在生成'
    : chosenModel
      ? `${chosenModel.provider || cliLabel} · ${chosenModel.name || chosenModel.id}　·　工作目录内执行`
      : !connected
        ? `未连接 ${cliLabel}，请在连接设置里填写 CLI 路径`
        : conversation?.route?.model
          ? `模型 ${conversation.route.model} 不在当前列表，请重新选择`
          : '请选择模型后发送';

  function remember(key: string, value: string) {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }

  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      const result = await window.asteria.getConnections({ codex: codexPath, dsh: dshPath });
      setConnections(result.connections || {});
      setCatalogs(result.catalogs || EMPTY_CATALOGS);
      localStorage.setItem('asteria.codexPath', codexPath);
      localStorage.setItem('asteria.dshPath', dshPath);
      if (!result.catalogs?.[cli]?.length) {
        setError(result.connections?.[cli]?.diagnostic || `${cli} 当前没有可用模型。`);
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

  async function applyRoute(nextCli: Cli, nextKey: string, nextEffort: string) {
    if (!conversation) return;
    const list = catalogs[nextCli] || [];
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
      setError(`${cli} 还没有可用模型，请检查连接。`);
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
    const allow = request.options?.find((item) => item.kind === 'allow_once');
    const reject = request.options?.find((item) => item.kind === 'reject_once');
    if (request.cli === 'dsh' && accepted && !allow) return;
    const choice = request.cli === 'dsh' ? (accepted ? allow?.optionId : reject?.optionId || false) : accepted;
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

  useEventStream({
    setConversations,
    setConversation,
    setConnections,
    setCatalogs,
    setApprovals,
    async onBootstrap(result: BootstrapResult, isDisposed: () => boolean) {
      setConversations(result.conversations || []);
      if (result.legacyArchive?.length) setLegacy(result.legacyArchive);
      setConnections(result.connections || {});
      await refresh();
      setBooting(false);
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
        codexPath={codexPath}
        dshPath={dshPath}
        refreshing={refreshing}
        anyActive={anyActive}
        theme={theme}
        onSearchChange={setSearch}
        onSelect={(id) => void openConversation(id)}
        onNewConversation={newConversation}
        onToggleSettings={() => setShowSettings((value) => !value)}
        onCodexPathChange={(value) => { setCodexPath(value); remember('asteria.codexPath', value); }}
        onDshPathChange={(value) => { setDshPath(value); remember('asteria.dshPath', value); }}
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
          models={models}
          chosenKey={chosenKey}
          efforts={efforts}
          effort={effort}
          hasConversation={Boolean(conversation)}
          onCliChange={(nextCli) => {
            setCli(nextCli);
            const list = catalogs[nextCli] || [];
            const initial = nextCli === 'dsh'
              ? keyFor(list.find((item) => !modelKey || keyFor(item) === modelKey) || list[0] || { id: '' })
              : keyFor(list[0] || { id: '' });
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
