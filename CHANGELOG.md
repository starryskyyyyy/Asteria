# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号使用 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.1.0] - 2026-10-23

### 新增

- 多 agent 接入：新增 **Claude Code**、**WorkBuddy / CodeBuddy**、**Gemini CLI**、**Kiro CLI**、**Qwen Code**，与原有 Codex、DSH 共 7 个 CLI。
- `src/main/agents.js` 注册表：channel（`app-server` / `acp` / `stream-json`）、能力声明、探测入口与安装提示集中一处，主进程与渲染进程都不再写死 `codex` / `dsh`。
- `src/main/providers/stream-json.js`：一套适配器同时驱动 Claude Code 与 WorkBuddy 的 `-p --output-format stream-json` 通道，支持 `--resume` 续接、逐段文本、工具调用与审批。
- `src/main/providers/acp.js`：由原 DSH 专用适配器泛化而来，ACP 参数、Node 参数与额外环境变量都由注册表提供。
- `cli-discovery.js` 通用化：识别 npm/pnpm 启动器 shim 里指向的真实载荷（`.js` 或原生 `.exe`），并支持厂商安装目录（如 WorkBuddy 的桌面版内置 CLI 内核）、PATH、`npm -g` 目录。
- 设置面板按注册表逐项显示探测结果（已连接 / 未就绪 / 未检测）与版本号；「开发者模式」可显示尚未实测的 CLI。

### 变更

- 连接信息与模型目录全部以 CLI id 为键（`catalogs[cli]` / `connections[cli]`），渲染进程的 CLI 下拉框由 `bootstrap.agents` 动态生成。
- 审批队列区分 `app-server` 与 `acp` 两种来源；只有声明 `delegates` 能力的通道才会挂上委派工具。
- 版本号 2.0.0 → 2.1.0。

### 修复

- 窗口标题改为按 `package.json` 的版本号动态生成（原先写死成 `Asteria 2.0`，与 2.1.0 不符）。
- CLI 启动失败的提示不再固定写成 `app-server exited with code N`：现在会显示 `${进程名} 进程已退出（code N）` 并附上最后一条 stderr，Codex / ACP 通道挂掉时能直接看到真实原因（例如权限、登录态、参数错误）。

### 移除

- `providers/dsh.js`（被 `providers/acp.js` 取代）与其单测。

## [2.0.0] - 2026-10-23

### 新增

- 双 CLI 原生会话：Codex（`app-server` JSON-RPC）与 DSH（ACP stdio），保留原生 thread/session id。
- 多智能体委派：`asteria_list_models` / `asteria_delegate`，子会话独立进程、最多 6 个、串行执行，结果结构化回传主模型。
- 实时模型目录（Codex `model/list`、DSH `session/new` configOptions），不写死模型。
- 审批队列：单次允许/拒绝，provider 侧超时同步清理；未知选项不会自动批准。
- 事件流持久化：索引与事件分离，事件流按容量裁剪，V1 运行记录只读归档。
- 双主题（Mocha 暗色 / Latte 亮色）、流式 Markdown 渲染、工具调用详情、历史搜索。
- 对话归档可逆：归档后仍在侧栏「已归档」分组里，可一键恢复；`Ctrl/Cmd + K` 聚焦搜索；切主题时 Windows 标题栏与窗口边框同步跟随。
- 界面动效：按钮与卡片的 hover/按下过渡、消息入场、侧栏折叠、审批条出现动画，并遵守 `prefers-reduced-motion`。
- 工程化：`npm test`（Node 内置测试）、`npm run typecheck`、`npm run build`、`npm run dist`、`npm run icon`、`npm run clean`，以及 Windows/Linux × Node 22/24 的 GitHub Actions CI。

### 变更

- 仓库结构重整为 `src/` + `scripts/` + `tests/` + `docs/`，不再把构建产物（`Asteria.exe`、`resources/`、`locales/`）提交进版本库。
- 打包目标从「仅免安装目录」改为 NSIS 安装包 + 免安装目录，补齐 `appId`、图标、版权信息与 artifact 命名。
- 生产构建注入 CSP（`connect-src 'none'`），渲染进程不允许任何网络请求。
- 会话 id 在进入文件路径前统一校验字符集，杜绝路径穿越。
- 存储写入改为带重试的原子替换，兼容 Windows 上杀软/索引器造成的短暂占用。

### 移除

- V1 的 headless `run-manager` 与 `store` 模块（及其实例级测试）——已被 `conversation-manager` + `conversation-store` 取代。
- `DshAdapter`（一次性 `dsh exec` 包装）——DSH 通道统一走 ACP。
- 提交在仓库根目录的构建产物、`test-out.txt` 等一次性文件。

[2.0.0]: https://github.com/starryskyyyyy/Asteria/releases/tag/v2.0.0
[2.1.0]: https://github.com/starryskyyyyy/Asteria/releases/tag/v2.1.0
