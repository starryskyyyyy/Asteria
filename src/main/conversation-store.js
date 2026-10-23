import { mkdir, access, appendFile, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const MAX_EVENT_BYTES = 64 * 1024 * 1024;

/**
 * New conversations always get a `randomUUID()`, but the rule stays permissive enough to address
 * legacy files and hand-written fixtures. What matters is that an id can never escape the state
 * directory: no separators, no dots, no drive letters, bounded length.
 */
export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function validConversationId(value) {
  if (typeof value !== 'string' || !CONVERSATION_ID_PATTERN.test(value)) throw new Error('会话编号无效。');
  return value;
}

/**
 * JSON-backed schema 2 conversation history.
 *
 * `conversations.json` holds conversation *metadata and messages* only. Event streams live in
 * `conversation-events/<id>.jsonl` and are never duplicated into the index, because streaming
 * deltas can produce thousands of events per turn. Legacy V1 run files are only exposed as an archive.
 */
export class ConversationStore {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, 'conversations.json');
    this.eventsDir = path.join(root, 'conversation-events');
    this.archiveDir = path.join(root, 'legacy-archive');
    this.state = { schemaVersion: 2, conversations: {}, legacyArchive: [] };
    this.writeChain = Promise.resolve();
    this.initPromise = null;
  }

  async initialize() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.#initialize();
    try { return await this.initPromise; }
    catch (error) { this.initPromise = null; throw error; }
  }

  async #initialize() {
    await mkdir(this.root, { recursive: true });
    await mkdir(this.eventsDir, { recursive: true });
    const backup = `${this.file}.bak`;
    const mainExists = await exists(this.file);
    const backupExists = await exists(backup);
    const main = mainExists ? await this.#readState(this.file) : null;
    if (main) this.state = main;
    else {
      const recovered = backupExists ? await this.#readState(backup) : null;
      if (recovered) {
        this.state = recovered;
        if (mainExists) await rename(this.file, this.#corruptPath());
      } else if (mainExists || backupExists) {
        throw new Error('Asteria 对话库及备份均无法读取；已保留原文件，请先备份后再修复。');
      } else await this.#migrateLegacy();
    }
    await this.#flush();
  }

  async #readState(file) {
    try {
      const loaded = JSON.parse(await readFile(file, 'utf8'));
      if (!loaded || loaded.schemaVersion !== 2 || !loaded.conversations || typeof loaded.conversations !== 'object' || Array.isArray(loaded.conversations)) return null;
      const conversations = {};
      for (const [id, value] of Object.entries(loaded.conversations)) {
        if (!value || typeof value !== 'object') continue;
        const { events, ...rest } = value;
        conversations[id] = rest;
      }
      return { schemaVersion: 2, conversations, legacyArchive: Array.isArray(loaded.legacyArchive) ? loaded.legacyArchive : [] };
    } catch { return null; }
  }

  #corruptPath() { return `${this.file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`; }

  async listConversations() {
    await this.initialize();
    return Object.values(this.state.conversations).map(copy).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  async get(id) {
    await this.initialize();
    const item = this.state.conversations[validConversationId(id)];
    if (!item) return null;
    return { ...copy(item), events: await this.readEvents(id) };
  }

  async readEvents(id) {
    const safe = validConversationId(id);
    let raw;
    try { raw = await readFile(path.join(this.eventsDir, `${safe}.jsonl`), 'utf8'); }
    catch { return []; }
    const events = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      try { events.push(JSON.parse(line)); } catch {}
    }
    return events;
  }

  async save(conversation) {
    await this.initialize();
    const id = validConversationId(conversation.id);
    // Events are persisted in their own append-only stream; keeping them here duplicated the whole turn.
    const { events, ...content } = conversation;
    this.state.conversations[id] = { ...copy(content), id, schemaVersion: 2 };
    await this.#flush();
  }

  async appendEvent(id, event) {
    await this.initialize();
    const safe = validConversationId(id);
    const target = path.join(this.eventsDir, `${safe}.jsonl`);
    await mkdir(this.eventsDir, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
    if (line.length > 4 * 1024 * 1024) return;
    await appendFile(target, line, 'utf8');
  }

  async trimEvents(id, maxBytes = MAX_EVENT_BYTES) {
    const safe = validConversationId(id);
    const target = path.join(this.eventsDir, `${safe}.jsonl`);
    let stats;
    try { stats = await stat(target); } catch { return false; }
    if (stats.size <= maxBytes) return false;
    const raw = await readFile(target, 'utf8');
    const kept = raw.slice(raw.length - Math.floor(maxBytes * 0.75));
    const fromBreak = kept.indexOf('\n');
    await writeFile(target, fromBreak >= 0 ? kept.slice(fromBreak + 1) : '', 'utf8');
    return true;
  }

  async listLegacyArchive() { await this.initialize(); return copy(this.state.legacyArchive); }

  async #migrateLegacy() {
    const legacyRuns = path.join(this.root, 'runs');
    const records = [];
    try {
      for (const name of await readdir(legacyRuns)) {
        if (!name.endsWith('.json') || name.endsWith('.bak.json')) continue;
        try {
          const run = JSON.parse(await readFile(path.join(legacyRuns, name), 'utf8'));
          if (!run || typeof run.id !== 'string') continue;
          records.push({ id: run.id, title: String(run.prompt || 'V1 历史任务').slice(0, 160), cwd: run.cwd || '', status: terminal.has(run.status) ? run.status : 'interrupted', createdAt: run.createdAt || new Date(0).toISOString(), finishedAt: run.finishedAt || null, summary: run.error || run.review?.feedback || '', legacy: true });
        } catch {}
      }
    } catch {}
    if (records.length) {
      await mkdir(this.archiveDir, { recursive: true });
      this.state.legacyArchive = records;
      await writeFile(path.join(this.archiveDir, 'runs.json'), JSON.stringify(records, null, 2), 'utf8');
    }
  }

  async #flush() {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    const operation = this.writeChain.catch(() => {}).then(async () => {
      const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp, payload, 'utf8');
      // On Windows an antivirus scanner or another process can hold the target open for a few
      // milliseconds, so replacing it needs a bounded retry rather than a one-shot attempt.
      let lastError;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await rename(temp, this.file);
          return;
        } catch (error) {
          lastError = error;
          if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) break;
          if (attempt === 0) {
            const backup = `${this.file}.bak`;
            await rm(backup, { force: true });
            if (await exists(this.file)) await rename(this.file, backup).catch(() => {});
          }
          await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
        }
      }
      await rm(temp, { force: true }).catch(() => {});
      const backup = `${this.file}.bak`;
      if (!(await exists(this.file)) && (await exists(backup))) await rename(backup, this.file).catch(() => {});
      throw lastError;
    });
    this.writeChain = operation;
    return operation;
  }
}

async function exists(file) { try { await access(file); return true; } catch { return false; } }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
