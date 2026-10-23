import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { StreamJsonAdapter } from '../src/main/providers/stream-json.js';

/**
 * Fake CLI process. `script` receives each parsed JSON message the adapter writes to stdin, plus a
 * helper that pushes one stdout line back.
 */
function makeChild(script) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.writes = [];
  child.stdin = {
    writable: true,
    destroyed: false,
    write(chunk) {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        child.writes.push(payload);
        if (script) script(payload, (text) => child.stdout.emit('data', `${JSON.stringify(text)}\n`));
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

const cli = { entryPath: 'C:\\Other\\cli.js', nodePath: 'C:\\Node\\node.exe' };

test('stream-json adapter passes a prompt, the model and the resume id as CLI flags', async () => {
  const child = makeChild();
  const adapter = new StreamJsonAdapter({ cli, cliId: 'claude', spec: { permissionMode: 'acceptEdits' }, spawnImpl: () => child });
  const running = adapter.run({ cwd: 'C:\\work', prompt: '检查一下', model: 'claude-opus-4', sessionId: 'session-9' }, () => {});
  child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-9', model: 'claude-opus-4' })}\n`);
  child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '好的' }] } })}\n`);
  child.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'success', session_id: 'session-9' })}\n`);
  child.emit('close', 0);
  const result = await running;

  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.output, '好的');
  assert.equal(result.sessionId, 'session-9');
});

test('stream-json adapter builds the documented argument list', async () => {
  const child = makeChild();
  let captured = null;
  const adapter = new StreamJsonAdapter({ cli, cliId: 'claude', spec: { permissionMode: 'acceptEdits' }, spawnImpl: (file, args, options) => { captured = { file, args, options }; return child; } });
  const running = adapter.run({ cwd: 'C:\\work', prompt: '检查一下', model: 'claude-opus-4', sessionId: 'session-9' }, () => {});
  child.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'success' })}\n`);
  child.emit('close', 0);
  await running;

  assert.equal(captured.file, 'C:\\Node\\node.exe');
  assert.deepEqual(captured.args, [
    'C:\\Other\\cli.js',
    '-p', '检查一下',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', 'claude-opus-4',
    '--permission-mode', 'acceptEdits',
    '--resume', 'session-9',
  ]);
  assert.equal(captured.options.windowsHide, true);
});

test('stream-json adapter does not duplicate text when deltas were already streamed', async () => {
  const child = makeChild();
  const adapter = new StreamJsonAdapter({ cli, cliId: 'codebuddy', spawnImpl: () => child });
  const events = [];
  const running = adapter.run({ cwd: 'C:\\work', prompt: '你好' }, (event) => events.push(event));
  child.stdout.emit('data', `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text: '你好' } } })}\n`);
  child.stdout.emit('data', `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text: '世界' } } })}\n`);
  child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '你好世界' }] } })}\n`);
  child.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'success' })}\n`);
  child.emit('close', 0);
  const result = await running;

  assert.equal(result.output, '你好世界');
  const chunks = events.filter((event) => event.type === 'agent_message_chunk').map((event) => event.text);
  assert.deepEqual(chunks, ['你好', '世界']);
});

test('stream-json adapter reports a failed result instead of a silent exit', async () => {
  const child = makeChild();
  const adapter = new StreamJsonAdapter({ cli, cliId: 'claude', spawnImpl: () => child });
  const running = adapter.run({ cwd: 'C:\\work', prompt: '你好' }, () => {});
  child.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '没有登录' })}\n`);
  child.emit('close', 0);
  const result = await running;

  assert.equal(result.status, 'failed');
  assert.match(result.error, /没有登录/);
});

test('stream-json adapter refuses to start without an entry path', async () => {
  const adapter = new StreamJsonAdapter({ cli: {}, cliId: 'claude', spawnImpl: () => { throw new Error('should not spawn'); } });
  const result = await adapter.run({ cwd: 'C:\\work', prompt: '你好' }, () => {});
  assert.equal(result.status, 'failed');
  assert.match(result.error, /claude/);
});
