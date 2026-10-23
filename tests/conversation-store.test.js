import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationStore } from '../src/main/conversation-store.js';

test('schema 2 stores conversations atomically and retains messages and events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-conversations-'));
  try {
    const store = new ConversationStore(root);
    await store.initialize();
    const conversation = { id: 'chat_1', cwd: 'C:\\work', route: { cli: 'codex', model: 'gpt-6-luna', effort: 'low' }, messages: [{ id: 'm1', role: 'user', text: '你好' }], events: [] };
    await store.save(conversation);
    await store.appendEvent(conversation.id, { id: 'e1', type: 'tool', text: 'delegated' });
    const loaded = await store.get(conversation.id);
    assert.equal(loaded.messages[0].text, '你好');
    assert.equal(loaded.events[0].id, 'e1');
    assert.equal(JSON.parse(await readFile(path.join(root, 'conversations.json'), 'utf8')).schemaVersion, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy V1 runs migrate to a read-only archive without replaying active work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-v1-migration-'));
  try {
    const runs = path.join(root, 'runs'); await mkdir(runs, { recursive: true });
    await writeFile(path.join(runs, 'old.json'), JSON.stringify({ id: 'old', status: 'running', prompt: 'legacy', createdAt: '2026-01-01', cwd: 'C:\\work' }));
    const store = new ConversationStore(root);
    await store.initialize();
    assert.deepEqual((await store.listConversations()), []);
    const archive = await store.listLegacyArchive();
    assert.equal(archive.length, 1);
    assert.equal(archive[0].status, 'interrupted');
    assert.equal((await store.get('old')), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('store recovers a valid Windows replacement backup and preserves the damaged main file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-store-backup-'));
  try {
    const main = path.join(root, 'conversations.json');
    const backup = `${main}.bak`;
    await writeFile(main, '{damaged');
    await writeFile(backup, JSON.stringify({ schemaVersion: 2, conversations: { recovered: { id: 'recovered', title: 'Recovered' } }, legacyArchive: [] }));
    const store = new ConversationStore(root);
    await store.initialize();
    assert.equal((await store.get('recovered')).title, 'Recovered');
    assert.equal(JSON.parse(await readFile(main, 'utf8')).conversations.recovered.title, 'Recovered');
    const names = await import('node:fs/promises').then(({ readdir }) => readdir(root));
    assert(names.some((name) => name.startsWith('conversations.json.corrupt-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('store rejects corrupt main and backup without overwriting either source file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-store-corrupt-'));
  try {
    const main = path.join(root, 'conversations.json');
    const backup = `${main}.bak`;
    await writeFile(main, '{main damaged');
    await writeFile(backup, '{backup damaged');
    const store = new ConversationStore(root);
    await assert.rejects(store.initialize(), /对话库及备份均无法读取/);
    assert.equal(await readFile(backup, 'utf8'), '{backup damaged');
    assert.equal(await readFile(main, 'utf8'), '{main damaged');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('conversation ids that could escape the state directory are rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-store-ids-'));
  try {
    const store = new ConversationStore(root);
    await store.initialize();
    for (const id of ['../escape', 'a/b', 'a\\b', 'C:x', '..', '', '.', 'x'.repeat(65), 'name.json', 'null\u0000byte']) {
      await assert.rejects(() => store.get(id), /会话编号无效/, `expected ${JSON.stringify(id)} to be rejected`);
    }
    // Legacy names stay addressable, they just never resolve to a file outside the state root.
    assert.equal(await store.get('legacy_run-01'), null);
    assert.deepEqual(await store.readEvents('legacy_run-01'), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('events live in their own stream, never duplicated into the index, and trim by size', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asteria-store-events-'));
  try {
    const store = new ConversationStore(root);
    await store.initialize();
    await store.save({ id: 'conv-events-1', title: 'stream', messages: [], events: [{ type: 'should-not-persist' }] });
    await store.appendEvent('conv-events-1', { type: 'alpha' });
    await store.appendEvent('conv-events-1', { type: 'beta', text: 'y'.repeat(400) });

    const loaded = await store.get('conv-events-1');
    assert.deepEqual(loaded.events.map((event) => event.type), ['alpha', 'beta']);

    const index = JSON.parse(await readFile(path.join(root, 'conversations.json'), 'utf8'));
    assert.equal(index.conversations['conv-events-1'].events, undefined);
    assert.equal(index.conversations['conv-events-1'].title, 'stream');

    assert.equal(await store.trimEvents('conv-events-1'), false);
    assert.equal(await store.trimEvents('conv-events-1', 32), true);
    assert.ok((await store.readEvents('conv-events-1')).length <= 2);

    const leftovers = (await readdir(root)).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
