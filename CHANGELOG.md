# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号使用 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[2.0.0]: https://github.com/OWNER/asteria/releases/tag/v2.0.0
