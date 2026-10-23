import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { AGENTS, CODEX_ENTRY, DSH_ENTRY, DSH_NODE, getAgent } from './agents.js';

const execFile = promisify(execFileCallback);

export { CODEX_ENTRY, DSH_ENTRY, DSH_NODE };

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
}
function appData() {
  return process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
}

const PROGRAM_FILES = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);

/**
 * Locate a usable Node.js runtime. Order matters: an explicit override, then PATH (what a developer
 * expects), then the DSH-bundled runtime, then stock install locations so a packaged app still works
 * when Asteria was launched from the Start menu and PATH is minimal.
 */
export async function findNode() {
  const fromPath = String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, 'node.exe'));
  const candidates = [process.env.DSH_NODE, process.env.npm_node_execpath, ...fromPath, DSH_NODE, ...PROGRAM_FILES.map((root) => path.join(root, 'nodejs', 'node.exe')), path.join(localAppData(), 'Programs', 'nodejs', 'node.exe')];
  for (const candidate of candidates.filter(Boolean)) if (await exists(candidate)) return candidate;
  return null;
}

function agentEnv(agent) {
  return { ...process.env, ...(agent?.streamJson?.env || {}), ...(agent?.acp?.env || {}) };
}

/**
 * Resolve one agent's CLI to something spawnable.
 *
 * Returns `{ provider, executablePath, entryPath, nodePath, diagnostic? }`; `entryPath` is the
 * JavaScript entry we run through `nodePath`, or the executable itself for native binaries.
 */
export async function resolveCli(id, explicitPath = '') {
  const agent = getAgent(id);
  if (!agent) throw new Error(`未知的 CLI：${String(id)}`);
  const nodePath = await findNode();
  const known = explicitPath ? [explicitPath] : [...await knownEntries(agent), ...await pathShimCandidates(agent)];
  for (const candidate of known) {
    if (/\.(cmd|bat|ps1)$/i.test(candidate) && await exists(candidate)) {
      const resolved = await resolveShim(agent, candidate, nodePath);
      if (resolved) return resolved;
      continue;
    }
    const launchable = await launchableEntry(agent, candidate, nodePath, candidate);
    if (launchable) return launchable;
  }
  const fallback = explicitPath || (await fallbackShim(agent));
  return { provider: agent.id, cliId: agent.id, executablePath: fallback, entryPath: null, nodePath, diagnostic: `未找到 ${agent.name}。可在设置中指定可执行入口，或先安装：${agent.install}` };
}

/**
 * Decide how to launch one file: a native `.exe` runs directly, a `.js`/`.mjs`/`.cjs` file (or an
 * extensionless launcher such as WorkBuddy's `cli/bin/codebuddy`) runs through the Node runtime.
 */
async function launchableEntry(agent, file, nodePath, executablePath) {
  if (!file || !await exists(file)) return null;
  const lower = file.toLowerCase();
  if (lower.endsWith('.exe')) return { provider: agent.id, cliId: agent.id, executablePath: executablePath || file, entryPath: file, nodePath: null };
  const isScript = lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs');
  const isExtensionless = !path.extname(file);
  if ((isScript || isExtensionless) && nodePath) return { provider: agent.id, cliId: agent.id, executablePath: executablePath || file, entryPath: file, nodePath };
  return null;
}

async function knownEntries(agent) {
  try {
    const found = await agent.entries();
    return (Array.isArray(found) ? found : [found]).filter(Boolean);
  } catch {
    return [];
  }
}

