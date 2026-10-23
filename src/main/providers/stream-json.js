import { spawn as spawnCallback } from 'node:child_process';

/**
 * Adapter for CLIs that speak the Claude Code "stream-json" convention: one process per turn,
 * newline-delimited JSON on stdout.
 *
 * Verified against Claude Code 2.1.207 and CodeBuddy 2.161.0 — both emit
 * `{"type":"system","subtype":"init",...}` first, then `assistant` / `stream_event` objects, and a
 * final `{"type":"result",...}`. CodeBuddy is a strict superset dialect, so one implementation serves
 * both; per-CLI differences live in the registry entry (`spec`), never in this file.
 *
 * Limitations by design: no resident session (a fresh process per turn), no in-flight approval
 * prompts (`--permission-mode` decides policy up front), no host-provided tools — so `delegates` is
 * false for these agents.
 */
export class StreamJsonAdapter {
  constructor({ cli, cliId, spec = {}, spawnImpl = spawnCallback, onEvent = () => {} } = {}) {
    this.cli = cli;
    this.cliId = cliId;
    this.spec = spec;
    this.label = spec?.label || cliId;
    this.spawnImpl = spawnImpl;
    this.onEvent = onEvent;
    this.child = null;
    this.sessionId = null;
    this.stderr = '';
    this.active = null;
  }

  /** No handshake exists in this protocol; report the static catalog and let `--version` do the probing. */
  async connect() {
    const models = (this.spec.models || []).map((model) => ({ ...model }));
    return { connected: true, models, efforts: [], diagnostic: '' };
  }

