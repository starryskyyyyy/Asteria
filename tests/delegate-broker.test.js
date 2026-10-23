import test from 'node:test';
import assert from 'node:assert/strict';
import { DelegateBroker } from '../src/main/delegate-broker.js';

test('MCP endpoint serves model listing and routes a structured real delegate call', async () => {
  const calls = [];
  const broker = new DelegateBroker({ handlers: { listModels: async () => ({ codex: [{ id: 'gpt' }], dsh: [] }), delegate: async (args) => { calls.push(args); return { status: 'completed', output: 'child result' }; } } });
  try {
    const url = await broker.start();
    const rpc = async (id, method, params = {}) => {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
      return response.json();
    };
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26' });
    assert.equal(init.result.serverInfo.name, 'asteria-delegation');
    const listed = await rpc(2, 'tools/list');
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['asteria_list_models', 'asteria_delegate']);
    const result = await rpc(3, 'tools/call', { name: 'asteria_delegate', arguments: { cli: 'dsh', task: 'inspect' } });
    assert.match(result.result.content[0].text, /child result/);
    assert.deepEqual(calls, [{ cli: 'dsh', task: 'inspect' }]);
    const denied = await fetch(`${url}/wrong`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 404);
    for (const body of ['null', '[]', '{']) {
      const response = await fetch(url, { method: 'POST', body });
      assert.equal(response.status, 400);
    }
  } finally { await broker.close(); }
});
