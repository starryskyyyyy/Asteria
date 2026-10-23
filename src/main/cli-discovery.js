import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const execFile = promisify(execFileCallback);

/** Never let an unset APPDATA turn into a *relative* candidate path. */
function appData() {
  return process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
}
function localAppData() {
  return process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
}

export const CODEX_ENTRY = path.join(appData(), 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
export const DSH_ENTRY = path.join(appData(), 'dsh-tauri', 'dependencies', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
export const DSH_NODE = path.join(appData(), 'dsh-tauri', 'runtime', 'node.exe');

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

export async function resolveCli(provider, explicitPath = '') {
  const nodePath = await findNode();
  const defaultEntry = provider === 'codex' ? CODEX_ENTRY : DSH_ENTRY;
  const candidates = explicitPath ? [explicitPath] : [defaultEntry, ...await pathShimCandidates(provider)];
  for (const candidate of candidates) {
    if (/\.(cmd|bat|ps1)$/i.test(candidate) && await exists(candidate)) {
      const resolved = await resolveShim(provider, candidate, nodePath);
      if (resolved) return resolved;
      continue;
    }
    if (candidate.toLowerCase().endsWith('.js') && nodePath && await exists(candidate)) return { provider, executablePath: candidate, entryPath: candidate, nodePath };
    if (candidate.toLowerCase().endsWith('.exe') && await exists(candidate)) return { provider, executablePath: candidate, entryPath: candidate, nodePath: null };
  }
  const shim = provider === 'codex' ? path.join(appData(), 'npm', 'codex.cmd') : path.join(localAppData(), 'deepseek-harness', 'bin', 'dsh.cmd');
  return { provider, executablePath: explicitPath || shim, entryPath: null, nodePath, diagnostic: `${provider === 'codex' ? 'Codex' : 'DSH'} CLI 未找到。可在设置中指定 CLI JavaScript 入口。` };
}

export async function probeCli(provider, explicitPath = '', execFileImpl = execFile) {
  const found = await resolveCli(provider, explicitPath);
  if (!found.entryPath) return { ...found, version: null, connected: false };
  if (!found.nodePath && !found.entryPath.toLowerCase().endsWith('.exe')) {
    return { ...found, version: null, connected: false, diagnostic: '未找到可用的 Node.js 运行时，无法启动该 CLI。' };
  }
  try {
    const command = found.nodePath || found.entryPath;
    const args = found.nodePath ? [found.entryPath, '--version'] : ['--version'];
    const { stdout } = await execFileImpl(command, args, { timeout: 10_000, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 });
    const version = String(stdout || '').trim().split(/\r?\n/)[0].slice(0, 120);
    return { ...found, version, connected: Boolean(version), diagnostic: '' };
  } catch (error) {
    return { ...found, version: null, connected: false, diagnostic: `CLI 版本检查失败：${String(error.stderr || error.message).slice(0, 500)}` };
  }
}

export async function detectClis(paths = {}) {
  return Object.fromEntries(await Promise.all(['codex', 'dsh'].map(async (provider) => [provider, await probeCli(provider, paths[provider] || '')])));
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function pathShimCandidates(provider) {
  const base = provider === 'codex' ? 'codex' : 'dsh';
  const names = process.platform === 'win32' ? [`${base}.exe`, `${base}.cmd`, `${base}.ps1`, `${base}.bat`] : [base];
  const found = [];
  for (const directory of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (await exists(candidate)) found.push(candidate);
    }
  }
  return found;
}

async function resolveShim(provider, shim, nodePath) {
  let source;
  try { source = await readFile(shim, 'utf8'); } catch { return null; }
  if (provider === 'dsh') {
    const entry = source.match(/(?:DSH_BIN=|\$dshBin\s*=\s*')["']?([^"'\r\n]+)["']?/i)?.[1]?.trim();
    const bundledNode = source.match(/(?:NODE_BIN=|\$nodeBin\s*=\s*')["']?([^"'\r\n]+)["']?/i)?.[1]?.trim();
    const executable = entry || DSH_ENTRY;
    const runtime = bundledNode && await exists(bundledNode) ? bundledNode : nodePath;
    if (runtime && await exists(executable)) return { provider, executablePath: shim, entryPath: executable, nodePath: runtime };
  } else {
    const entry = path.join(path.dirname(shim), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (nodePath && await exists(entry)) return { provider, executablePath: shim, entryPath: entry, nodePath };
  }
  return null;
}
