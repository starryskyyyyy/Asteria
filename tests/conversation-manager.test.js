import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { removeDir } from './helpers/fs-utils.js';
import os from 'node:os';
import path from 'node:path';
import { ConversationManager } from '../src/main/conversation-manager.js';

class FakeAdapter {
  constructor(cli) { this.cli = cli; this.stopped = false; }
  async run(options, onEvent, signal) {
    if (this.cli === 'codex' && options.onToolCall) {
      const output = await options.onToolCall('asteria_delegate', { cli: 'codex', model: 'gpt-child', task: 'inspect child task' });
      onEvent({ type: 'item/agentMessage/delta', text: `Parent received ${output}` });
      return { status: 'completed', output: `Parent received ${output}`, sessionId: `${this.cli}-session` };
    }
    onEvent({ type: 'agent_message_chunk', text: 'Child completed' });
    return { status: signal.aborted ? 'cancelled' : 'completed', output: 'Child completed', sessionId: `${this.cli}-session` };
  }
  async stop() { this.stopped = true; }
  async dispose() {}
}

test('main model receives a real broker callback result and persists native session and conversation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-chat-manager-'));
  try {
    const manager = new ConversationManager({ root, adapterFactory: (cli) => new FakeAdapter(cli) });
    await manager.bootstrap();
    manager.catalogs.codex = [{ id: 'gpt-main', cli: 'codex', reasoningEfforts: ['low'] }, { id: 'gpt-child', cli: 'codex', reasoningEfforts: ['low'] }];
    manager.catalogs.dsh = [{ id: 'deepseek-v4-flash', provider: 'deepseek-official', cli: 'dsh', effortIds: ['low'] }];
    const id = await manager.createConversation({ cwd: process.cwd(), cli: 'codex', model: 'gpt-main', effort: 'low' });
    await manager.sendMessage(id, 'delegate then continue');
    while (manager.active) await manager.active.operation;
    const conversation = await manager.getConversation(id);
    assert.equal(conversation.status, 'completed');
    assert.equal(conversation.native.codex, 'codex-session');
    assert.match(conversation.messages.at(-1).text, /Child completed/);
    assert(conversation.events.some((event) => event.type === 'delegate_finished'));
    await manager.dispose();
  } finally { await removeDir(root); }
});

test('second send is rejected while the first turn owns the conversation scheduler', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-chat-lock-'));
  try {
    let release;
    class SlowAdapter extends FakeAdapter { run() { return new Promise((resolve) => { release = resolve; }); } }
    const manager = new ConversationManager({ root, adapterFactory: () => new SlowAdapter('codex') });
    await manager.bootstrap(); manager.catalogs.codex = [{ id: 'gpt', cli: 'codex' }];
    const id = await manager.createConversation({ cwd: process.cwd(), cli: 'codex', model: 'gpt' });
    await manager.sendMessage(id, 'one');
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(manager.sendMessage(id, 'two'), /正在生成/);
    const operation = manager.active.operation;
    release({ status: 'completed', output: 'done', sessionId: 'session' });
    await operation;
    await manager.dispose();
  } finally { await removeDir(root); }
});

test('terminal status is published only after adapter cleanup releases the scheduler', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-terminal-cleanup-'));
  let manager;
  let releaseDispose;
  try {
    let disposeStarted;
    const started = new Promise((resolve) => { disposeStarted = resolve; });
    const cleanup = new Promise((resolve) => { releaseDispose = resolve; });
    class SlowDisposeAdapter extends FakeAdapter {
      async run() { return { status: 'completed', output: 'done', sessionId: 'session' }; }
      async dispose() { disposeStarted(); await cleanup; }
    }
    manager = new ConversationManager({ root, adapterFactory: () => new SlowDisposeAdapter('codex') });
    await manager.bootstrap(); manager.catalogs.codex = [{ id: 'gpt', cli: 'codex' }];
    const cwd = process.cwd();
    const id = await manager.createConversation({ cwd, cli: 'codex', model: 'gpt' });
    const updates = []; let createdAfterTurnComplete;
    manager.subscribe((event) => {
      updates.push(event);
      if (event.kind === 'turn_complete') createdAfterTurnComplete = manager.createConversation({ cwd, cli: 'codex', model: 'gpt' });
    });
    await manager.sendMessage(id, 'finish');
    const operation = manager.active.operation;
    await started;
    assert.notEqual((await manager.getConversation(id)).status, 'completed');
    assert.equal(updates.some((event) => event.kind === 'conversation' && event.conversation?.status === 'completed'), false);
    await assert.rejects(manager.createConversation({ cwd, cli: 'codex', model: 'gpt' }), /正在生成/);
    releaseDispose();
    await operation;
    assert.equal((await manager.getConversation(id)).status, 'completed');
    const nextId = await createdAfterTurnComplete;
    assert.ok(nextId);
    await manager.dispose();
  } finally { releaseDispose?.(); await manager?.dispose().catch(() => {}); await removeDir(root); }
});

