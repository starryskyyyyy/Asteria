import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { JsonRpcPeer } from '../src/main/json-rpc.js';

class FakeStream extends EventEmitter {
  writes = [];
  write(value) { this.writes.push(value); return true; }
  end() {}
}

function fakeProcess() {
  const child = new EventEmitter();
  child.stdin = new FakeStream();
  child.stdout = new FakeStream();
  child.stderr = new FakeStream();
  child.kill = () => {};
  return child;
}

test('JSON-RPC parses responses split across arbitrary stdout chunks', async () => {
  const child = fakeProcess();
  const peer = new JsonRpcPeer(child, { timeoutMs: 100 });
  const pending = peer.request('model/list', {});
  const sent = JSON.parse(child.stdin.writes[0]);
  child.stdout.emit('data', Buffer.from(`{"id":${sent.id},"res`));
  child.stdout.emit('data', Buffer.from('ult":{"data":["gpt"]}}\n'));
  assert.deepEqual(await pending, { data: ['gpt'] });
  peer.dispose();
});

test('JSON-RPC rejects outstanding requests when the child exits', async () => {
  const child = fakeProcess();
  const peer = new JsonRpcPeer(child, { timeoutMs: 1000 });
  const pending = peer.request('thread/start', {});
  child.emit('exit', 2, null);
  await assert.rejects(pending, /exited.*2/i);
});

test('JSON-RPC emits complete notifications while retaining partial lines', () => {
  const child = fakeProcess();
  const peer = new JsonRpcPeer(child);
  const notifications = [];
  peer.on('notification', (message) => notifications.push(message));
  child.stdout.emit('data', Buffer.from('{"method":"item/started"}\n{"method":"item/del'));
  child.stdout.emit('data', Buffer.from('ta"}\n'));
  assert.deepEqual(notifications.map((item) => item.method), ['item/started', 'item/delta']);
  peer.dispose();
});

test('JSON-RPC preserves UTF-8 characters split across buffer chunks', () => {
  const child = fakeProcess();
  const peer = new JsonRpcPeer(child);
  const messages = [];
  peer.on('notification', (message) => messages.push(message));
  const bytes = Buffer.from('{"method":"item/agentMessage/delta","params":{"delta":"中文"}}\n');
  const split = bytes.indexOf(Buffer.from('中')) + 1;
  child.stdout.emit('data', bytes.subarray(0, split));
  child.stdout.emit('data', bytes.subarray(split));
  assert.equal(messages[0].params.delta, '中文');
  peer.dispose();
});
