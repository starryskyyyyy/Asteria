import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { ConversationStore, validConversationId } from './conversation-store.js';
import { DELEGATION_TOOLS, DelegateBroker } from './delegate-broker.js';
import { CodexAdapter } from './providers/codex.js';
import { DshAcpAdapter } from './providers/dsh.js';
import { detectClis, resolveCli } from './cli-discovery.js';

const terminal = new Set(['completed', 'failed', 'cancelled']);
const activeStates = new Set(['connecting', 'running', 'awaiting-approval']);
const MAX_CHILDREN = 6;
const CHILD_TIMEOUT_MS = 10 * 60_000;
const MAX_RAW_EVENT_BYTES = 32 * 1024;

/** Main-process conversation API. All renderer inputs are revalidated here. */
export class ConversationManager {
  constructor({ root, store = new ConversationStore(root), adapterFactory = defaultAdapterFactory, cliPaths = {} } = {}) {
    this.store = store; this.adapterFactory = adapterFactory; this.cliPaths = { ...cliPaths };
    this.conversations = new Map(); this.runtime = new Map(); this.listeners = new Set(); this.active = null; this.catalogs = { codex: [], dsh: [] }; this.connections = {};
    this.pendingApprovals = new Map();
    this.bootPromise = null;
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async bootstrap() {
    // A rejected boot must not be cached forever, or every later retry fails with the stale error.
    this.bootPromise ||= this.#boot().catch((error) => { this.bootPromise = null; throw error; });
    await this.bootPromise;
    return { conversations: await this.listConversations(), legacyArchive: await this.store.listLegacyArchive(), connections: this.connections };
  }

  async #boot() {
    await this.store.initialize();
    for (const item of await this.store.listConversations()) {
      if (activeStates.has(item.status)) {
        item.status = 'interrupted'; item.error = '应用关闭前的对话尚未完成；不会自动重放。'; item.updatedAt = new Date().toISOString();
        for (const message of [...(item.messages || [])].reverse()) {
          if (message.role === 'assistant' && message.status === 'running') { message.status = 'interrupted'; message.at = item.updatedAt; break; }
        }
        await this.store.save(item);
      }
      this.conversations.set(item.id, item);
    }
  }

