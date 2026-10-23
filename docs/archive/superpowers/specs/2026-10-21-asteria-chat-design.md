# Asteria 2.0 — Chat and cross-CLI subagents

The user delegates design and acceptance to the parent and implementation to the existing GPT-6 Luna high agent. This specification replaces the V1 fixed Codex Plan → Execute → Review workflow. No additional approval gate is required.

## Product

A local Windows Electron chat client. A left sidebar lists persistent conversations, the center displays user and assistant messages, and a bottom composer accepts prompts. The selected main CLI/model carries out each prompt directly. It can call Asteria tools to delegate a bounded task to a model belonging to another CLI, receive the real result, and continue. There is no mandatory planner or reviewer role.

The model picker first selects a CLI (Codex or DSH), then a model loaded by that CLI. DSH models retain their provider route. Show the real CLI catalog and supported effort settings; do not invent available models. Unavailable CLIs have an actionable connection error. Keep path settings and refresh. No fake Claude support.

Conversations retain their workspace, selected route, native session identifiers, messages, completed turns, delegation events and errors. Repeated prompts use the same native session. On switching CLI within a conversation, bridge missing textual conversation context explicitly without replaying prior tool actions. Reload/restart must show history and resume native context. Legacy V1 runs remain accessible as an archive and must not execute on migration.

## Protocols

Codex uses app-server JSON-RPC: initialize experimentalApi, model/list, thread/start/resume and turn/start. Register `asteria_list_models` and `asteria_delegate` as real dynamic function tools (definitions require type `function`). Handle server `item/tool/call`; return DynamicToolCallResponse with contentItems inputText and success. A real Codex→DSH native tool round trip has already passed in work/probe-v2-codex-delegate.cjs; evidence is work/acceptance-v2/protocol-codex-to-dsh/evidence.json.

DSH main uses ACP (`node --use-system-ca <dsh lib/bin.js> --profile acp`). Use installed ACP schema and work/asteria-v2-dsh-protocol-research.md for exact methods. session/new configOptions contains the live provider-grouped model catalog. Use session/set_config_option to select the exact opaque provider/model value and optional effort; never silently ignore the selected route. session/prompt response is turn completion; session/update streams chunks and tools. Resume native sessions on restart. Inject an Asteria-owned MCP broker per main session using ACP mcpServers. Prefer loopback HTTP MCP with unpredictable per-process token (or fixed bundled stdio helper) and no model-supplied command/url/env. Implement initialize, tools/list and tools/call with actual JSON-RPC semantics. Do not change global DSH patches, keys or settings. Normal CLI-generated ACP profile initialization is permitted as part of connection.

Both protocols call the same host broker. `asteria_list_models` returns current catalog. `asteria_delegate` accepts cli, optional provider/model/effort, task, optional readOnly. Host resolves omitted model to the target CLI default, validates any explicit route against the current catalog, fixes cwd to the conversation workspace and returns structured agentId/route/status/output/error. Keep the exact schema consistent across Codex and MCP. A child has its own adapter/session/process; parent and child may share CLI but never a mutable adapter instance. Child agents do not receive delegation tools in this release. Maximum six delegates per main turn, depth one, child timeout ten minutes. Serialize children to avoid concurrent writes in a shared workspace. Main is awaiting a tool result while a child runs.

Stop cancels main, running child and queued children, fails pending tool responses, and prevents continuation after cancellation. Close owned RPC peers/processes and MCP server on app exit. Display native approval prompts through existing once-only approve/decline UI; never auto-approve unknown requests. Keep Node system CA support, safe argv spawning, UTF-8 stream parsing, request timeouts, explicit exit errors and file atomicity from V1.

## UI

Main experience is chat, not task forms or a raw event console. Top bar shows workspace, CLI/model, connection and settings. Sidebar supports new/select/search conversations; title from first prompt, rename if practical. Composer supports Enter send, Shift+Enter newline and IME composition (Chinese); stop replaces send during execution. Preserve drafts when switching conversations. Markdown must not execute arbitrary HTML; fenced code should be readable/copyable. Tools and subagents are compact expandable cards within the relevant turn, with CLI/model, task, live state, output and raw details. Show useful error messages in conversation and allow next turn after failure. No unsupported attachment affordances.

After functional work passes, polish using transferable ideas from the MIT DSH Catppuccin theme (https://github.com/NoNameLeGo/dsh-catppuccin-theme). Adapt theme tokens, Latte/Mocha palettes and restrained glass treatment to Asteria components; do not install a plugin globally or import DSH-specific DOM/runtime code. Persist chosen theme. Parent will provide inspected source/license if needed. Keep legible Chinese fonts, focus states, normal window sizes and responsive sidebar/composer. Include attribution for any copied MIT source and a short UI adaptation note.

## Persistence, packaging and acceptance

Use schema 2 persistent JSON data with serialized writes/unique atomic temp paths. Preserve V1 data. ASTERIA_DATA_DIR must isolate both store and Electron userData before requestSingleInstanceLock; independent tests must not interact with the user's open V1 instance. Keep Electron contextIsolation, sandbox, no renderer Node integration, narrow IPC and blocked external navigation.

Build version 2.0.0 in work/Asteria-chat, then parent deploys to D:/12345/Asteria after independent acceptance with a recoverable V1 backup. Do not alter deployed D files during implementation. Deliver source, executable and concise Chinese usage notes.

Required evidence: automated lifecycle/persistence/validation/cancellation tests; production renderer build; real Codex and DSH two-turn conversations; real Codex main→DSH child→parent continuation; real DSH main→Codex child→parent continuation; actual selected route; isolated packaged Electron UI, history and theme persistence. All child reports distinguish mock tests from actual CLI evidence. User-requested cross-CLI dispatch must be native tool invocation, never text-marker parsing or a host-forced pipeline.
