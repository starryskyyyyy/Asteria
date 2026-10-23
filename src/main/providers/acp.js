import { spawn } from 'node:child_process';
import path from 'node:path';
import { JsonRpcPeer } from '../json-rpc.js';
import { resolveCli } from '../cli-discovery.js';
import { APP_NAME, APP_VERSION } from '../app-info.js';

const PERMISSION_TIMEOUT_MS = 120_000;

/** Extra environment variables a specific ACP backend needs (merged over process.env). */
function acpEnv(spec) {
  return { ...process.env, ...(spec?.env || {}) };
}

/** Persistent ACP session adapter. One instance owns one CLI process and one ACP session. */
export class AcpAdapter {
  constructor({ cli, nodePath, scriptPath, cliId = 'dsh', spec = {}, spawnImpl = spawn, onEvent = () => {} } = {}) {
    this.cli = cli;
    this.cliId = cliId;
    this.spec = spec;
    this.label = spec?.label || cliId;
    this.nodePath = nodePath;
    this.scriptPath = scriptPath;
    this.spawnImpl = spawnImpl;
    this.onEvent = onEvent;
    this.child = null;
    this.peer = null;
    this.sessionId = null;
    this.catalog = [];
    this.efforts = [];
    this.configOptions = [];
    this.defaultRoute = null;
    this.active = null;
    this.eventSink = null;
    this.stderr = '';
    this.pendingPermissions = new Map();
  }

