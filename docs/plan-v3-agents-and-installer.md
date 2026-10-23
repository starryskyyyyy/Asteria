# Asteria v3 计划：多 Agent 支持 + 安装包 + 环境自动检测

> 状态：**待执行**（本轮只做决策与方案验证，不改功能代码）
> 前提：仓库已在 <https://github.com/starryskyyyyy/Asteria>，当前只支持 Codex 与 DSH 两条通道。
> 本轮新增需求（用户）：做成安装包 + 用户下载后自动检测环境、连上已装好的 agent。

---

## 0. 一句话结论

把「写死两条通道」改成「通道注册表 + 三类适配器」，在这个骨架上一次接入 **4 个必做 agent**、**3 个顺手 agent**；
把分发形态从「解压即用」升级为 **NSIS 安装包 + 便携单文件 exe**，并加 **首启环境检测向导**。

### 0.1 本轮已实测验证的事实（不是推测）

| 事项 | 结果 |
|------|------|
| Electron 二进制 | ✅ 已能下载（`node_modules/electron/dist/electron.exe` 247 MB；走本机代理 127.0.0.1:7897） |
| electron-builder 的 NSIS 工具链 | ✅ nsis-3.0.4.1 / nsis-resources-3.4.1 / 7zip / icons-bundle 全部下载成功 |
| 用 `build/icon.png` 当安装器图标 | ❌ NSIS 报 `Error while loading icon ... invalid icon file` —— **必须给 .ico** |
| 修复方式 | ✅ 已生成 `build/icon.ico`（372,526 B，含 16/24/32/48/64/128/256 七种尺寸），脚本见 `build/make-icon.ps1` |
| `portable` 目标（单文件 exe） | ✅ 构建成功：`release/Asteria-2.0.0-x64.exe`，**96.5 MB**，双击即用 |
| `nsis` 目标（安装包） | ⚠️ 载荷 `asteria-2.0.0-x64.nsis.7z`（106.7 MB）已生成；最后一步「运行一次安装器以产出 `Uninstall.exe`」在本会话里被拦截（子进程 exit code = null）。换到普通桌面 / 加管理员权限应可通过，退路见 §3.4 |
| 解包体积 | 386 MB（`electron.exe` 247 MB + `app.asar` 8.7 MB + 其余） |
| 本机已装的 agent | `claude` 2.1.207、`codex`、`dsh`（gemini / qwen / codebuddy / kiro 均未装，只能靠协议级假服务器测试） |

---

## 1. 要加哪些 Agent（决策）

判断标准只有一条：**这个 CLI 有没有机器可读的会话协议**。有协议 → 能做完整对话（流式、审批、续话）；
只有 `-p` 一次一跑 → 只能做「单轮模式」，功能降级，必须在 UI 上标注。

### 1.1 第一梯队：本轮必做（4 个）

| # | Agent | 接入方式 | 能力 | 模型目录来源 | 本机可实测 |
|---|-------|----------|------|--------------|------------|
| 1 | **Claude Code**（Anthropic） | 原生 `stream-json`：`claude -p --verbose --input-format stream-json --output-format stream-json --include-partial-messages` | 流式 ✅ 审批 ✅（`--permission-mode`，可选 `--permission-prompt-tool`）续话 ✅（`--resume` / `--session-id`） | 内置静态目录（`opus`/`sonnet`/`haiku` 别名 + 显式 id） | ✅ 2.1.207 已装 |
| 2 | **Gemini CLI**（Google） | ACP：`gemini --acp` | 流式 ✅ 审批 ✅（`session/request_permission`）续话 ✅（`loadSession`） | ACP session 配置项 | ❌ 需安装后实测 |
| 3 | **CodeBuddy / WorkBuddy**（腾讯） | 无头模式：`codebuddy -p "<prompt>" -y`（桌面版内核为 `<安装目录>\resources\codebuddy.js`，用 node 直调） | 流式 ❌ 审批 ❌（`-y` 全放行）续话 ❌ → **单轮模式** | 静态目录（模型由 CLI 侧 `/config` 决定） | ❌ 需安装后实测 |
| 4 | **Kiro CLI**（AWS） | ACP | 流式 ✅ 审批 ✅ 续话 ✅ | ACP / 静态 | ❌ 需安装后实测 |

> Claude Code 不用 `@zed-industries/claude-code-acp`（0.16.2）这个 ACP 包装包的原因：它要多装一个全局依赖、首个 token 更慢，
> 而原生 `stream-json` 与 Codex 通道同构（都是 JSONL over stdio），代码复用度高。
> 若实测 `stream-json` 不稳，**退化方案**就是换用该包装包——只需改注册表里的 `kind`，其余零改动。

### 1.2 第二梯队：跟着 ACP 通用化顺手做（3 个）

