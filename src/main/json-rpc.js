import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

export class JsonRpcPeer extends EventEmitter {
  #child;
  #buffer = '';
  #decoder = new StringDecoder('utf8');
  #stderrDecoder = new StringDecoder('utf8');
  #nextId = 1;
  #pending = new Map();
  #closedError = null;

  #stderrTail = '';

  constructor(child, { timeoutMs = 120_000, label = 'CLI' } = {}) {
    super();
    this.#child = child;
    this.label = label;
    this.timeoutMs = timeoutMs;
    child.stdout?.on('data', (chunk) => this.#consume(chunk));
    child.stderr?.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? this.#stderrDecoder.write(chunk) : String(chunk);
      this.#stderrTail = `${this.#stderrTail}${text}`.slice(-4000);
      this.emit('stderr', text);
    });
    child.on('error', (error) => this.#fail(error));
    child.on('exit', (code, signal) => this.#fail(new Error(this.#exitMessage(code, signal))));
  }

  // 退出原因必须让用户看懂：把最后一条 stderr 一并带出来，否则只看到「进程退出」无从排查。
  #exitMessage(code, signal) {
    const reason = `${this.label} 进程已退出（code ${code ?? 'null'}${signal ? `, ${signal}` : ''}）`;
    const detail = this.#stderrTail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    return detail ? `${reason}：${detail.slice(0, 300)}` : reason;
  }

  request(method, params = {}, timeoutMs = this.timeoutMs) {
    if (this.#closedError) return Promise.reject(this.#closedError);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`JSON-RPC request ${method} timed out`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      try { this.#write({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
    });
  }

  notify(method, params = {}) { this.#write({ jsonrpc: '2.0', method, params }); }

  respond(id, result) { this.#write({ jsonrpc: '2.0', id, result }); }

  respondError(id, code, message) { this.#write({ jsonrpc: '2.0', id, error: { code, message } }); }

  dispose() { this.#fail(new Error('JSON-RPC peer disposed')); }

  #write(value) {
    if (this.#closedError) throw this.#closedError;
    try { this.#child.stdin.write(`${JSON.stringify(value)}\n`); }
    catch (error) { this.#fail(error); throw error; }
  }

  #consume(chunk) {
    this.#buffer += Buffer.isBuffer(chunk) ? this.#decoder.write(chunk) : String(chunk);
    if (this.#buffer.length > MAX_BUFFERED_BYTES) {
      this.#buffer = '';
      this.#fail(new Error(`app-server emitted more than ${MAX_BUFFERED_BYTES} bytes without a newline`));
      return;
    }
    let newline;
    while ((newline = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch (error) { this.emit('malformed', { line, error: String(error) }); continue; }
      if (Object.hasOwn(message, 'id') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
        const pending = this.#pending.get(message.id);
        if (!pending) { this.emit('orphan-response', message); continue; }
        clearTimeout(pending.timer);
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message ?? JSON.stringify(message.error)}`));
        else pending.resolve(message.result);
      } else if (message.method && Object.hasOwn(message, 'id')) this.emit('request', message);
      else if (message.method) this.emit('notification', message);
      else this.emit('message', message);
    }
  }

  #fail(error) {
    if (this.#closedError) return;
    this.#closedError = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.emit('close', error);
  }
}
