# Asteria 2.0 CLI 能力记录

记录日期：2026-10-21。此文描述 V2 聊天客户端实际使用的协议。历史 V1 headless JSON 记录保存在 `docs/archive/superpowers/` 计划与实现报告中，不适用于当前 DSH ACP 调度方式。

| CLI | 已验证版本 | 会话协议 | 模型选择 | 工具委派 |
|---|---|---|---|---|
| Codex | `codex-cli 0.162.1` | `app-server --stdio` JSON-RPC；对话使用 thread/start 或 thread/resume 与 turn/start | 使用实时 `model/list`，每轮指定模型和推理强度 | 使用 thread/start dynamicTools 与 item/tool/call，返回子代理工具结果后主模型继续 |
| DSH | `0.2.0-rc.2` | ACP stdio；使用 initialize、session/new 或 session/resume、session/prompt、session/cancel | UI 展示 session/new 返回的真实 configOptions；provider 与 model ID 原样传入会话配置 | 会话级 MCP serverOptions 注入 Asteria loopback broker；tools/call 派遣独立 CLI 会话并把结构化结果交回主模型 |

Codex 与 DSH 的模型目录按 CLI 的实时响应展示；列表不保证服务端对当前账号开放每个模型。Asteria 保留原生会话 ID，因此后续轮次继续原生会话；切换 CLI 时，只补充尚未同步的用户/助手文本，不重放历史工具调用。

DSH 的 ACP 目录来自当前本机运行 `session/new` 响应。已在验收配置中观察到 5 个 live provider/model 组合：`deepseek-official` 的 `deepseek-v4-flash`、`deepseek-flash`、`deepseek-v4-pro`，以及 `deepseek-account` 的 `deepseek-flash`、`deepseek-v4-pro`。Asteria 不读取并展示旧 settings snapshot 中未由当前 session 报告的模型。

Codex 动态工具调用格式来自本机 app-server schema。DSH 使用会话级 MCP 配置，不修改用户全局 DSH profile。代理工具只提供模型目录与委派；子会话使用独立 adapter，不能继续派遣。所有子任务共享对话固定工作目录，最多六个且串行执行。DSH ACP 尚不能强制只读，Asteria 会拒绝对 DSH 子代理声明 `readOnly` 的调用。

需要批准的工具请求通过 UI 单次允许/拒绝，不升级成永久规则。未知审批选项不会自动批准。取消主 turn 会中止子 turn，且不会把取消后的子结果交回主模型。