test('approval ids remain unique across independent main and child RPC peers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-approval-'));
  let manager;
  try {
    const adapters = [];
    class ApprovalAdapter extends FakeAdapter {
      async run(options, onEvent) {
        if (options.model === 'gpt-main') {
          await onEvent({ type: 'approval_request', text: 'main approval', raw: { id: 1, method: 'approval', params: {} } });
          await options.onToolCall('asteria_delegate', { cli: 'codex', model: 'gpt-child', task: 'child' });
          return { status: 'completed', output: 'done', sessionId: 'main-session' };
        }
        await onEvent({ type: 'approval_request', text: 'child approval', raw: { id: 1, method: 'approval', params: {} } });
        await new Promise((resolve) => { this.release = resolve; });
        return { status: 'completed', output: 'child done', sessionId: 'child-session' };
      }
      async resolveApproval(id, accepted) { this.approved = { id, accepted }; this.release?.(); return true; }
    }
    manager = new ConversationManager({ root, adapterFactory: (cli) => { const adapter = new ApprovalAdapter(cli); adapters.push(adapter); return adapter; } });
    await manager.bootstrap(); manager.catalogs.codex = [{ id: 'gpt-main', cli: 'codex' }, { id: 'gpt-child', cli: 'codex' }];
    const updates = []; manager.subscribe((event) => updates.push(event));
    const id = await manager.createConversation({ cwd: process.cwd(), cli: 'codex', model: 'gpt-main' });
    await manager.sendMessage(id, 'approval flow');
    for (let attempt = 0; attempt < 2000 && (manager.pendingApprovals.size < 2 || updates.filter((event) => event.kind === 'approval').length < 2) && manager.active; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    const debug = await manager.getConversation(id);
    assert.equal(manager.pendingApprovals.size, 2, `both RPC peers should register an approval request; active=${manager.active?.conversation.status || 'finished'} error=${manager.active?.conversation.error || ''} events=${debug?.events?.map((event) => event.type).join(',')} adapters=${adapters.length}`);
    const requests = updates.filter((event) => event.kind === 'approval');
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].requestId, requests[1].requestId);
    await manager.resolveApproval(id, requests[0].requestId, false);
    await manager.resolveApproval(id, requests[1].requestId, true);
    const operation = manager.active.operation; await operation;
    assert(adapters.some((adapter) => adapter.approved?.id === 1 && adapter.approved.accepted === true));
    await manager.dispose();
  } finally { await manager?.dispose().catch(() => {}); await removeDir(root); }
});

test('archive is reversible and the flag survives a reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-chat-archive-'));
  try {
    const manager = new ConversationManager({ root, adapterFactory: (cli) => new FakeAdapter(cli) });
    await manager.bootstrap();
    manager.catalogs.codex = [{ id: 'gpt-main', cli: 'codex', reasoningEfforts: ['low'] }];
    const id = await manager.createConversation({ cwd: process.cwd(), cli: 'codex', model: 'gpt-main', effort: 'low' });

    await manager.archive(id);
    assert.equal((await manager.getConversation(id)).archived, true);

    await manager.archive(id, false);
    assert.equal((await manager.getConversation(id)).archived, false);

    await manager.archive(id);
    await manager.dispose();

    const reloaded = new ConversationManager({ root, adapterFactory: (cli) => new FakeAdapter(cli) });
    await reloaded.bootstrap();
    const list = await reloaded.listConversations();
    assert.equal(list.length, 1);
    assert.equal(list[0].archived, true);
    await reloaded.dispose();
  } finally { await removeDir(root); }
});

test('token deltas reach the window one at a time and never land in the event log', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-chat-stream-'));
  try {
    class StreamingAdapter extends FakeAdapter {
      async run(_options, onEvent) {
        onEvent({ type: 'agent_thought_chunk', text: '先看调用链' });
        onEvent({ type: 'agent_message_chunk', text: '第一段。' });
        onEvent({ type: 'agent_message_chunk', text: '第二段。' });
        return { status: 'completed', output: '第一段。第二段。', sessionId: 'stream-session' };
      }
    }
    const pushes = [];
    const manager = new ConversationManager({ root, adapterFactory: () => new StreamingAdapter('codex') });
    manager.subscribe((event) => {
      if (event.kind === 'message' && event.message.role === 'assistant') pushes.push({ text: event.message.text, reasoning: event.message.reasoning || '' });
    });
    await manager.bootstrap();
    manager.catalogs.codex = [{ id: 'gpt' }];
    const id = await manager.createConversation({ cwd: process.cwd(), cli: 'codex', model: 'gpt' });
    await manager.sendMessage(id, 'stream it');
    while (manager.active) await manager.active.operation;

    // Each delta is painted on its own instead of arriving with the finished reply.
    assert.deepEqual(pushes.slice(0, 3), [
      { text: '', reasoning: '先看调用链' },
      { text: '第一段。', reasoning: '先看调用链' },
      { text: '第一段。第二段。', reasoning: '先看调用链' },
    ]);

    const conversation = await manager.getConversation(id);
    assert.equal(conversation.messages.at(-1).reasoning, '先看调用链');
    assert.equal(conversation.messages.at(-1).text, '第一段。第二段。');
    // One appendEvent per token is exactly what made the reply appear in one lump; keep them out.
    assert.equal(conversation.events.filter((event) => event.type === 'agent_message_chunk' || event.type === 'agent_thought_chunk').length, 0);
    await manager.dispose();
  } finally { await removeDir(root); }
});
