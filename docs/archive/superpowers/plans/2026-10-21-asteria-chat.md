# Asteria 2.0 implementation plan

Spec: ../specs/2026-10-21-asteria-chat-design.md (binding). Isolated source copied from deployed D:/12345/Asteria/Source into work/Asteria-chat; preserve work/Asteria baseline. User requests one existing Luna high implementer; parent performs design, review and acceptance. Do not spawn additional agents.

## Global constraints

Implement a chat client with arbitrary main CLI/model and genuine cross-CLI subagent tools. Remove fixed workflow roles. Live catalogs only, exact DSH provider route, persistent native sessions, stop all descendants, no global credential/config changes, preserve V1 history, retain Electron boundaries and system CA. Operate only in this staging source until parent deploys. Meaningful tests are required for the nontrivial lifecycle and protocol behavior, not styling snapshots.

## Task 1: Conversation and protocol core

Read the spec and local DSH research first. Inspect existing discovery, JSON-RPC, providers, store and run manager. Add failure-focused lifecycle tests before replacing the fixed pipeline. Implement schema2 conversation store, message/turn/event history, native session identity and legacy archive. Update Codex adapter for live catalogs, resume and real dynamic tool requests; implement DSH ACP adapter with live configOptions, exact model+effort, updates and resume. Use per-agent instances. Provide the unified delegation broker and DSH MCP bridge, bounded validated routes, serial child scheduling, cancellation/timeout cleanup and clear event semantics. Backend APIs should expose bootstrap/settings/catalog/conversation list+create+select/send/cancel/archive without leaking arbitrary filesystem or process execution. Retain existing safe cwd and approval behavior. Fix ASTERIA_DATA_DIR Electron profile isolation before lock.

Validation: npm test for meaningful store, protocol and broker tests; backend smoke with a real main session per CLI. Report interface names and remaining gaps to parent as soon as the core is usable. Core must genuinely support both directions before UI polish.

## Task 2: Chat UI

Replace V1 task and event layout with left conversation sidebar, center message stream, bottom IME-safe composer and CLI-first model picker. Wire persistent settings/catalog and per-conversation native context, selected route and workspace. Display streaming assistant output, subagent and tool cards, raw details, once-only approval prompts, stop/error/retry behavior. No fixed planner/reviewer selectors or unsupported features. Keep typed narrow preload IPC.

Validation: typecheck and production build; launch isolated Electron, send prompt and inspect render/stream/state; confirm no stale-event or cross-conversation corruption. Parent independently exercises real CLI delegation and cancellation after implementer report.

## Task 3: Visual polish and release source

Only after the core/UI are operational, adapt inspected Catppuccin theme design into original Asteria CSS. Provide persisted Latte/Mocha options, restrained transparency, good typography, tool-card spacing and responsive layout. Include MIT notice if code/tokens are copied, a brief adaptation note, Chinese README and version 2.0.0. Build a Windows release in staging. Do not deploy D files or close user's V1 instance; parent handles this.

Validation: npm test, typecheck/build, packaged smoke, screenshots at normal desktop size in light and dark. Self-review spec and quality; report exact commands/results, tested routes, files and unresolved concerns in work/asteria-v2-implementation-report.md. Parent performs independent complete review and acceptance, and sends scoped fixes to the same implementer.