只要第 2 个 agent 把 ACP 适配器参数化，接它们几乎只是注册表里加一段配置：

| Agent | 说明 | 风险 |
|-------|------|------|
| **Qwen Code**（阿里） | Gemini CLI 的 fork，若继承 `--acp` 则零成本 | 需实测确认 `--acp` 是否保留 |
| **Crush**（Charm） | 开源终端 agent，ACP 支持 | 部分版本 ACP 为实验特性 |
| **OpenCode** | 开源终端 agent | ACP 入口命令名需实测 |

**策略：注册表里先写好，`verified: false` 的条目只在开发者模式可见；实测通过才给用户点亮。**

### 1.3 明确不做 / 押后（要写进 README 的「暂不支持」）

| Agent | 不做的理由 |
|-------|-----------|
| **Aider** | 没有会话协议也没有结构化事件，只能 PTY 抓屏；CLI 一改版就失效，维护成本极高 |
| **Cursor agent / Droid / Amp** | 闭源、无 ACP、部分只在 beta 通道，且订阅制授权，不适合第三方客户端绑定 |
| **GitHub Copilot CLI** | 有 `-p`，但企业许可与 Copilot 订阅强绑定，属于特定付费场景，押后 |
| **纯 GUI 的 agent**（豆包、文心等） | 没有 CLI 入口，不在本产品形态内 |

---

## 2. 架构改造：从「两个 if」到「一张注册表」

### 2.1 现状（问题所在）

| 位置 | 现状 |
|------|------|
| `src/main/cli-discovery.js:37-49` | `provider === 'codex' ? CODEX_ENTRY : DSH_ENTRY`，只认两家；shim 解析也只处理两家 |
| `src/main/cli-discovery.js:70` | `['codex','dsh'].map(...)` |
| `src/main/conversation-manager.js:6-7` | 直接 import 两个具体适配器类 |
| `src/main/conversation-manager.js:20` | `this.catalogs = { codex: [], dsh: [] }` |
| `src/main/conversation-manager.js:53-57` | `nextPaths = { codex: ..., dsh: ... }` |
| `src/main/conversation-manager.js:69-76` | 硬编码「并行连两台」 |
| `src/main/conversation-manager.js:217-218,357` | `['codex','dsh'].includes(...)` 两处校验 |
| `src/main/conversation-manager.js:377` | `cli === 'codex' ? new CodexAdapter : new DshAcpAdapter` |
| `src/renderer/**` | 约 54 处 `codex`/`dsh` 字面量（路由栏下拉、侧栏标题、delegate 卡片） |

### 2.2 目标结构

```
src/main/providers/
  registry.js        ← 新增：唯一的 provider 真相来源
  codex.js           ← 不动（已是最完整的协议实现）
  acp.js             ← 由 dsh.js 改名 + 参数化（通用 ACP 客户端）
  claude.js          ← 新增：Claude Code stream-json 适配器
  headless.js        ← 新增：一次性 CLI 适配器（codebuddy 等）
```

注册表条目（示意）：

```js
{
  id: 'claude',
  label: 'Claude Code',
  kind: 'claude-stream-json',        // codex-app-server | acp | claude-stream-json | headless
  verified: true,
  capability: { streaming: true, approvals: 'interactive', resume: true, readOnly: false, singleTurn: false },
  launch: { command: ['claude'], args: ['-p', '--verbose'] },
  models: () => CLAUDE_MODELS,
  install: { npm: '@anthropic-ai/claude-code', docs: 'https://docs.anthropic.com/claude-code' },
  probe: [ /* 候选路径 */ ],
}
```

适配器统一契约（现有 `codex`/`dsh` 已经是这个形状，直接沿用）：

- `connect({ cwd, mcpUrl, resumeSessionId }) -> { connected, models, diagnostic }`
- `run({ cwd, prompt, provider, model, effort, sessionId, mcpUrl }, onEvent, signal) -> { status, output, sessionId }`
- `resolvePermission(requestId, decision)` / `cancel()` / `dispose()`

### 2.3 三个必须解决的共性难点

1. **模型目录**：Codex 有 `model/list`、DSH 有 session config option，ACP 各家不一致，Claude/CodeBuddy 只有静态目录。
   → 注册表统一出 `{ id, name, reasoningEfforts[] }`；缺失的能力在 UI 上禁用而不是不显示。
2. **审批语义**：ACP 是 `session/request_permission`（可交互）；Claude 是 `--permission-mode`（+可选 MCP 回调）；
   Codex 是 server→client 审批请求（已实现）；CodeBuddy 只有 `-y`（等价全放行）。
   → `capability.approvals === 'flag'` 的通道，UI 必须常驻提示「此通道不支持逐条审批，会直接执行」。
