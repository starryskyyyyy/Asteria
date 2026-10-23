# CLI 能力记录

记录日期：2026-10-23（2.1.0 多 agent 接入）。此文描述当前客户端实际使用的协议。历史 V1 headless JSON 记录保存在 `docs/archive/superpowers/` 计划与实现报告中，不适用于当前调度方式。

## 总览

| Agent | 已验证版本 | 通道 | 模型选择 | 跨 CLI 委派 |
|---|---|---|---|---|
| Codex | `codex-cli 0.162.1` | `app-server --stdio` JSON-RPC | 实时 `model/list`，每轮指定模型与推理强度 | ✅ dynamic tools + `item/tool/call` |
| Claude Code | `2.1.207` | `-p --output-format stream-json` NDJSON | `--model` | — |
| WorkBuddy / CodeBuddy | `2.161.0` | 桌面版内置 `cli/bin/codebuddy`，同一套 stream-json | `--model` | — |
| DSH | `0.2.0-rc.2` | ACP stdio | `session/new` 返回的真实 configOptions | ✅ 会话级 MCP loopback broker |
| Gemini CLI | 待实测 | `gemini --acp` | ACP configOptions | — |
| Kiro CLI | 待实测 | `kiro acp` | ACP configOptions | — |
| Qwen Code | 待实测 | `qwen --acp` | ACP configOptions | — |

「待实测」表示按官方协议实现并有单测覆盖，但尚未在本机安装真实二进制跑通；这些项在 UI 中默认折叠，勾选「开发者模式」后才会出现在下拉框。

## app-server（Codex）

对话使用 `thread/start` 或 `thread/resume` 与 `turn/start`；模型与推理强度每轮传递。委派走 `thread/start` 的 `dynamicTools` 与 `item/tool/call`，返回子代理工具结果后主模型继续。schema 来自本机 app-server 自述。

## ACP（DSH / Gemini / Kiro / Qwen）

ACP stdio：`initialize` → `session/new` 或 `session/resume` → `session/prompt` / `session/cancel`。UI 展示 `session/new` 返回的真实 configOptions；DSH 的 model 选项值是 JSON 数组 `[provider, modelId]`，因此同一通道内可切换 provider。

DSH 的 ACP 目录来自当前本机运行 `session/new` 响应。已在验收配置中观察到 5 个 live provider/model 组合：`deepseek-official` 的 `deepseek-v4-flash`、`deepseek-flash`、`deepseek-v4-pro`，以及 `deepseek-account` 的 `deepseek-flash`、`deepseek-v4-pro`。Asteria 不读取或展示旧 settings snapshot 中未被当前 session 报告的模型。

ACP 通道的委派通过会话级 `mcpServers` 注入 Asteria 的 loopback broker，不修改用户全局 profile（DSH 用 `--profile acp`，其余 CLI 用各自的会话级 MCP 配置）。ACP 尚未提供统一的强制只读开关，因此对声明 `readOnly` 的 ACP 子调用会直接拒绝。

## stream-json（Claude Code / WorkBuddy）

```
claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages \
       [--model <id>] [--permission-mode <mode>] [--resume <session-id>]
```

- 输出是逐行 NDJSON。`system/init` 带 `session_id`、`model`、`tools`、`permissionMode`；`assistant` 消息的 `content` 里混有 `text` 与 `tool_use`；`result` 结束一轮并带 `usage` 与 `is_error`。
- 增量文本来自 `stream_event`（需 `--include-partial-messages`）；适配器同时兼容「只有全量文本、没有增量」的 CLI 版本，不会重复渲染。
- 续话用 `--resume <session_id>` 恢复原生上下文，不重放历史。
- WorkBuddy 的桌面版把 CLI 内核放在 `<安装目录>\resources\app.asar.unpacked\cli\bin\codebuddy`。它是一个带 shebang 的扩展名脚本，需要 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1` 才会加载轻量内核；Asteria 在注册表里按 CLI 注入该环境变量，并按「无扩展名的 JS 载荷」交给 Node 运行。
- 该通道的审批来自 `control_request`/`can_use_tool` 请求；目前适配器不主动接管，交由 CLI 自己的 `--permission-mode` 决定。

## 探测与连接

`src/main/agents.js` 是唯一事实来源：每个 agent 声明 `channel`、`supports`（models/approvals/resume/delegates/effort，供 UI 显示能力）与 `entries()`（本机可能路径）。`cli-discovery.js` 依次尝试：用户手动指定的路径 → PATH 上的启动器（`.exe`/`.cmd`/`.ps1`）→ 解析启动器 shim 里指向的真实载荷 → 厂商安装目录。找到后用 `--version` 探活，探测失败只在 UI 里显示诊断，不会阻止其他 CLI。

## 审批与中断

需要批准的工具请求通过 UI 单次允许/拒绝，不升级成永久规则；未知选项不会自动批准。取消主 turn 会中止子 turn，且不会把取消后的子结果交回主模型。所有子任务共享对话固定工作目录，最多六个且串行执行；子会话使用独立 adapter，不能继续派遣。