  async listConversations() { return [...this.conversations.values()].map((item) => publicConversation(item)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); }
  async getConversation(id) { const item = this.conversations.get(validId(id)); return item ? { ...publicConversation(item), events: await this.#events(id) } : null; }

  async refreshCatalogs(paths = this.cliPaths) {
    this.#assertIdle();
    for (const key of ['codex', 'dsh']) if (paths[key] !== undefined && paths[key] !== '') {
      if (typeof paths[key] !== 'string' || paths[key].length > 2000 || !path.isAbsolute(paths[key])) throw new Error(`${key} CLI 路径必须是绝对路径。`);
    }
    const nextPaths = { codex: paths.codex || '', dsh: paths.dsh || '' };
    const changedPaths = nextPaths.codex !== this.cliPaths.codex || nextPaths.dsh !== this.cliPaths.dsh;
    this.cliPaths = nextPaths;
    if (changedPaths) {
      await Promise.all([...this.runtime.values()].map((runtime) => runtime.adapter?.dispose?.().catch(() => {})));
      this.runtime.clear();
      // A different CLI install cannot resume session ids captured from the previous one.
      for (const conversation of this.conversations.values()) {
        conversation.native = { codex: null, dsh: null, syncedCounts: { codex: 0, dsh: 0 } };
        await this.store.save(conversation);
      }
    }
    const detected = await detectClis(this.cliPaths);
    const codexCli = detected.codex.entryPath ? detected.codex : await resolveCli('codex', this.cliPaths.codex);
    const dshCli = detected.dsh.entryPath ? detected.dsh : await resolveCli('dsh', this.cliPaths.dsh);
    const codex = this.adapterFactory('codex', { cli: codexCli });
    const dsh = this.adapterFactory('dsh', { cli: dshCli });
    const [codexState, dshState] = await Promise.all([codex.connect(), dsh.connect({ cwd: process.cwd() })]);
    this.catalogs = { codex: (codexState.models || []).map((model) => ({ ...model, cli: 'codex' })), dsh: (dshState.models || []).map((model) => ({ ...model, cli: 'dsh' })) };
    this.connections = { codex: { ...detected.codex, ...codexState }, dsh: { ...detected.dsh, ...dshState } };
    await Promise.all([codex.dispose?.(), dsh.dispose?.()]);
    this.#emit({ kind: 'connections', connections: this.connections, catalogs: this.catalogs });
    return { connections: this.connections, catalogs: this.catalogs };
  }

  async createConversation({ cwd, cli = 'codex', provider, model, effort } = {}) {
    this.#assertIdle();
    const workspace = await validateCwd(cwd);
    const route = this.#resolveRoute({ cli, provider, model, effort });
    const now = new Date().toISOString();
    const conversation = { id: randomUUID(), schemaVersion: 2, title: '新对话', cwd: workspace, route, createdAt: now, updatedAt: now, status: 'idle', messages: [], native: { codex: null, dsh: null, syncedCounts: { codex: 0, dsh: 0 } }, error: '' };
    this.conversations.set(conversation.id, conversation);
    await this.#save(conversation);
    this.#emit({ kind: 'conversation', conversation: publicConversation(conversation) });
    return conversation.id;
  }

  async setRoute(id, route) {
    this.#assertIdle();
    const conversation = this.#require(id);
    conversation.route = this.#resolveRoute(route);
    conversation.updatedAt = new Date().toISOString();
    await this.#save(conversation);
    this.#emit({ kind: 'conversation', conversation: publicConversation(conversation) });
    return publicConversation(conversation);
  }

  async sendMessage(id, rawText) {
    this.#assertIdle();
    const conversation = this.#require(id);
    const text = validText(rawText);
    const turnId = randomUUID();
    const messageRoute = { ...conversation.route };
    const userMessage = { id: randomUUID(), turnId, role: 'user', text, route: messageRoute, at: new Date().toISOString() };
    const assistantMessage = { id: randomUUID(), turnId, role: 'assistant', text: '', route: messageRoute, at: new Date().toISOString(), status: 'running' };
    conversation.messages.push(userMessage, assistantMessage);
    if (conversation.title === '新对话') conversation.title = text.split(/\r?\n/, 1)[0].slice(0, 80) || '新对话';
    conversation.status = 'connecting'; conversation.error = ''; conversation.updatedAt = new Date().toISOString();
    const ctl = { conversation, turnId, abort: new AbortController(), adapter: null, broker: null, childControllers: new Set(), children: [], toolCalls: 0, eventChain: Promise.resolve(), delegateQueue: Promise.resolve(), cancelled: false };
    this.active = ctl;
    try { await this.#save(conversation); }
    catch (error) {
      this.active = null;
      conversation.messages = conversation.messages.filter((message) => message.turnId !== turnId);
      throw error;
    }
    ctl.operation = this.#execute(ctl, assistantMessage, text).catch((error) => this.#finish(ctl, assistantMessage, ctl.abort.signal.aborted ? 'cancelled' : 'failed', ctl.abort.signal.aborted ? '已停止生成。' : String(error?.message || error)));
    return { turnId };
  }

  async cancel(id) {
    const ctl = this.active;
    if (!ctl || ctl.conversation.id !== validId(id)) return false;
    if (!ctl.abort.signal.aborted) ctl.abort.abort(new Error('Stopped by user'));
    for (const [approvalId, approval] of [...this.pendingApprovals]) if (approval.ctl === ctl) await this.resolveApproval(id, approvalId, false).catch(() => {});
    for (const child of ctl.childControllers) child.abort(new Error('Parent turn cancelled'));
    await Promise.allSettled([ctl.adapter?.stop?.(), ...[...ctl.childControllers].map((child) => child.adapter?.stop?.())]);
    await ctl.operation;
    return true;
  }

  async resolveApproval(id, requestId, choice) {
    const ctl = this.active;
    const approval = this.pendingApprovals.get(requestId);
    if (!ctl || ctl.conversation.id !== validId(id) || !approval || approval.ctl !== ctl) return false;
    this.pendingApprovals.delete(requestId);
    let resolved;
    if (approval.kind === 'dsh') {
      const option = approval.options.find((item) => item.kind === (choice ? 'allow_once' : 'reject_once'));
      resolved = await approval.adapter.resolvePermission(approval.nativeRequestId, option?.optionId || null);
    }
    else resolved = await approval.adapter.resolveApproval(approval.nativeRequestId, Boolean(choice));
    if (!resolved) return false;
    ctl.conversation.status = this.pendingApprovals.size ? 'awaiting-approval' : 'running';
    await this.#event(ctl, 'approval_decision', '已提交一次性审批选择。', { requestId, accepted: Boolean(choice) });
    await this.#save(ctl.conversation);
    return true;
  }

  async archive(id, archived = true) {
    this.#assertIdle();
    const conversation = this.#require(id);
    conversation.archived = Boolean(archived); conversation.updatedAt = new Date().toISOString();
    await this.#save(conversation); this.#emit({ kind: 'conversation', conversation: publicConversation(conversation) });
    return true;
  }

  async dispose() {
    if (this.active) await this.cancel(this.active.conversation.id).catch(() => {});
    this.pendingApprovals.clear();
    for (const item of this.runtime.values()) { await item.adapter?.dispose?.().catch(() => {}); await item.broker?.close().catch(() => {}); }
    this.runtime.clear();
  }

  async #execute(ctl, assistant, userText) {
    const { conversation } = ctl;
    const route = conversation.route;
    ctl.adapter = await this.#adapter(route.cli, conversation.id);
    conversation.status = 'running'; await this.#save(conversation); this.#emit({ kind: 'conversation', conversation: publicConversation(conversation) });
    const previousCli = conversation.native.lastCli;
    let prompt = userText;
    const synced = conversation.native.syncedCounts ||= { codex: 0, dsh: 0 };
    // Anchor on the turn id, not a positional "-2": tool events and interrupted turns shift the tail.
    const missingContext = conversation.messages.slice(synced[route.cli] || 0).filter((message) => message.turnId !== ctl.turnId && (message.role === 'user' || (message.role === 'assistant' && message.text)));
    if (previousCli && previousCli !== route.cli && missingContext.length) {
      const transcript = missingContext.slice(-24).map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text}`).join('\n\n');
      prompt = `以下是为切换 CLI 提供的文本对话背景，仅作为上下文，不代表可重放之前的工具操作。\n\n${transcript}\n\n当前用户消息：\n${userText}`;
      await this.#event(ctl, 'handoff', `将 ${missingContext.length} 条缺失的文本对话背景交给 ${route.cli}；不会重放此前的工具调用。`, { bridgedMessages: missingContext.length });
    }
    const toolCall = (name, args) => this.#tool(ctl, name, args);
    const dynamicTools = route.cli === 'codex' ? this.#codexTools() : [];
    let mcpUrl = null;
    if (route.cli === 'dsh') {
      ctl.broker = new DelegateBroker({ handlers: { listModels: () => this.#modelListing(), delegate: (args) => this.#tool(ctl, 'asteria_delegate', args) } });
      mcpUrl = await ctl.broker.start();
    }
    const sessionId = conversation.native[route.cli];
    const result = await ctl.adapter.run({ cwd: conversation.cwd, prompt, model: route.model, provider: route.provider, effort: route.effort, sessionId, mcpUrl, dynamicTools, onToolCall: toolCall }, (event) => this.#adapterEvent(ctl, assistant, event), ctl.abort.signal);
    if (ctl.abort.signal.aborted || result.status === 'cancelled') return this.#finish(ctl, assistant, 'cancelled', result.error || '已停止。');
    if (result.sessionId) conversation.native[route.cli] = result.sessionId;
    conversation.native.lastCli = route.cli;
    if (result.output) assistant.text = result.output;
    if (result.status === 'completed') conversation.native.syncedCounts[route.cli] = conversation.messages.length;
    if (result.status !== 'completed') return this.#finish(ctl, assistant, 'failed', result.error || 'CLI turn failed.');
    return this.#finish(ctl, assistant, 'completed', '');
  }

  #codexTools() { return DELEGATION_TOOLS.map((tool) => ({ type: 'function', ...tool })); }

  async #tool(ctl, name, args) {
    if (name === 'asteria_list_models') return this.#modelListing();
    if (name === 'asteria_delegate') {
      const operation = ctl.delegateQueue.then(() => this.#delegate(ctl, args));
      ctl.delegateQueue = operation.catch(() => {});
      return operation;
    }
    throw new Error(`Unknown Asteria tool: ${String(name)}`);
  }

  async #delegate(ctl, args) {
    if (ctl.abort.signal.aborted) throw new Error('Parent conversation was cancelled.');
    if (!args || !['codex', 'dsh'].includes(args.cli)) throw new Error('子代理必须选择 Codex 或 DSH CLI。');
    if (args.cli === 'dsh' && args.readOnly === true) throw new Error('DSH ACP 当前无法强制只读，请不要将 DSH 子代理用于只读任务。');
    const task = validText(args.task);
    const route = this.#resolveRoute({ cli: args.cli, provider: args.provider, model: args.model, effort: args.effort });
    // Charge the budget only once the request is known to be valid.
    if (++ctl.toolCalls > MAX_CHILDREN) throw new Error(`每轮最多可派遣 ${MAX_CHILDREN} 个子代理。`);
    const childId = randomUUID();
    const child = { id: childId, cli: route.cli, route, task, status: 'running', output: '', error: '', at: new Date().toISOString() };
    ctl.children.push(child); await this.#event(ctl, 'delegate_started', `${route.cli} 子代理开始：${route.model}${route.provider ? ` · ${route.provider}` : ''}`, { agentId: childId, route, task });
    this.#emit({ kind: 'child', conversationId: ctl.conversation.id, turnId: ctl.turnId, child: { ...child } });
    const controller = new AbortController(); controller.adapter = null; ctl.childControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(new Error('子代理超过 10 分钟时限。')), CHILD_TIMEOUT_MS);
    const parentAbort = () => controller.abort(new Error('主任务已停止。'));
    ctl.abort.signal.addEventListener('abort', parentAbort, { once: true });
    try {
      const runtimeKey = `${ctl.conversation.id}-${childId}`;
      const adapter = await this.#adapter(route.cli, runtimeKey); controller.adapter = adapter;
      const result = await adapter.run({ cwd: ctl.conversation.cwd, prompt: task, model: route.model, provider: route.provider, effort: route.effort, readOnly: Boolean(args.readOnly), sessionId: null, mcpUrl: null }, (event) => this.#childEvent(ctl, child, adapter, event), controller.signal);
      child.status = result.status; child.output = result.output || '';
      if (result.status !== 'completed') child.error = result.error || 'Child task failed.';
      const text = JSON.stringify({ agentId: childId, cli: route.cli, provider: route.provider, model: route.model, status: child.status, output: child.output.slice(0, 100_000), error: child.error });
      await this.#event(ctl, 'delegate_finished', `${route.cli} 子代理${child.status === 'completed' ? '完成' : '结束'}`, { agentId: childId, status: child.status, output: child.output, error: child.error });
      this.#emit({ kind: 'child', conversationId: ctl.conversation.id, turnId: ctl.turnId, child: { ...child } });
      if (ctl.abort.signal.aborted) throw new Error('主会话已取消；不再把结果交回模型。');
      return text;
    } catch (error) {
      // Keep the child record truthful: a thrown run must not stay "running" in the UI.
      if (child.status === 'running') {
        child.status = controller.signal.aborted ? 'cancelled' : 'failed';
        child.error = String(controller.signal.reason?.message || error?.message || error);
        await this.#event(ctl, 'delegate_finished', `${route.cli} 子代理${child.status === 'cancelled' ? '已取消' : '失败'}`, { agentId: childId, status: child.status, output: child.output, error: child.error }).catch(() => {});
        this.#emit({ kind: 'child', conversationId: ctl.conversation.id, turnId: ctl.turnId, child: { ...child } });
      }
      throw error;
    } finally {
      clearTimeout(timeout); ctl.abort.signal.removeEventListener('abort', parentAbort); ctl.childControllers.delete(controller);
      await controller.adapter?.dispose?.().catch(() => {});
      this.runtime.delete(`${ctl.conversation.id}-${childId}`);
      if (controller.signal.aborted && child.status === 'running') { child.status = 'cancelled'; child.error = String(controller.signal.reason?.message || 'Cancelled'); }
    }
  }

  async #adapterEvent(ctl, assistant, event) {
    if (ctl.finished || ctl.abort.signal.aborted) return;
    const text = String(event.text || '');
    if (event.type === 'approval_request') await this.#registerApproval(ctl, ctl.adapter, ctl.conversation.route.cli, event);
    else if (event.type === 'approval_expired') this.#expireApproval(ctl, event);
    if (event.type === 'agent_message_chunk' || event.type === 'item/agentMessage/delta') assistant.text += text;
    else if (event.type === 'item/completed' && !assistant.text && event.raw?.params?.item?.type === 'agentMessage') assistant.text = event.raw.params.item.text || '';
    await this.#event(ctl, event.type || 'event', text, { provider: ctl.conversation.route.cli, raw: event.raw });
    this.#emit({ kind: 'message', conversationId: ctl.conversation.id, message: { ...assistant } });
  }

  async #event(ctl, type, text, extra = {}) {
    const operation = ctl.eventChain.then(async () => {
      const event = { id: randomUUID(), conversationId: ctl.conversation.id, turnId: ctl.turnId, at: new Date().toISOString(), type, text: String(text || '').slice(0, 100_000), ...extra };
      // Raw provider payloads can be megabytes; they go to disk, so cap them per event.
      if (event.raw && JSON.stringify(event.raw).length > MAX_RAW_EVENT_BYTES) event.raw = { truncated: true, note: '原始事件过大，未写入磁盘。' };
      await this.store.appendEvent(ctl.conversation.id, event);
      this.#emit({ kind: 'event', conversationId: ctl.conversation.id, event });
    });
    ctl.eventChain = operation.catch(() => {});
    return operation;
  }

  async #registerApproval(ctl, adapter, kind, event) {
    const nativeRequestId = event.raw?.id || event.raw?.requestId;
    if (nativeRequestId === undefined || !adapter) return;
    const approvalId = randomUUID();
    const options = event.raw?.params?.options || [];
    this.pendingApprovals.set(approvalId, { ctl, adapter, kind, options, nativeRequestId });
    ctl.conversation.status = 'awaiting-approval';
    await this.#save(ctl.conversation);
    this.#emit({ kind: 'approval', conversationId: ctl.conversation.id, requestId: approvalId, cli: kind, prompt: event.text, options });
  }

  async #childEvent(ctl, child, adapter, event) {
    if (ctl.finished) return;
    if (event.type === 'approval_request') await this.#registerApproval(ctl, adapter, child.cli, event);
    else if (event.type === 'approval_expired') this.#expireApproval(ctl, event);
    await this.#event(ctl, event.type || 'child_event', event.text || event.type, { agentId: child.id, provider: child.cli, raw: event.raw });
  }

  /** A provider-side approval timeout must not leave a dead dialog in the host queue. */
  #expireApproval(ctl, event) {
    const nativeRequestId = event.raw?.id ?? event.raw?.requestId;
    if (nativeRequestId === undefined) return;
    for (const [approvalId, approval] of this.pendingApprovals) {
      if (approval.nativeRequestId !== nativeRequestId) continue;
      this.pendingApprovals.delete(approvalId);
      ctl.conversation.status = this.pendingApprovals.size ? 'awaiting-approval' : 'running';
      this.#emit({ kind: 'approval_expired', conversationId: ctl.conversation.id, requestId: approvalId });
      return;
    }
  }

  async #finish(ctl, assistant, status, error) {
    if (ctl.finished) return;
    ctl.finished = true;
    if (status === 'failed' && !ctl.abort.signal.aborted) ctl.abort.abort(new Error(error || 'Main turn failed'));
    for (const child of ctl.childControllers) child.abort(new Error(status === 'failed' ? 'Parent model failed.' : 'Conversation turn finished'));
    await Promise.allSettled([ctl.adapter?.stop?.(), ...[...ctl.childControllers].map((child) => child.adapter?.stop?.())]);
    for (const [approvalId, pending] of [...this.pendingApprovals]) if (pending.ctl === ctl) {
      this.pendingApprovals.delete(approvalId);
      if (pending.kind === 'dsh') await pending.adapter.resolvePermission(pending.nativeRequestId, null).catch(() => {});
      else await pending.adapter.resolveApproval(pending.nativeRequestId, false).catch(() => {});
    }
    await ctl.eventChain;
    // One turn can append thousands of deltas; trim once at the end so the log cannot grow forever.
    await this.store.trimEvents(ctl.conversation.id).catch(() => {});
    const conversation = ctl.conversation;
    if (ctl.broker) await ctl.broker.close().catch(() => {});
    if (ctl.adapter) await ctl.adapter.dispose?.().catch(() => {});
    const at = new Date().toISOString();
    const finalAssistant = { ...assistant, status, at };
    if (status === 'failed') finalAssistant.text ||= error;
    if (status === 'cancelled') finalAssistant.text ||= '已停止生成。';
    const finalConversation = structuredClone(conversation);
    finalConversation.status = status; finalConversation.error = error || ''; finalConversation.updatedAt = at;
    finalConversation.messages = finalConversation.messages.map((message) => message.id === finalAssistant.id ? finalAssistant : message);
    await this.store.save(finalConversation);
    Object.assign(conversation, finalConversation);
    Object.assign(assistant, finalAssistant);
    if (this.active === ctl) this.active = null;
    this.#emit({ kind: 'message', conversationId: conversation.id, message: { ...assistant } });
    this.#emit({ kind: 'conversation', conversation: publicConversation(conversation) });
    this.#emit({ kind: 'turn_complete', conversationId: conversation.id, turnId: ctl.turnId, status, error: error || '' });
  }

  async #adapter(cli, key) {
    let runtime = this.runtime.get(key);
    if (runtime?.cli === cli) return runtime.adapter;
    if (runtime) { await runtime.adapter?.dispose?.().catch(() => {}); await runtime.broker?.close().catch(() => {}); }
    const configured = this.connections[cli]?.entryPath ? this.connections[cli] : await resolveCli(cli, this.cliPaths[cli]);
    const adapter = this.adapterFactory(cli, { cli: configured, onEvent: () => {} });
    runtime = { cli, adapter }; this.runtime.set(key, runtime);
    return adapter;
  }

  #resolveRoute({ cli, provider, model, effort }) {
    if (!['codex', 'dsh'].includes(cli)) throw new Error('只支持 Codex 与 DSH。');
    const list = this.catalogs[cli] || [];
    let candidate;
    if (model) candidate = list.find((item) => item.id === model && (cli !== 'dsh' || !provider || item.provider === provider));
    else if (cli === 'dsh' && this.connections.dsh?.defaultRoute) candidate = list.find((item) => item.id === this.connections.dsh.defaultRoute.model && item.provider === this.connections.dsh.defaultRoute.provider);
    else candidate = list[0];
    if (!candidate) throw new Error(`${cli === 'dsh' ? `DSH ${provider ? `${provider}/` : ''}${model || '默认'}模型` : `Codex ${model || '模型'}`} 不在当前 CLI 返回的实时目录中，请刷新连接。`);
    if (cli === 'dsh' && provider && candidate.provider !== provider) throw new Error(`DSH provider 与模型路由不匹配：${provider}/${candidate.id}`);
    if (effort && candidate.reasoningEfforts?.length && !candidate.reasoningEfforts.includes(effort) && !candidate.effortIds?.includes(effort)) throw new Error(`模型 ${candidate.id} 不支持推理强度 ${effort}。`);
    return { cli, provider: candidate.provider || null, model: candidate.id, effort: effort || (cli === 'dsh' ? '' : candidate.reasoningEfforts?.[0] || '') };
  }

  #modelListing() { return this.catalogs; }
  #require(id) { const item = this.conversations.get(validId(id)); if (!item) throw new Error('找不到该对话。'); return item; }
  #assertIdle() { if (this.active) throw new Error('当前有对话正在生成，请等待或先停止。'); }
  async #events(id) { const item = await this.store.get(id); return item?.events || []; }
  async #save(item) { await this.store.save(item); this.#emit({ kind: 'conversation', conversation: publicConversation(item) }); }
  #emit(event) { for (const listener of this.listeners) { try { listener(event); } catch {} } }
}

export function defaultAdapterFactory(cli, options) { return cli === 'codex' ? new CodexAdapter(options) : new DshAcpAdapter(options); }
async function validateCwd(cwd) { if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.length > 3000) throw new Error('工作目录必须是有效绝对路径。'); const info = await stat(cwd).catch(() => null); if (!info?.isDirectory()) throw new Error('工作目录不存在或不是文件夹。'); return path.resolve(cwd); }
function validText(text) { if (typeof text !== 'string' || !text.trim() || text.length > 100_000) throw new Error('请输入 1–100000 个字符的有效内容。'); return text; }
function validId(id) { return validConversationId(id); }
function publicConversation(item) { const { events, ...visible } = item; return structuredClone(visible); }