  async run({ cwd, prompt, model, sessionId = null }, onEvent = this.onEvent, signal) {
    if (signal?.aborted) return { status: 'cancelled', error: '取消后未启动该轮对话。' };
    const cli = this.cli || {};
    const scriptPath = cli.entryPath || cli.executablePath;
    if (!scriptPath) return { status: 'failed', error: `未找到 ${this.label} 的可执行入口。` };
    const command = cli.nodePath || scriptPath;
    const scriptArgs = cli.nodePath ? [scriptPath] : [];
    const args = [...scriptArgs, ...this.#turnArgs(prompt, model, sessionId)];
    const env = { ...process.env, ...(this.spec.env || {}) };

    let child;
    try {
      child = this.spawnImpl(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      return { status: 'failed', error: String(error?.message || error) };
    }
    this.child = child;
    this.stderr = '';

    return new Promise((resolve) => {
      const state = { pieces: [], live: '', sawDelta: false, result: null, sessionId, settled: false, errorText: '' };
      this.active = { child, signal, finish: (outcome) => settle(outcome) };

      const settle = (outcome) => {
        if (state.settled) return;
        state.settled = true;
        this.active = null;
        this.child = null;
        resolve(outcome);
      };

      const onAbort = () => {
        this.#kill(child);
        settle({ status: 'cancelled', error: '已停止生成。', sessionId: state.sessionId, output: this.#output(state) });
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.setEncoding('utf8');
      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let index;
        // NDJSON: only complete lines are parsed; a partial tail waits for the next chunk.
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) this.#handleLine(line, state, onEvent);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-8000); });

      child.on('error', (error) => {
        settle({ status: 'failed', error: `无法启动 ${this.label}：${String(error?.message || error)}`, sessionId: state.sessionId, output: this.#output(state) });
      });
      child.on('close', (code) => {
        if (buffer.trim()) this.#handleLine(buffer.trim(), state, onEvent);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (state.settled) return;
        const output = this.#output(state);
        const failure = state.result && state.result.is_error === true;
        if (signal?.aborted) settle({ status: 'cancelled', error: '已停止生成。', sessionId: state.sessionId, output });
        else if (code === 0 && !failure) settle({ status: 'completed', error: '', sessionId: state.sessionId || state.result?.session_id || null, output });
        else settle({ status: 'failed', error: state.errorText || state.result?.result || this.stderr.trim() || `${this.label} 退出码 ${code}`, sessionId: state.sessionId || state.result?.session_id || null, output });
      });
    });
  }

  /** The protocol has no approval channel: policy is chosen with `--permission-mode` before the turn. */
  async resolveApproval() { return false; }
  async resolvePermission() { return false; }

  async stop() {
    if (this.child) this.#kill(this.child);
    if (this.active) this.active.finish({ status: 'cancelled', error: '已停止生成。' });
  }

  async dispose() {
    await this.stop();
    this.child = null;
  }

  #turnArgs(prompt, model, sessionId) {
    const spec = this.spec || {};
    const args = ['-p', String(prompt), '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    // `default-model`/`auto` mean "whatever the CLI is configured with"; passing them back is an error.
    if (model && !['auto', 'default', 'default-model'].includes(model)) args.push('--model', model);
    if (spec.permissionMode) args.push('--permission-mode', spec.permissionMode);
    if (sessionId) args.push('--resume', sessionId);
    return args;
  }

  #output(state) {
    const joined = state.pieces.join('');
    return joined || state.live;
  }

  #handleLine(line, state, onEvent) {
    let payload;
    try { payload = JSON.parse(line); } catch { return; }
    if (!payload || typeof payload !== 'object') return;
    const emit = (event) => { try { onEvent(event); } catch {} };
    if (payload.session_id) state.sessionId = payload.session_id;

    switch (payload.type) {
      case 'system': {
        if (payload.subtype === 'init') emit({ type: 'session_started', text: `${this.label} 会话就绪（模型 ${payload.model || '默认'}）`, raw: payload });
        else emit({ type: 'provider_status', text: String(payload.status || payload.subtype || 'system'), raw: payload });
        return;
      }
      case 'stream_event': {
        const delta = payload.event?.delta?.text;
        if (payload.event?.type === 'content_block_delta' && typeof delta === 'string') {
          state.sawDelta = true;
          state.live += delta;
          emit({ type: 'agent_message_chunk', text: delta, raw: payload });
        }
        return;
      }
      case 'assistant': {
        for (const block of payload.message?.content || []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            state.pieces.push(block.text);
            // Deltas already painted this text; only emit when the CLI did not stream it.
            if (!state.sawDelta) emit({ type: 'agent_message_chunk', text: block.text, raw: payload });
          } else if (block.type === 'tool_use') {
            emit({ type: 'tool_call', text: `${block.name}`, raw: payload });
          }
        }
        return;
      }
      case 'user': {
        for (const block of payload.message?.content || []) if (block.type === 'tool_result') emit({ type: 'tool_result', text: '', raw: payload });
        return;
      }
      case 'result': {
        state.result = payload;
        if (payload.result && !state.pieces.length) state.pieces.push(String(payload.result));
        if (payload.is_error) {
          const detail = `${payload.result || ''} ${state.pieces.join(' ')}`;
          // Auth failures arrive as an ordinary error frame; translate them into an actionable hint
          // instead of showing the protocol's own error code.
          state.errorText = /authentication required|please (use \/login|sign in|log in)|not logged in|unauthori[sz]ed/i.test(detail)
            ? `${this.label} 尚未登录：请先单独运行该 CLI 完成一次登录（在它的交互界面里执行 /login），再回到 Asteria 重试。`
            : String(payload.result || payload.subtype || 'CLI 返回了错误。');
        }
        emit({ type: 'turn_result', text: `本轮结束：${payload.subtype || (payload.is_error ? 'error' : 'success')}`, raw: payload });
        return;
      }
      default: {
        emit({ type: payload.type || 'event', text: '', raw: payload });
      }
    }
  }

  #kill(child) {
    if (!child || child.killed) return;
    try {
      // Windows CLIs spawn grandchildren (shell tools); kill the whole tree or they leak.
      if (process.platform === 'win32' && child.pid) spawnCallback('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    } catch {}
  }
}
