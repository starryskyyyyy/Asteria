import path from 'node:path';
import { homedir } from 'node:os';

/**
 * The single place that knows which agent CLIs Asteria supports.
 *
 * Adding a CLI means adding one entry here: the discovery layer, the adapter factory, the settings
 * panel and the route bar are all driven by this list, so no other file needs to learn its name.
 *
 * `channel` is the wire protocol, not the vendor:
 *   - `app-server`  Codex's JSON-RPC app-server (tools are pushed to us, approvals are ours to answer)
 *   - `acp`         Agent Client Protocol (Zed's protocol; DSH, Gemini CLI, Kiro, Qwen Code speak it)
 *   - `stream-json` Newline-delimited JSON over stdio, one process per turn (Claude Code, CodeBuddy)
 *
 * `verified` means the integration was exercised against the real CLI. Unverified entries are hidden
 * behind the developer toggle in settings and are never auto-selected for new conversations.
 */

function appData() {
  return process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
}
function localAppData() {
  return process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
}
function programDirs() {
  return [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
}
function driveRoots() {
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
}

export const CODEX_ENTRY = path.join(appData(), 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
export const DSH_ENTRY = path.join(appData(), 'dsh-tauri', 'dependencies', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
export const DSH_NODE = path.join(appData(), 'dsh-tauri', 'runtime', 'node.exe');
export const CLAUDE_ENTRY = path.join(appData(), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
const GEMINI_ENTRY = path.join(appData(), 'npm', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js');
const QWEN_ENTRY = path.join(appData(), 'npm', 'node_modules', '@qwen-code', 'qwen-code', 'dist', 'index.js');
const CODEBUDDY_TAIL = path.join('resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');

/** Desktop-bundle installs (CodeBuddy/WorkBuddy) live under an arbitrary drive + folder name. */
function desktopBundleCandidates() {
  const tails = [CODEBUDDY_TAIL];
  const names = ['WorkBuddyAI', 'workbuddyai', 'CodeBuddy', 'codebuddy'];
  const out = [];
  for (const root of [...programDirs(), localAppData(), ...driveRoots()]) {
    for (const name of names) out.push(path.join(root, name, ...tails));
  }
  out.push(path.join(localAppData(), 'Programs', 'WorkBuddyAI', CODEBUDDY_TAIL));
  return out;
}

export const AGENTS = [
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    channel: 'app-server',
    home: 'https://developers.openai.com/codex/cli/',
    install: 'npm install -g @openai/codex',
    verified: true,
    supports: { models: true, approvals: true, resume: true, delegates: true, effort: true },
    executables: ['codex'],
    entries: () => [CODEX_ENTRY],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    channel: 'stream-json',
    home: 'https://docs.anthropic.com/en/docs/claude-code/sdk',
    install: 'npm install -g @anthropic-ai/claude-code',
    verified: true,
    supports: { models: true, approvals: false, resume: true, delegates: false, effort: false },
    executables: ['claude'],
    entries: () => [CLAUDE_ENTRY, path.join(localAppData(), 'Programs', 'claude', 'claude.js')],
    streamJson: {
      label: 'Claude Code',
      permissionMode: 'acceptEdits',
      models: [
        { id: 'sonnet', name: 'Sonnet（最新）' },
        { id: 'opus', name: 'Opus（最新）' },
        { id: 'haiku', name: 'Haiku（最新）' },
      ],
    },
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy / WorkBuddy',
    vendor: '腾讯',
    channel: 'stream-json',
    home: 'https://copilot.tencent.com/',
    install: 'https://copilot.tencent.com/cli（或安装 WorkBuddy 桌面版，自带内核）',
    verified: true,
    supports: { models: true, approvals: false, resume: true, delegates: false, effort: false },
    executables: ['codebuddy', 'workbuddy'],
    entries: desktopBundleCandidates,
    streamJson: {
      label: 'CodeBuddy',
      // The desktop bundle ships only the lite-wb build; the wrapper needs to be told to load it.
      env: { CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1' },
      permissionMode: 'acceptEdits',
      models: [{ id: 'default-model', name: 'CLI 默认模型' }],
    },
  },
  {
    id: 'dsh',
    name: 'DSH',
    vendor: 'DeepSeek',
    channel: 'acp',
    home: 'https://github.com/xiincs/deepseek-harness',
    install: '安装 DSH 桌面版即可获得 ACP CLI',
    verified: true,
    supports: { models: true, approvals: true, resume: true, delegates: true, effort: true },
    executables: ['dsh'],
    entries: () => [DSH_ENTRY],
    acp: {
      label: 'DSH',
      acpArgs: ['--profile', 'acp'],
      nodeArgs: ['--use-system-ca'],
      env: { DSH_HOME: process.env.DSH_HOME || path.join(homedir(), '.dsh'), DSH_TELEMETRY_DISABLED: '1' },
      multiProvider: true,
    },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    channel: 'acp',
    home: 'https://github.com/google-gemini/gemini-cli',
    install: 'npm install -g @google/gemini-cli',
    verified: false,
    supports: { models: true, approvals: true, resume: true, delegates: true, effort: false },
    executables: ['gemini'],
    entries: () => [GEMINI_ENTRY],
    acp: { label: 'Gemini CLI', acpArgs: ['--acp'], nodeArgs: [] },
  },
  {
    id: 'kiro',
    name: 'Kiro CLI',
    vendor: 'AWS',
    channel: 'acp',
    home: 'https://kiro.dev/docs/cli/',
    install: 'https://kiro.dev/docs/cli/installation/',
    verified: false,
    supports: { models: true, approvals: true, resume: true, delegates: true, effort: false },
    executables: ['kiro-cli', 'kiro'],
    entries: () => [path.join(localAppData(), 'Programs', 'Kiro CLI', 'kiro-cli.exe')],
    acp: { label: 'Kiro CLI', acpArgs: ['acp'], nodeArgs: [] },
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    vendor: 'Alibaba',
    channel: 'acp',
    home: 'https://github.com/QwenLM/qwen-code',
    install: 'npm install -g @qwen-code/qwen-code',
    verified: false,
    supports: { models: true, approvals: true, resume: true, delegates: true, effort: false },
    executables: ['qwen'],
    entries: () => [QWEN_ENTRY],
    acp: { label: 'Qwen Code', acpArgs: ['--acp'], nodeArgs: [] },
  },
];

export function getAgent(id) {
  return AGENTS.find((agent) => agent.id === id) || null;
}

export function agentIds() {
  return AGENTS.map((agent) => agent.id);
}

/** Renderer-facing projection: no paths, no env, just what the UI needs to describe a CLI. */
export function publicAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    vendor: agent.vendor,
    channel: agent.channel,
    home: agent.home,
    install: agent.install,
    verified: Boolean(agent.verified),
    supports: { ...agent.supports },
  };
}
