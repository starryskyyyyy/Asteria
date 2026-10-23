import { spawn } from 'node:child_process';
import { JsonRpcPeer } from '../json-rpc.js';
import { resolveCli } from '../cli-discovery.js';
import { APP_NAME, APP_VERSION } from '../app-info.js';

// Current and legacy Codex app-server approval request names.
const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'execCommandApproval',
  'applyPatchApproval',
]);
const APPROVAL_TIMEOUT_MS = 120_000;

export class CodexAdapter {
  constructor({ cli, spawnImpl = spawn } = {}) {
    this.cli = cli;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.peer = null;
    this.models = [];
    this.activeTurn = null;
    this.eventSink = null;
    this.onToolCall = null;
    this.pendingApprovals = new Map();
    this.stderr = '';
  }

  async connect() {
    if (this.peer && this.child && !this.child.killed) return this.#connection();
    this.cli ??= await resolveCli('codex');
    if (!this.cli.entryPath) return { connected: false, executablePath: this.cli.executablePath, diagnostic: this.cli.diagnostic };
    try {
      const executable = this.cli.nodePath || this.cli.entryPath;
      const args = this.cli.nodePath ? [this.cli.entryPath, 'app-server', '--stdio'] : ['app-server', '--stdio'];
      const child = this.spawnImpl(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      const peer = new JsonRpcPeer(child, { timeoutMs: 30_000 });
      this.peer = peer;
      peer.on('stderr', (text) => { this.stderr = `${this.stderr}${text}`.slice(-10_000); this.eventSink?.({ type: 'stderr', text, raw: { stream: 'stderr' } }); });
      peer.on('notification', (message) => this.#notification(message));
      peer.on('request', (message) => this.#serverRequest(message));
      peer.on('malformed', (details) => this.eventSink?.({ type: 'malformed', text: details.line, raw: details }));
      peer.on('close', (error) => {
        if (this.peer === peer) this.peer = null;
        const active = this.activeTurn;
        if (active?.peer === peer) active.finish({ status: active.signal?.aborted ? 'cancelled' : 'failed', error: `Codex app-server closed: ${error?.message || 'process exited unexpectedly'}` });
      });
      await peer.request('initialize', {
        clientInfo: { name: 'asteria', title: APP_NAME, version: APP_VERSION },
        capabilities: { experimentalApi: true },
      });
      peer.notify('initialized', {});
      const catalog = await peer.request('model/list', {});
      this.models = (catalog?.data || []).map((model) => ({
        id: model.id || model.model,
        name: model.displayName || model.display_name || model.id || model.model,
        reasoningEfforts: (model.supportedReasoningEfforts || model.supported_reasoning_efforts || []).map((item) => typeof item === 'string' ? item : item.reasoningEffort || item.reasoning_effort).filter(Boolean),
      })).filter((model) => model.id);
      return this.#connection();
    } catch (error) {
      await this.#terminate();
      return { connected: false, executablePath: this.cli.executablePath, diagnostic: String(error?.message ?? error) };
    }
  }

  async run({ cwd, prompt, model, effort, readOnly = false, sessionId = null, dynamicTools = [], onToolCall = null }, onEvent = () => {}, signal) {
    if (signal?.aborted) return { status: 'cancelled', error: 'Cancelled before Codex turn start.' };
    if (!this.peer) {
      const connection = await this.connect();
      if (signal?.aborted) return { status: 'cancelled', error: 'Cancelled during Codex startup.' };
      if (!connection.connected) return { status: 'failed', error: connection.diagnostic };
    }
    this.eventSink = onEvent;
    this.onToolCall = onToolCall;
    let threadId = sessionId;
    if (threadId) {
      try { await this.peer.request('thread/resume', { threadId, model: model || null }); }
      catch { threadId = null; onEvent({ type: 'session_lost', text: '无法恢复此前的 Codex 会话，已改为开启新会话。' }); }
    }
    if (!threadId) {
      const startedThread = await this.peer.request('thread/start', {
        cwd,
        model: model || null,
        approvalPolicy: 'on-request',
        sandbox: readOnly ? 'read-only' : 'workspace-write',
        dynamicTools,
      });
      threadId = startedThread?.thread?.id;
    }
    if (signal?.aborted) return { status: 'cancelled', error: 'Cancelled after Codex thread startup.' };
    if (!threadId) return { status: 'failed', error: 'Codex app-server returned no thread ID.' };

    return new Promise((resolve) => {
      let settled = false;
      let turnId;
      let resolveDone;
      const active = { threadId, turnId: null, peer: this.peer, signal, settled: false, cancelTimeout: null, stopPromise: null, done: new Promise((resolveResult) => { resolveDone = resolveResult; }) };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        active.settled = true;
        if (active.cancelTimeout) clearTimeout(active.cancelTimeout);
        signal?.removeEventListener('abort', abort);
        if (this.activeTurn === active) this.activeTurn = null;
        this.eventSink = null;
        this.onToolCall = null;
        const finished = { ...result, sessionId: threadId };
        resolve(finished);
        resolveDone(finished);
      };
      const abort = () => { void this.#interruptActive(active); };
      active.finish = finish;
      this.activeTurn = active;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { finish({ status: 'cancelled', error: 'Cancelled before the Codex turn started.' }); return; }
      this.peer.request('turn/start', {
        threadId,
        model: model || null,
        effort: effort || null,
        input: [{ type: 'text', text: prompt }],
      }).then((startedTurn) => {
        if (settled) return;
        turnId = startedTurn?.turn?.id;
        active.turnId = turnId;
        if (!turnId) finish({ status: 'failed', error: 'Codex app-server returned no turn ID.' });
      }).catch((error) => finish({ status: signal?.aborted ? 'cancelled' : 'failed', error: String(error?.message ?? error) }));
    });
  }

  async resolveApproval(requestId, accepted) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;
    this.pendingApprovals.delete(requestId);
    clearTimeout(pending.timer);
    this.peer?.respond(requestId, { decision: accepted ? 'accept' : 'decline' });
    return true;
  }

  async stop() {
    const active = this.activeTurn;
    if (active) await this.#interruptActive(active);
  }

  async dispose() {
    await this.stop();
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timer);
      try { this.peer?.respondError(id, -32000, 'Asteria closed before the approval was resolved.'); } catch {}
    }
    this.pendingApprovals.clear();
    await this.#terminate();
  }