async function fallbackShim(agent) {
  const name = agent.executables?.[0] || agent.id;
  const shim = path.join(appData(), 'npm', process.platform === 'win32' ? `${name}.cmd` : name);
  if (await exists(shim)) return shim;
  return path.join(localAppData(), 'deepseek-harness', 'bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

export async function probeCli(id, explicitPath = '', execFileImpl = execFile) {
  const found = await resolveCli(id, explicitPath);
  if (!found.entryPath) return { ...found, version: null, connected: false };
  if (!found.nodePath && !found.entryPath.toLowerCase().endsWith('.exe')) {
    return { ...found, version: null, connected: false, diagnostic: '未找到可用的 Node.js 运行时，无法启动该 CLI。' };
  }
  try {
    const command = found.nodePath || found.entryPath;
    const args = found.nodePath ? [found.entryPath, '--version'] : ['--version'];
    const { stdout } = await execFileImpl(command, args, { timeout: 20_000, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024, env: agentEnv(getAgent(id)) });
    const version = String(stdout || '').trim().split(/\r?\n/)[0].slice(0, 120);
    return { ...found, version, connected: Boolean(version), diagnostic: '' };
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim().slice(0, 500);
    return { ...found, version: null, connected: false, diagnostic: `CLI 版本检查失败：${detail}` };
  }
}

/** Probe every registered agent in parallel. Unknown ids in `paths` are ignored. */
export async function detectClis(paths = {}) {
  // One broken registry entry must never sink the whole list: each probe fails on its own.
  const entries = await Promise.all(AGENTS.map(async (agent) => {
    try {
      return [agent.id, await probeCli(agent.id, typeof paths[agent.id] === 'string' ? paths[agent.id] : '')];
    } catch (error) {
      return [agent.id, { provider: agent.id, cliId: agent.id, entryPath: null, nodePath: null, version: null, connected: false, diagnostic: `无法检测 ${agent.name}：${String(error?.message || error)}` }];
    }
  }));
  return Object.fromEntries(entries);
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function pathShimCandidates(agent) {
  const names = process.platform === 'win32'
    ? (agent.executables || []).flatMap((base) => [`${base}.exe`, `${base}.cmd`, `${base}.ps1`, `${base}.bat`])
    : [...(agent.executables || [])];
  const found = [];
  for (const directory of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (await exists(candidate)) found.push(candidate);
    }
  }
  return found;
}

/**
 * npm/pnpm launcher shims are tiny scripts that mention the real payload. Reading that reference is
 * far more reliable than guessing `node_modules` layout, and it is vendor-agnostic. The payload may
 * be a Node script (`codex.js`) or a native binary (`claude.exe`), so both are accepted.
 */
async function resolveShim(agent, shim, nodePath) {
  let source;
  try { source = await readFile(shim, 'utf8'); } catch { return null; }
  const shimDir = path.dirname(shim);

  const windowsStyle = source.match(/[%~]dp0%?[\\/]+([^";\r\n]+?\.(?:js|cjs|mjs|exe)\b)/i);
  const relativeStyle = source.match(/(?:^|[\s"'])((?:\.\.?[\\/]|node_modules[\\/])[^";\r\n]*?\.(?:js|cjs|mjs|exe)\b)/i);
  const candidates = [windowsStyle?.[1], relativeStyle?.[1]].filter(Boolean).map((entry) => path.resolve(shimDir, entry));
  for (const entry of candidates) {
    const launchable = await launchableEntry(agent, entry, nodePath, shim);
    if (launchable) return launchable;
  }

  // DSH ships a hand-written shim that exports its paths as environment variables.
  if (agent.id === 'dsh') {
    const entry = source.match(/(?:DSH_BIN=|\$dshBin\s*=\s*')["']?([^"'\r\n]+)["']?/i)?.[1]?.trim();
    const bundledNode = source.match(/(?:NODE_BIN=|\$nodeBin\s*=\s*')["']?([^"'\r\n]+)["']?/i)?.[1]?.trim();
    const executable = entry || DSH_ENTRY;
    const runtime = bundledNode && await exists(bundledNode) ? bundledNode : nodePath;
    if (runtime && await exists(executable)) return { provider: agent.id, cliId: agent.id, executablePath: shim, entryPath: executable, nodePath: runtime };
  }
  return null;
}
