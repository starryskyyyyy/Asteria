import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DshAcpAdapter } from '../src/main/providers/dsh.js';

class Stream extends EventEmitter { write(value) { this.onWrite?.(String(value)); return true; } end() {} }
function options(model = '["deepseek-official","deepseek-v4-flash"]') {
  return [
    { id: 'model', currentValue: model, options: [
      { group: 'deepseek-official', options: [{ value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' }, { value: '["deepseek-account","deepseek-v4-pro"]', name: 'deepseek-v4-pro' }] },
    ] },
    { id: 'reasoning_effort', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
  ];
}
function fakeChild() {
  const child = new EventEmitter(); child.stdin = new Stream(); child.stdout = new Stream(); child.stderr = new Stream(); child.killed = false; child.kill = () => { child.killed = true; };
  child.requests = [];
  child.stdin.onWrite = (line) => {
    const request = JSON.parse(line); if (request.id === undefined) return;
    child.requests.push(request);
    let result = {};
    if (request.method === 'initialize') result = { protocolVersion: 1, agentInfo: { name: 'dsh' }, agentCapabilities: { mcpCapabilities: { http: true } } };
    if (request.method === 'session/new') result = { sessionId: 'session-1', configOptions: options() };
    if (request.method === 'session/set_config_option') result = { configOptions: options(request.params.configId === 'model' ? request.params.value : '["deepseek-account","deepseek-v4-pro"]') };
    if (request.method === 'session/prompt') {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'DSH 回复' } } } })}\n`));
      result = { stopReason: 'end_turn' };
    }
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: request.id, result })}\n`));
  };
  return child;
}

test('ACP loads live provider catalog, selects exact route and effort, and returns streamed answer', async () => {
  const child = fakeChild(); let command;
  const adapter = new DshAcpAdapter({ cli: { nodePath: 'C:\\Node\\node.exe', entryPath: 'C:\\DSH\\bin.js' }, spawnImpl: (file, args, options) => { command = { file, args, options }; return child; } });
  const connection = await adapter.connect({ cwd: process.cwd(), mcpUrl: 'http://127.0.0.1:9001/token' });
  assert.equal(connection.connected, true);
  assert.deepEqual(connection.models.map((item) => `${item.provider}/${item.id}`), ['deepseek-official/deepseek-v4-flash', 'deepseek-account/deepseek-v4-pro']);
  assert.deepEqual(command.args, ['--use-system-ca', 'C:\\DSH\\bin.js', '--profile', 'acp']);
  assert.equal(command.options.windowsHide, true);
  const events = [];
  const result = await adapter.run({ cwd: process.cwd(), prompt: '请回答', provider: 'deepseek-account', model: 'deepseek-v4-pro', effort: 'low' }, (event) => events.push(event), new AbortController().signal);
  assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.output, 'DSH 回复'); assert.equal(result.sessionId, 'session-1');
  assert(child.requests.some((request) => request.method === 'session/set_config_option' && request.params.value === '["deepseek-account","deepseek-v4-pro"]'));
  assert(child.requests.some((request) => request.method === 'session/set_config_option' && request.params.configId === 'reasoning_effort' && request.params.value === 'low'));
  assert(events.some((event) => event.type === 'agent_message_chunk' && event.text === 'DSH 回复'));
  await adapter.dispose();
});

test('ACP separates streamed assistant messages when messageId changes', async () => {
  const child = fakeChild();
  const originalWrite = child.stdin.onWrite;
  child.stdin.onWrite = (line) => {
    const request = JSON.parse(line);
    if (request.method !== 'session/prompt') return originalWrite(line);
    child.requests.push(request);
    const emit = (messageId, text) => child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text } } } })}\n`));
    emit('76f5a4b1', '我先委派子代理完成检查。');
    emit('40deb7c2', '## 跨 CLI 的结果\n\n继续总结。');
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: request.id, result: { stopReason: 'end_turn' } })}\n`));
  };
  const adapter = new DshAcpAdapter({ cli: { nodePath: 'C:\\Node\\node.exe', entryPath: 'C:\\DSH\\bin.js' }, spawnImpl: () => child });
  await adapter.connect({ cwd: process.cwd() });
  const events = [];
  const result = await adapter.run({ cwd: process.cwd(), prompt: 'test', provider: 'deepseek-official', model: 'deepseek-v4-flash' }, (event) => events.push(event), new AbortController().signal);
  const expected = '我先委派子代理完成检查。\n\n## 跨 CLI 的结果\n\n继续总结。';
  assert.equal(result.status, 'completed');
  assert.equal(result.output, expected);
  assert.equal(events.filter((event) => event.type === 'agent_message_chunk').map((event) => event.text).join(''), expected);
  await adapter.dispose();
});
