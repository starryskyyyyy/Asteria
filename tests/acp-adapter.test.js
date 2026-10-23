import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AcpAdapter } from '../src/main/providers/acp.js';

/**
 * Minimal ACP peer: parses every JSON line the adapter writes and lets the test answer it.
 * `handler(message, reply)` returns nothing; call `reply(result)` or `notify(method, params)`.
 */
function makeServer(handler) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.writes = [];
  const reply = (payload) => child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`);
  child.stdin = {
    writable: true,
    destroyed: false,
    write(chunk) {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        child.writes.push(message);
        handler(message, reply, child);
      }
      return true;
    },
    end() {},
    on() {},
    once() {},
    removeListener() {},
  };
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

const spec = { acpArgs: ['--profile', 'acp'], nodeArgs: ['--use-system-ca'] };
const cli = { nodePath: 'C:\\Node\\node.exe', entryPath: 'C:\\DSH\\bin.js' };

test('acp adapter launches the CLI with its registry args and completes a turn', async () => {
  let spawnArgs = null;
  const child = makeServer((message, reply) => {
    if (message.method === 'initialize') reply({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: 'gemini' } } });
    else if (message.method === 'session/new') reply({ id: message.id, result: { sessionId: 'session-1' } });
    else if (message.method === 'session/prompt') {
      reply({ method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP 回复' } } } });
      reply({ id: message.id, result: { stopReason: 'end_turn' } });
    }
  });
  const adapter = new AcpAdapter({
    cli,
    cliId: 'gemini',
    spec,
    spawnImpl: (command, args) => { spawnArgs = { command, args }; return child; },
  });

  const connection = await adapter.connect({ cwd: 'C:\\work' });
  assert.equal(connection.connected, true);
  assert.equal(connection.sessionId, 'session-1');
  assert.equal(spawnArgs.command, 'C:\\Node\\node.exe');
  assert.deepEqual(spawnArgs.args, ['--use-system-ca', 'C:\\DSH\\bin.js', '--profile', 'acp']);

  const events = [];
  const result = await adapter.run({ cwd: 'C:\\work', prompt: '你好' }, (event) => events.push(event));
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.output, 'ACP 回复');
  assert.equal(result.sessionId, 'session-1');
  assert.ok(events.some((event) => event.type === 'agent_message_chunk' && event.text === 'ACP 回复'));
});

test('acp adapter surfaces a permission request and answers the selected option', async () => {
  const seen = [];
  let promptId = null;
  let permissionAnswer = null;
  let onApproval = null;
  const approvalSeen = new Promise((resolve) => { onApproval = resolve; });

  const child = makeServer((message, reply) => {
    if (message.method === 'initialize') reply({ id: message.id, result: { protocolVersion: 1 } });
    else if (message.method === 'session/new') reply({ id: message.id, result: { sessionId: 'session-1' } });
    else if (message.method === 'session/prompt') {
      promptId = message.id;
      reply({
        id: 77,
        method: 'session/request_permission',
        params: {
          sessionId: 'session-1',
          toolCall: { title: '写文件' },
          options: [
            { optionId: 'o1', kind: 'allow_once', name: '允许一次' },
            { optionId: 'o2', kind: 'reject_once', name: '拒绝一次' },
          ],
        },
      });
    } else if (message.id === 77 && !message.method) {
      permissionAnswer = message.result;
      reply({ id: promptId, result: { stopReason: 'end_turn' } });
    }
  });

  const adapter = new AcpAdapter({ cli, cliId: 'kiro', spec, spawnImpl: () => child });
  await adapter.connect({ cwd: 'C:\\work' });

  const running = adapter.run({ cwd: 'C:\\work', prompt: '改一下文件' }, (event) => {
    seen.push(event);
    if (event.type === 'approval_request') onApproval();
  });
  await approvalSeen;

  const approval = seen.find((event) => event.type === 'approval_request');
  assert.match(approval.text, /写文件/);
  assert.equal(await adapter.resolvePermission(77, 'o1'), true);

  const result = await running;
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(permissionAnswer, { outcome: { outcome: 'selected', optionId: 'o1' } });
});

test('acp adapter rejects an unknown permission option instead of guessing', async () => {
  const child = makeServer((message, reply) => {
    if (message.method === 'initialize') reply({ id: message.id, result: { protocolVersion: 1 } });
    else if (message.method === 'session/new') reply({ id: message.id, result: { sessionId: 'session-1' } });
    else if (message.method === 'session/prompt') {
      reply({ id: 91, method: 'session/request_permission', params: { sessionId: 'session-1', options: [{ optionId: 'o1', kind: 'allow_once' }] } });
    }
  });
  const adapter = new AcpAdapter({ cli, cliId: 'qwen', spec, spawnImpl: () => child });
  await adapter.connect({ cwd: 'C:\\work' });
  const running = adapter.run({ cwd: 'C:\\work', prompt: '你好' }, () => {});
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(await adapter.resolvePermission(91, 'nope'), false);
  assert.equal(await adapter.resolvePermission(404, 'o1'), false);
  await adapter.stop();
  await running;
});