  async connect({ cwd = process.cwd(), mcpUrl = null, resumeSessionId = null } = {}) {
    if (this.peer) return this.connection();
    if (this.cli) { this.nodePath = this.cli.nodePath; this.scriptPath = this.cli.entryPath; }
    if (!this.scriptPath) { const found = await resolveCli(this.cliId); this.nodePath ||= found.nodePath; this.scriptPath ||= found.entryPath; }
    if (!this.scriptPath || (!this.nodePath && !this.scriptPath.toLowerCase().endsWith('.exe'))) return { connected: false, models: [], diagnostic: `未找到 ${this.label} 的 ACP 入口。` };
    try {
      const command = this.nodePath || this.scriptPath;
      const acpArgs = this.spec.acpArgs || ['--profile', 'acp'];
      const args = this.nodePath ? [...(this.spec.nodeArgs || []), this.scriptPath, ...acpArgs] : [...acpArgs];
      this.child = this.spawnImpl(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: acpEnv(this.spec) });
      this.peer = new JsonRpcPeer(this.child, { timeoutMs: 120_000, label: this.spec.name || this.cliId });
      this.peer.on('stderr', (text) => { this.stderr = `${this.stderr}${text}`.slice(-5000); (this.eventSink || this.onEvent)({ type: 'stderr', text, raw: { stream: 'stderr' } }); });
      this.peer.on('notification', (message) => this.#notification(message));
      this.peer.on('request', (message) => this.#serverRequest(message));
      this.peer.on('close', (error) => {
        if (this.active) this.active.finish({ status: this.active.signal?.aborted ? 'cancelled' : 'failed', error: `ACP 连接已关闭：${error?.message || 'process exited'}` });
        this.peer = null;
        this.sessionId = null;
      });
      await this.peer.request('initialize', { protocolVersion: 1, clientInfo: { name: 'asteria', version: APP_VERSION }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      this.peer.notify('initialized', {});
      const mcpServers = mcpUrl ? [{ type: 'http', name: 'asteria-delegation', url: mcpUrl, headers: [] }] : [];
      const session = resumeSessionId
        ? await this.peer.request('session/resume', { sessionId: resumeSessionId, cwd, mcpServers })
        : await this.peer.request('session/new', { cwd, mcpServers });
      this.sessionId = resumeSessionId || session.sessionId;
      if (!this.sessionId) throw new Error('ACP 未返回会话编号。');
      this.#readCatalog(session.configOptions || []);
      return this.connection();
    } catch (error) {
      await this.#terminate();
      return { connected: false, models: [], diagnostic: String(error?.message || error) };
    }
  }

  async run({ cwd, prompt, provider, model, effort, sessionId = null, mcpUrl = null }, onEvent = this.onEvent, signal) {
    if (signal?.aborted) return { status: 'cancelled', error: '取消后未启动 ACP turn。' };
    if (!this.peer || !this.sessionId) {
      const connection = await this.connect({ cwd, mcpUrl, resumeSessionId: sessionId });
      if (!connection.connected) return { status: 'failed', error: connection.diagnostic };
    }
    if (signal?.aborted) return { status: 'cancelled', error: 'ACP 会话启动期间已取消。' };
    if (sessionId && this.sessionId !== sessionId) return { status: 'failed', error: 'ACP ACP resumed an unexpected session.' };
    this.eventSink = onEvent;
    try {
      const selected = JSON.stringify([provider || this.defaultRoute?.provider, model || this.defaultRoute?.model]);
      if (provider && model) {
        const available = this.catalog.some((entry) => entry.provider === provider && entry.id === model);
        if (!available) { this.eventSink = null; return { status: 'failed', error: `所选 ACP 模型不可用：${provider}/${model}` }; }
        const option = this.configOptions.find((item) => item.id === 'model');
        if (option?.currentValue !== selected) {
          const update = await this.peer.request('session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: selected });
          if (update.configOptions) this.#readCatalog(update.configOptions);
        }
      }
      if (signal?.aborted) { this.eventSink = null; return { status: 'cancelled', error: 'ACP 路由设置期间已取消。' }; }
      const supported = this.efforts.some((entry) => entry.id === effort);
      if (effort && supported) {
        const update = await this.peer.request('session/set_config_option', { sessionId: this.sessionId, configId: 'reasoning_effort', value: effort });
        if (update.configOptions) this.#readCatalog(update.configOptions);
      }
      if (signal?.aborted) { this.eventSink = null; return { status: 'cancelled', error: 'ACP 路由设置期间已取消。' }; }
    } catch (error) {
      this.eventSink = null;
      return { status: 'failed', error: `ACP route selection failed: ${error.message}` };
    }
    return new Promise((resolve) => {
      let settled = false;
      let resolveDone;
      const active = { sessionId: this.sessionId, signal, finish: null, done: null, settled: false, stopPromise: null, output: '', lastMessageId: null };
      active.done = new Promise((done) => { resolveDone = done; });
      const abort = () => { void this.stop(); };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        active.settled = true;
        signal?.removeEventListener('abort', abort);
        if (this.active === active) this.active = null;
        this.eventSink = null;
        const final = { ...result, sessionId: active.sessionId };
        resolve(final);
        resolveDone(final);
      };
      active.finish = finish;
      this.active = active;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { finish({ status: 'cancelled', error: '取消后未启动 ACP turn。' }); return; }
      this.peer.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: prompt }] }).then((response) => {
        if (response?.stopReason === 'end_turn' || response?.stopReason === 'completed') finish({ status: 'completed', output: active.output });
        else if (response?.stopReason === 'cancelled' || response?.stopReason === 'user_cancelled') finish({ status: 'cancelled', output: active.output, error: 'ACP turn cancelled.' });
        else finish({ status: 'failed', error: `ACP ended with stop reason ${response?.stopReason || 'unknown'}.` });
      }).catch((error) => finish({ status: signal?.aborted ? 'cancelled' : 'failed', error: String(error?.message || error) }));
    });
  }

  connection() {
    return { connected: Boolean(this.peer && this.sessionId), executablePath: this.scriptPath, version: this.cli?.version || this.spec.version || 'ACP', models: this.catalog, efforts: this.efforts, defaultRoute: this.defaultRoute, sessionId: this.sessionId, diagnostic: '' };
  }

  async resolvePermission(requestId, optionId = null) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    if (optionId === 'decline') optionId = pending.options.find((item) => item.kind === 'reject_once')?.optionId;
    const option = optionId ? pending.options.find((item) => item.optionId === optionId && (item.kind === 'allow_once' || item.kind === 'reject_once')) : null;
    if (optionId && !option) return false;
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(requestId);
    if (!option) this.peer?.respond(requestId, { outcome: { outcome: 'cancelled' } });
    else this.peer?.respond(requestId, { outcome: { outcome: 'selected', optionId: option.optionId } });
    return true;
  }

  async stop() {
    const active = this.active;
    if (!active) return;
    if (active.stopPromise) return active.stopPromise;
    active.stopPromise = (async () => {
      try { this.peer?.notify('session/cancel', { sessionId: active.sessionId }); } catch {}
      let timer;
      await Promise.race([active.done, new Promise((resolve) => { timer = setTimeout(resolve, 5_000); })]);
      if (timer) clearTimeout(timer);
      if (!active.settled) { await this.#terminate(); active.finish({ status: 'cancelled', error: 'ACP ACP turn stopped.' }); }
    })();
    return active.stopPromise;
  }

  async dispose() {
    await this.stop();
    for (const id of [...this.pendingPermissions.keys()]) await this.resolvePermission(id, null).catch(() => {});
    if (this.peer && this.sessionId) await this.peer.request('session/close', { sessionId: this.sessionId }, 5_000).catch(() => {});
    await this.#terminate();
  }

  #readCatalog(options) {
    this.configOptions = Array.isArray(options) ? options : [];
    const models = this.configOptions.find((item) => item.id === 'model');
    this.catalog = (models?.options || []).flatMap((group) => (group.options || []).map((item) => {
      let route;
      try { route = JSON.parse(item.value); } catch { return null; }
      if (!Array.isArray(route) || route.length !== 2) return null;
      return { id: route[1], name: item.name || route[1], provider: route[0], cli: this.cliId, effortIds: [] };
    }).filter(Boolean));
    let current = null;
    try { current = models?.currentValue ? JSON.parse(models.currentValue) : null; } catch { current = null; }
    this.defaultRoute = Array.isArray(current) ? { provider: current[0], model: current[1] } : (this.catalog[0] && { provider: this.catalog[0].provider, model: this.catalog[0].id });
    const effort = this.configOptions.find((item) => item.id === 'reasoning_effort');
    this.efforts = (effort?.options || []).map((item) => ({ id: item.value, name: item.name }));
    for (const model of this.catalog) model.effortIds = this.efforts.map((item) => item.id);
  }

  #notification(message) {
    if (message.method !== 'session/update') { (this.eventSink || this.onEvent)({ type: message.method, text: '', raw: message }); return; }
    const update = message.params?.update || {};
    const type = update.sessionUpdate || update.type || 'session_update';
    let text = update.content?.text || update.text || '';
    if (type === 'agent_message_chunk') {
      text = update.content?.text || '';
      if (this.active && text) {
        const messageId = update.messageId;
        if (messageId && this.active.lastMessageId && messageId !== this.active.lastMessageId && this.active.output) text = `\n\n${text}`;
        if (messageId) this.active.lastMessageId = messageId;
        this.active.output += text;
      }
    }
    if (type === 'tool_call') text = `${update.title || update.kind || '工具调用'}`;
    if (type === 'tool_call_update') text = update.content?.map?.((item) => item.text || '').join('') || update.title || '';
    if (type === 'agent_thought_chunk') text = update.content?.text || '';
    (this.eventSink || this.onEvent)({ type, text, raw: message });
  }

  #serverRequest(message) {
    if (message.method === 'session/request_permission') {
      const options = message.params?.options || [];
      const timer = setTimeout(() => {
        if (!this.pendingPermissions.has(message.id)) return;
        // Surfaced so the host can drop the prompt from its queue instead of showing a dead dialog.
        (this.eventSink || this.onEvent)({ type: 'approval_expired', text: 'ACP 审批请求超时，已自动拒绝。', raw: message });
        this.resolvePermission(message.id, 'decline').catch(() => {});
      }, PERMISSION_TIMEOUT_MS);
      this.pendingPermissions.set(message.id, { options, timer });
      (this.eventSink || this.onEvent)({ type: 'approval_request', text: `ACP 请求批准：${message.params?.toolCall?.title || message.params?.toolCall?.kind || '工具操作'}`, raw: message });
      return;
    }
    this.peer?.respondError(message.id, -32601, `Unsupported ACP server request: ${message.method}`);
    (this.eventSink || this.onEvent)({ type: 'unsupported_request', text: `Unsupported ACP server request: ${message.method}`, raw: message });
  }

  async #terminate() {
    const peer = this.peer;
    const child = this.child;
    this.peer = null;
    this.child = null;
    this.sessionId = null;
    this.eventSink = null;
    for (const pending of this.pendingPermissions.values()) clearTimeout(pending.timer);
    this.pendingPermissions.clear();
    peer?.dispose();
    if (!child || child.killed) return;
    await killTree(child);
  }
}

function killTree(child) {
  if (!child?.pid || child.killed) { try { child?.kill?.(); } catch {} return Promise.resolve(); }
  if (process.platform !== 'win32') { child.kill('SIGTERM'); return Promise.resolve(); }
  return Promise.race([
    new Promise((resolve) => {
      // taskkill /T reaps the CLI's own grandchildren; without a bound it can hang dispose forever.
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
      killer.once('error', () => { try { child.kill(); } catch {} resolve(); });
      killer.once('exit', () => resolve());
    }),
    new Promise((resolve) => setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 5_000)),
  ]);
}
