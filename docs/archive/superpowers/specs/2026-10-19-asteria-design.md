# Asteria V1 design

## Intent and authority
The user requests a Windows application based on `Desktop/新建 文本文档.txt`, with a working first release that really connects to local CLIs and starts tasks. The parent agent owns planning and acceptance; exactly one GPT-6 Luna / high implementer is requested. The user explicitly delegates planning and acceptance, so routine design and plan choices proceed autonomously. Deliver to `D:\12345\Asteria`; product and executable name: Asteria. Build in the chat's `work/Asteria` staging directory, then the parent copies the verified release to the requested location.

## Approach selection
Electron + React is selected because the application must manage local CLI child processes and display structured events in a real Windows window. A browser-only localhost server would need a second service and a launcher; a Python native GUI would reduce dependencies but complicate a rich event inspector. Use TypeScript for the renderer and sensible JS/TS modules for the Node backend. Ship a portable Windows folder with `Asteria.exe` and Chinese quick-start instructions. No web publishing is involved.

## V1 scope
1. Detect Codex and DSH from PATH and common installed shims; allow explicit executable paths. Show version, connection state, error text, and declared capabilities separately. Process discovery alone is not a successful model request.
2. Select an existing project folder with a native folder picker; enter a task; choose CLI/model and Codex reasoning effort. Codex model options come from `model/list`; allow a custom model identifier. DSH V1 may use the user's configured default and must label this limitation accurately if per-task model selection is unavailable.
3. Start real CLI tasks; stream messages, command/tool events, stderr diagnostics and raw event JSON; show clear running, completed, failed, cancelled, and awaiting-approval states. Every event associates a run, stage, provider and timestamp.
4. Support a direct single-agent run, plus a sequential Plan -> Execute -> Review workflow. Planner and reviewer use Codex; executor can be Codex or DSH. Only executor may modify files; planner/reviewer are instructed to inspect and report. Forward explicit goal, acceptance criteria and preceding stage results. Reviewer output is a strict small JSON decision with `approved` and `feedback`; malformed decisions fail clearly. Support a bounded maximum of 1-3 execution attempts (default 1); never infinite retries. If implementing team workflow threatens core connectivity, finish the core path first and report the remaining gap rather than exposing a fake control.
5. Stop the active run. Codex uses `turn/interrupt` and terminates owned processes on timeout/close; DSH kills its owned process tree. Stopped tasks never become completed or continue into another stage. App close cleans up owned children without terminating unrelated CLI sessions.
6. Save run metadata, messages, results and event logs. V1 uses atomic JSON metadata plus append-only JSONL event files instead of a native SQLite dependency; the store boundary permits a future SQLite implementation. Reloading historical runs only views records. Interrupted runs are reconciled to interrupted/failed on startup and never automatically replayed.
7. Show a simple project Git diff/status when available, otherwise show an accurate non-Git explanation. Do not initialize or reset the user's projects automatically.

## CLI contracts and local findings
- Node is `v24.17.0`, npm `11.13.0`.
- Codex shim: `C:\Users\starryskyyy\AppData\Roaming\npm\codex.cmd`, package entry `...\npm\node_modules\@openai\codex\bin\codex.js`; prefer resolving JS/native executable over shell interpolation.
- Codex version: `codex-cli 0.162.1`. `codex app-server --stdio` is supported. Protocol is newline-delimited JSON RPC: initialize -> initialized -> model/list -> thread/start -> turn/start; handle item deltas and turn/completed status. Use existing login/config; never read or expose secrets. Generate local protocol schema if exact fields are uncertain.
- DSH shim: `C:\Users\starryskyyy\AppData\Local\deepseek-harness\bin\dsh.ps1` (also inspect a `.cmd` sibling). Its underlying runtime and package are `C:\Users\starryskyyy\AppData\Roaming\dsh-tauri\runtime\node.exe` and `...\dependencies\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js`.
- DSH version: `0.2.0-rc.2`. `dsh headless --json -` reads the task from stdin and emits newline-delimited run events; `--session-id` resumes an existing session. `dsh headless --help` confirmed the exact flags. Local headless source is `...\node_modules\@deepseek-ai\dsh-headless\lib\index.js`.
- DSH profile generation writes under the user's existing `.dsh` directory. CLI probes may need sandbox escalation; this is a tool sandbox issue, not product functionality. Do not change existing credentials or global model settings.
- Official references read by parent: https://developers.openai.com/codex/app-server and https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/sdk/client/README.md . Prefer the installed version's schema/source over guesses from other releases.

## Execution boundaries
Use argument arrays and piped stdin, never interpolate the user prompt or workspace into a shell command. `.ps1` launch arguments must remain separate arguments, or resolve shims to real JS/native paths. Windows child processes use `windowsHide: true`. Preserve the user's login and configuration. Never auto-approve arbitrary CLI approval requests: display them and support allow-once/decline for known Codex request types; unsupported requests fail explicitly rather than hanging. Use standard workspace write permissions for normal executor tasks and read-only where supported for inspection stages; no blanket dangerous bypass flags.

Electron uses context isolation, no node integration in renderer, and a narrow validated preload IPC bridge. Local packaged content only; deny arbitrary navigation/window opening. Do not put API keys in UI, logs, fixtures, reports, or deliverable source. Render output as text unless a safe renderer is used.

## Interface and UI
Dark navy desktop workbench with restrained teal/lilac accents and good Chinese typography. Left rail: Asteria, New task, run history and connection status. Main area: task form and active stage timeline; live output and raw event tabs; right-side team/provider details or a compact alternative. Model, project, task and start/stop controls remain visible and discoverable. Empty state explains the next action. Buttons have real handlers and accurately enabled states. No simulated success, decorative unsupported controls or hidden demo data.

## Acceptance
A. Clean install/build and portable folder creation; app opens without renderer errors.
B. Real Codex initialization, dynamic model listing and successful task creating `codex-proof.txt` with exact content in an isolated Chinese-and-space directory; inspect actual file content and final turn status.
C. Real DSH headless task creating `dsh-proof.txt` and streaming events, using existing configured credentials; inspect file and terminal status. A missing credential or external service failure is reported specifically, never misrepresented as an application success.
D. Start through the application backend/UI, observe correlated events and terminal state. Run the Plan -> Execute -> Review path with a tiny file task where services permit.
E. Validate missing executable, invalid folder, CLI exit/error, stop during startup/active turn, chunked JSON events and restart history without replay. Use targeted automated tests for protocol/lifecycle/store/orchestration.
F. Install the verified folder under `D:\12345\Asteria`, launch that copy, and write an acceptance report listing commands, versions, results and actual limitations.

## Deferred
Claude integration, free-form inter-agent tools, parallel executors/worktree merging, automatic session resume, an installer/updater, and large-scale log virtualization. These are future work and must not appear as functional V1 controls.
