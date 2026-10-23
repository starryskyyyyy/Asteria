import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexAdapter } from '../src/main/providers/codex.js';

class Stream extends EventEmitter { write(value) { this.onWrite?.(String(value)); return true; } end() {} }

function serverChild({ autoComplete = true, interruptOrder = 'reply-first' } = {}) {
  const child = new EventEmitter();
  child.stdin = new Stream(); child.stdout = new Stream(); child.stderr = new Stream(); child.kill = () => { child.killed = true; };
  child.requests = [];
  child.autoComplete = autoComplete;
  child.completeTurn = (status = 'completed') => child.stdout.emit('data', Buffer.from(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status, items: [{ type: 'agentMessage', phase: 'final_answer', text: 'finished' }] } } }) + '\n'));
  child.stdin.onWrite = (line) => {
    const request = JSON.parse(line); child.requests.push(request);
    let result = {};
    if (request.method === 'model/list') result = { data: [{ id: 'gpt-6-luna', supportedReasoningEfforts: ['low', 'high'] }] };
    if (request.method === 'thread/start') result = { thread: { id: 'thread-1' } };
    if (request.method === 'turn/start') {
      result = { turn: { id: 'turn-1', status: 'inProgress' } };
    }
    child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result }) + '\n'));
    if (request.method === 'turn/start' && child.autoComplete) setImmediate(() => child.completeTurn());
    if (request.method === 'turn/interrupt') {
      const complete = () => child.completeTurn('interrupted');
      if (interruptOrder === 'terminal-first') { complete(); child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: {} }) + '\n')); }
      else { child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: {} }) + '\n')); setImmediate(complete); }
    }
  };
  return child;
}

test('initializes app-server, lists models, and uses schema-supported sandbox and final answer fields', async () => {
  const child = serverChild();
  const adapter = new CodexAdapter({ cli: { nodePath: 'node.exe', entryPath: 'codex.js' }, spawnImpl: () => child });
  const connection = await adapter.connect();
  assert.deepEqual(connection.models.map((model) => model.id), ['gpt-6-luna']);
  const events = [];
  const result = await adapter.run({ cwd: 'C:\\项目 有空格', prompt: '请原文处理', model: 'gpt-6-luna', effort: 'high', readOnly: true }, (event) => events.push(event), new AbortController().signal);
  const thread = child.requests.find((request) => request.method === 'thread/start').params;
  const turn = child.requests.find((request) => request.method === 'turn/start').params;
  assert.equal(thread.sandbox, 'read-only');
  assert.equal(thread.approvalPolicy, 'on-request');
  assert.equal(thread.cwd, 'C:\\项目 有空格');
  assert.equal(turn.effort, 'high');
  assert.deepEqual(turn.input, [{ type: 'text', text: '请原文处理' }]);
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'finished');
  assert(events.some((event) => event.raw?.method === 'turn/completed'));
  await adapter.dispose();
});

test('rejects an unknown app-server request promptly instead of leaving it pending', async () => {
  const child = serverChild();
  const outbound = [];
  child.stdin.onWrite = (line) => {
    const request = JSON.parse(line);
    outbound.push(request);
    if (request.method === 'initialize') child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: {} }) + '\n'));
    if (request.method === 'model/list') child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: { data: [] } }) + '\n'));
  };
  const adapter = new CodexAdapter({ cli: { nodePath: 'node.exe', entryPath: 'codex.js' }, spawnImpl: () => child });
  await adapter.connect();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ id: 'server-ask-1', method: 'unsupported/request', params: {} }) + '\n'));
  await new Promise((resolve) => setImmediate(resolve));
  const response = outbound.find((request) => request.id === 'server-ask-1');
  assert.equal(response.error.code, -32601);
  await adapter.dispose();
});

test('fails an owned turn when its app-server exits without turn/completed', async () => {
  const child = serverChild({ autoComplete: false });
  const adapter = new CodexAdapter({ cli: { nodePath: 'node.exe', entryPath: 'codex.js' }, spawnImpl: () => child });
  await adapter.connect();
  const running = adapter.run({ cwd: 'C:\\work', prompt: 'task' }, () => {}, new AbortController().signal);
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('exit', 1, null);
  const result = await Promise.race([running, new Promise((resolve) => setTimeout(() => resolve('timeout'), 100))]);
  assert.equal(result.status, 'failed');
  await adapter.dispose();
});

for (const interruptOrder of ['reply-first', 'terminal-first']) {
  test(`stop waits for the interrupted turn (${interruptOrder})`, async () => {
    const child = serverChild({ autoComplete: false, interruptOrder });
    const adapter = new CodexAdapter({ cli: { nodePath: 'node.exe', entryPath: 'codex.js' }, spawnImpl: () => child });
    await adapter.connect();
    const controller = new AbortController();
    const running = adapter.run({ cwd: 'C:\\work', prompt: 'task' }, () => {}, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await adapter.stop();
    assert.equal((await running).status, 'cancelled');
    assert.equal(adapter.activeTurn, null);
    await adapter.dispose();
  });
}

test('exposes known approval requests and sends one-time accept or decline responses', async () => {
  const child = serverChild({ autoComplete: false });
  const adapter = new CodexAdapter({ cli: { nodePath: 'node.exe', entryPath: 'codex.js' }, spawnImpl: () => child });
  await adapter.connect();
  const events = [];
  const running = adapter.run({ cwd: 'C:\\work', prompt: 'task' }, (event) => events.push(event), new AbortController().signal);
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'git status' } }) + '\n'));
  assert.equal(await adapter.resolveApproval('approval-1', true), true);
  const response = child.requests.find((request) => request.id === 'approval-1');
  assert.deepEqual(response.result, { decision: 'accept' });
  assert(events.some((event) => event.type === 'approval_request'));
  child.completeTurn();
  await running;
  await adapter.dispose();
});