3. **只读委派**：`asteria_delegate` 的 `readOnly` 目前只对 Codex 有效（`conversation-manager.js:218` 对 dsh 直接报错）。
   → 改成按 `capability.readOnly` 查表。

### 2.4 适配器参数化细节（现有 dsh.js 里写死的东西）

`DshAcpAdapter` 其实已经是一个通用 ACP 客户端，只是四处绑定在 DSH 上，全部要提取成参数：

| 位置 | 现在 | 改成 |
|------|------|------|
| `providers/dsh.js:38` | `resolveCli('dsh')` | 由注册表传入 `cli` |
| `providers/dsh.js:42` | 固定 `--profile acp` | `launch.args`（Gemini 是 `--acp`） |
| `providers/dsh.js:79` | 模型值固定为 `JSON.stringify([provider, model])` | `encodeModelValue(route)`；Gemini 用 `unstable_setSessionModel`，Kiro 无模型选择则隐藏选择器 |
| `providers/dsh.js:53` | `clientCapabilities: { fs: { readTextFile:false, writeTextFile:false }, terminal:false }` | 实现 `fs/read_text_file`、`fs/write_text_file`、`fs/list_directory`（带 cwd 越界校验），否则 Gemini 的文件读写被代理挡住 |

### 2.5 委派矩阵

`asteria_delegate` 的 `cli` 参数枚举由注册表动态生成，主代理可以把子任务派给**任意已连接通道**。
保留现有约束：子代理上限 6、只读校验、超时。新增：`singleTurn` 的通道不能承接需要多轮追问的委派（UI 标注）。

---

## 3. 安装包（用户下载即装）

### 3.1 目标产物（注意两者不能同名，否则会互相覆盖）

| 产物 | 目标 | 说明 |
|------|------|------|
| `Asteria-2.1.0-x64-setup.exe` | `nsis` | 安装包：按用户安装（免管理员）、可选目录、桌面/开始菜单快捷方式、卸载保留用户数据 |
| `Asteria-2.1.0-x64-portable.exe` | `portable` | 便携单文件，双击即用（已实测 96.5 MB 可构建） |

> 现在 `artifactName` 是 `${productName}-${version}-${arch}.${ext}`，两个 target 会撞名——
> 必须给 nsis 加 `-setup`、给 portable 加 `-portable` 后缀。

### 3.2 需要的改动

- `build.win.icon` / `nsis.installerIcon` / `nsis.uninstallerIcon` → `build/icon.ico`（**已改**，`icon.png` 会让 makensis 直接失败）
- `build/icon.ico` 生成脚本 `build/make-icon.ps1`（**已写**，纯 System.Drawing，无额外依赖）
- `package.json` 版本 `2.0.0` → `2.1.0`
- `nsis` 段保持 `oneClick:false` / `perMachine:false` / `allowToChangeInstallationDirectory:true` / `deleteAppDataOnUninstall:false`
- `compression: 'maximum'`（已有），`files` 白名单保持收紧
- 无代码签名证书 → SmartScreen 会提示「未知发布者」，README 要显著说明；签名留作后续

### 3.3 体积现实

解包 386 MB，压缩后 **便携版 96.5 MB / 安装包预计 100–110 MB**。
想再瘦只能裁剪 Electron 分发包或换 Tauri 重写，不在本轮。

### 3.4 NSIS 最后一步的坑（本会话已复现）

electron-builder 在生成 setup.exe 后会**运行一次安装器**来产出 `Uninstall.exe` 再回填，本会话里这一步被拦截。
下一轮按顺序试：
1. 在普通用户桌面（非受限会话）直接 `npm run dist` —— 最可能直接通过；
2. `nsis.perMachine: true` + 管理员权限构建；
3. 仍失败则改发 **portable + zip** 双产物，安装包留到 CI 里出（GitHub Actions `windows-latest` 出 artifact）。

---

## 4. 环境自动检测（用户下载后要「自动连上已装的 agent」）

### 4.1 检测链（每个 provider 独立并行，单条 5s 超时）

1. 用户手动指定的路径（`workspaces.json: cliPaths`）
2. `PATH` 里的启动器：`<name>.exe` / `.cmd` / `.ps1` / `.bat`（现有 `cli-discovery.js:77-88` 的 `pathShimCandidates`）
3. npm 全局目录：`%APPDATA%\npm\node_modules\<pkg>\bin\*.js`
4. 厂商安装目录（写进注册表）：