  #connection() {
    return { connected: true, executablePath: this.cli.executablePath, version: this.cli.version || 'unknown', models: this.models, capabilities: { modelSelection: true, reasoningEffort: true, approval: true, cancel: 'turn/interrupt' }, diagnostic: '' };
  }

  #serverRequest(message) {
    if (message.method === 'item/tool/call') {
      const active = this.activeTurn;
      if (!active || typeof this.onToolCall !== 'function') {
        this.peer?.respond(message.id, { contentItems: [{ type: 'inputText', text: 'Asteria tool broker is unavailable.' }], success: false });
        return;
      }
      Promise.resolve(this.onToolCall(message.params?.tool, message.params?.arguments || {})).then((result) => {
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        this.peer?.respond(message.id, { contentItems: [{ type: 'inputText', text }], success: true });
      }).catch((error) => this.peer?.respond(message.id, { contentItems: [{ type: 'inputText', text: String(error?.message || error) }], success: false }));
      return;
    }
    if (APPROVAL_METHODS.has(message.method)) {
      const timer = setTimeout(() => {
        if (!this.pendingApprovals.has(message.id)) return;
        // Tell the host the prompt expired instead of silently dropping it from the UI.
        this.eventSink?.({ type: 'approval_expired', text: 'Codex 审批请求超时，已自动拒绝。', raw: message });
        this.resolveApproval(message.id, false).catch(() => {});
      }, APPROVAL_TIMEOUT_MS);
      this.pendingApprovals.set(message.id, { method: message.method, timer });
      this.eventSink?.({ type: 'approval_request', text: `Codex 请求批准：${message.method}`, raw: message });
      return;
    }
    // Unknown server requests are reported, but they must not kill the whole turn: new app-server
    // methods appear between Codex releases and a hard failure would brick the session.
    this.peer?.respondError(message.id, -32601, `Unsupported app-server request: ${message.method}`);
    this.eventSink?.({ type: 'unsupported_request', text: `Unsupported app-server request: ${message.method}`, raw: message });
  }

  #notification(message) {
    this.eventSink?.({ type: message.method, text: notificationText(message), raw: message });
    if (message.method !== 'turn/completed') return;
    const turn = message.params?.turn;
    const active = this.activeTurn;
    if (!active || (turn?.id && active.turnId && turn.id !== active.turnId)) return;
    const output = finalAssistantText(turn?.items || []);
    const status = turn?.status;
    if (status === 'completed') active.finish({ status: 'completed', output });
    else if (status === 'interrupted') active.finish({ status: 'cancelled', output, error: 'Codex turn interrupted.' });
    else active.finish({ status: 'failed', output, error: turn?.error?.message || `Codex turn ended with status ${status || 'unknown'}.` });
  }

  async #interruptActive(active) {
    if (active.stopPromise) return active.stopPromise;
    active.stopPromise = (async () => {
      if (active.settled) return;
      try {
        if (active.turnId && active.peer) await active.peer.request('turn/interrupt', { threadId: active.threadId, turnId: active.turnId }, 5_000);
      } catch {}
      if (active.settled) return;
      let timer;
      await Promise.race([active.done, new Promise((resolve) => { timer = setTimeout(resolve, 3_000); })]);
      if (timer) clearTimeout(timer);
      if (!active.settled) {
        await this.#terminate();
        active.finish({ status: 'cancelled', error: 'Codex turn was interrupted.' });
      }
    })();
    return active.stopPromise;
  }

  async #terminate() {
    const peer = this.peer;
    const child = this.child;
    this.peer = null;
    this.child = null;
    this.eventSink = null;
    this.onToolCall = null;
    peer?.dispose();
    if (!child || child.killed) return;
    if (process.platform === 'win32' && child.pid) {
      // taskkill /T cleans up the CLI's own children; without a timeout a stuck killer blocks dispose.
      await Promise.race([
        new Promise((resolve) => {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
          killer.once('error', () => { try { child.kill(); } catch {} resolve(); });
          killer.once('exit', () => resolve());
        }),
        new Promise((resolve) => setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 5_000)),
      ]);
    } else child.kill();
  }
}

function finalAssistantText(items) {
  const finals = items.filter((item) => item?.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase === 'finalAnswer'));
  const source = finals.length ? finals : items.filter((item) => item?.type === 'agentMessage');
  return source.map((item) => item.text || '').join('\n').trim();
}

function notificationText(message) {
  const params = message.params || {};
  if (typeof params.delta === 'string') return params.delta;
  if (typeof params.text === 'string') return params.text;
  if (params.item?.type === 'commandExecution') return params.item.command || params.item.status || '命令执行';
  if (params.item?.type === 'fileChange') return params.item.status || '文件修改';
  if (params.item?.type === 'agentMessage') return params.item.text || '';
  if (params.turn?.status) return `turn ${params.turn.status}`;
  return '';
}