| Provider | 候选位置 |
|----------|----------|
| Codex | `%APPDATA%\npm\node_modules\@openai\codex\bin\codex.js`（现有） |
| DSH | `%LOCALAPPDATA%\deepseek-harness\bin\dsh.cmd`（现有） |
| Claude Code | `%APPDATA%\npm\claude.cmd`、`%USERPROFILE%\.local\bin\claude.exe` |
| Gemini CLI | `%APPDATA%\npm\gemini.cmd`、`%USERPROFILE%\.gemini\bin\gemini` |
| CodeBuddy / WorkBuddy | `%APPDATA%\npm\codebuddy.cmd`、桌面版 `<InstallDir>\resources\codebuddy.js` |
| Kiro | `%LOCALAPPDATA%\Kiro\bin\kiro-cli.exe` 等 |

5. 每个候选用 `--version` 探活（沿用 `probeCli`），拿到版本号才算「已发现」

### 4.2 运行时依赖

`.js` 入口需要 Node。当前 `findNode()`（`cli-discovery.js:28-33`）找 PATH / DSH 内置 / Program Files，分发场景要补：

- 找不到时给**明确诊断**：「该 agent 是 Node 脚本，但本机没有 Node.js，请先安装 Node 22+（附链接）」
- P2 可选：把 `node.exe` 打进 `resources/node/`（+50 MB）；先做诊断，看反馈再决定

### 4.3 首启向导（新组件 `SetupWizard`）

- 触发：`workspaces.json` 无任何 `cliPaths` 且无历史对话
- 交互：并行检测 → 逐行出现（检测中 → ✓ 已发现 v1.2.3 [路径] / ✗ 未安装 [复制安装命令]）→
  「手动指定路径」→ [进入 Asteria]（至少一个通道可用，或允许「稍后设置」）
- 装完不需要重启：设置页的「重新检测」随时刷新
- 三种失败文案要分开：未安装 / 装了但启动失败（贴 stderr 尾部）/ 装了但未登录（转发 CLI 自己的提示）

### 4.4 设置页改造

现在的「连接设置」是两行固定输入框，改成按注册表生成的动态列表：
每行 = 状态点 + 名称 + 版本 + 路径 + [重新检测]，可展开「手动指定入口」；底部「全部重新检测」。

---

## 5. 执行顺序与验收

| 批次 | 内容 | 验收标准 |
|------|------|----------|
| **B1** 骨架 | `registry.js`、`cli-discovery` 通用化、`conversation-manager` 去硬编码、渲染层按注册表渲染 | 现有 29 个测试全绿；`typecheck`+`build` 通过；codex + dsh 各发一轮行为不变 |
| **B2** ACP 通用化 | `dsh.js` → `acp.js`，Gemini / Kiro / Qwen / Crush / OpenCode 进注册表（未实测的隐藏） | fake ACP server 单测覆盖「新会话/续会话/审批/取消」；本机 dsh 回归 |
| **B3** Claude Code | `claude.js` + 静态模型目录 + 审批映射 | 本机 2.1.207 实测：新对话、流式、多轮续话、中断、`--resume` 恢复 |
| **B4** 单轮通道 | `headless.js` + CodeBuddy 条目 | 无 CLI 时用假可执行文件跑通单测；UI 正确标注「单轮模式」 |
| **B5** 安装包 | 版本号 2.1.0、产物命名、NSIS 定案、README 安装说明 | 安装 → 首启 → 连通道 → 发消息 → 卸载（确认不误删 `%APPDATA%\asteria`） |
| **B6** 首启向导 | `SetupWizard` + 设置页动态化 | 清空 `cliPaths` 后首启走向导；三种失败文案各验一次 |

预计规模：主进程 ~1200 行、渲染层 ~600 行、测试 ~400 行，新增 1 个向导组件 + 3 个适配器。

---

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| Claude Code 的 `stream-json` 是 SDK 内部格式，随版本可能变 | 解析层「未知事件忽略 + 日志留档」；备选 `@zed-industries/claude-code-acp` 通过换 `kind` 切换 |
| Gemini 的 ACP 把文件读写代理给客户端（我们现在声明 `fs:false`，见 `providers/dsh.js:53`） | 实现 `fs/*` 三个方法 + cwd 越界校验 |
| CodeBuddy 无头模式在 Windows 上 stdout 是 GBK、参数引号被 shell 吃掉 | 不用 shell 拼参（`spawn` 数组直传）；输出用 `TextDecoder('gbk')`，失败回退 UTF-8 |
| 无签名安装包触发 SmartScreen | README 显著说明；后续自签或买证书 |
| 未实测的 provider 被误点亮 | 注册表 `verified:false`，只在开发者模式可见 |
| 一次性通道被当成完整对话 | 路由栏常驻「单轮」徽标 + 点击提示 |

---

## 7. 本轮不做

- 自动更新（`electron-updater` 需要 release/CI 节奏）
- macOS / Linux 打包（当前只发 Windows；`linux.icon` 也该换成 ico→png 各自格式）
- 代码签名证书
- 内置 Node 运行时（先做诊断文案）
- 图片 / 多模态输入（各通道差异太大，单独一轮）
