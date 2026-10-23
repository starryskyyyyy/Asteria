# Asteria 2.0 审查报告 · 上 GitHub 前的待修改清单

审查日期：本轮
审查范围：`D:\12345\Asteria`（根目录为 electron-builder 产物）+ `Source\`（TypeScript/JS 源码 11 个文件 + 37 个测试）
实测结论：`npm ci` ✅ / `npm run typecheck` ✅ / `npm test` 37/37 通过 ✅（613ms）/ `npm run build` ✅

## 总体完成度

| 维度 | 评价 |
|---|---|
| 功能完整度 | ★★★★☆ 双 CLI 主模型、原生会话续接、跨 CLI 上下文桥、MCP 子代理委派、审批、流式、历史、双主题都在，是真能用的东西 |
| 代码质量 | ★★★☆☆ 主进程分层清晰（adapter/store/manager/broker），但**两套执行引擎并存，其中一套是死代码**；渲染层 1 个 329 行组件包打天下 |
| 测试 | ★★★☆☆ 37 个单测全绿且有意义，但**渲染层零覆盖**，全 fake adapter，无真实 CLI 集成测试 |
| 工程化 | ★☆☆☆☆ 无 lint、无 CI、无 LICENSE、无 CSP、无 icon、主进程零类型检查 |
| 可发布性 | ★☆☆☆☆ 仓库根目录就是 236MB 的 exe + Chromium 运行时，**现在直接 push 会炸仓库** |

一句话：**这是一个"能跑、能演示、逻辑扎实"的 2.0 预览版，但项目外壳（仓库结构/许可/工程化）几乎没有，直接上传 GitHub 会同时踩"体积超标"和"无 License"两个硬坑。**

---

## P0 · 阻断项：不改不能上传

### 1. 仓库根目录是编译产物，不是仓库
- `Asteria.exe` 247,184,896 B（236MB）
- `resources/app.asar` 8,708,350 B
- `locales/`、`chrome_100_percent.pak`、`chrome_200_percent.pak`、`resources.pak`、`icudtl.dat`、`snapshot_blob.bin`、`v8_context_snapshot.bin`
- `d3dcompiler_47.dll`、`dxcompiler.dll`、`dxil.dll`、`vk_swiftshader.dll`、`vulkan-1.dll`、`vk_swiftshader_icd.json`
- `LICENSES.chromium.html` 20,477,229 B（20MB）

GitHub 单文件上限 100MB，**`Asteria.exe` 直接 push 会被服务端拒绝**；即使删掉 exe，仓库仍被塞进 ~60MB 二进制。
**修改方向**：仓库根只放 `Source/` 的内容（或把 `Source/` 提为根），构建产物走 `.gitignore` + GitHub Releases 附件。

### 2. 没有 git 仓库、没有根级 README、没有根级 .gitignore
`D:\12345\Asteria\.git` 不存在。根目录只有 4 个中文过程文档，没有 `README.md`。
**修改方向**：`git init`，写根 `README.md`（项目简介 + 3 张 `Preview/` 截图 + 快速开始 + 架构图 + 许可）。

### 3. 没有 LICENSE
`Source\` 下只有 `THIRD_PARTY_NOTICES.txt`（内容仅为 Catppuccin 主题的 MIT 声明 + 26 行说明），**项目自身没有许可证**；`package.json` 也没有 `license` 字段。
无 License 的公开仓库在法律上是"保留所有权利"，别人不能 fork/使用。
**修改方向**：加 `LICENSE`（MIT/Apache-2.0），`package.json` 补 `"license": "MIT"`。

### 4. 残留的调试/失败产物
- `Source\test-out.txt`：一次**失败**的测试日志（`fail 1`，`duration_ms 600163`，60 万毫秒 = 挂了 10 分钟），指向已不存在的路径 `C:/Users/starryskyyy/Documents/Codex/...`。当前 37 个测试其实全绿，这个文件只会误导审查者。
- `D:\12345\Asteria\acl-report\`：我修权限时生成的临时目录，需删除。
- 我本次生成的 `ci.log` / `tc.log` / `test.log` / `build.log`、`Source\dist\`、`Source\node_modules\` 都需清掉或不入库。

### 5. `docs/` 里混着 AI 规划过程文档
- `Source\docs\superpowers\plans\2026-10-19-asteria.md`（7,024 B）
- `Source\docs\superpowers\plans\2026-10-21-asteria-chat.md`（3,693 B）
- `Source\docs\superpowers\specs\2026-10-19-asteria-design.md`（8,111 B）
- `Source\docs\superpowers\specs\2026-10-21-asteria-chat-design.md`（6,706 B）
- `Source\docs\source-requirements.txt`（7,665 B）

这些是开发过程产物（日期还是未来的 2026-10），不该作为产品文档出现在首页。
**修改方向**：移到 `docs/archive/` 或直接不入库；`docs/` 只留 `cli-capabilities.md`。

---

## P1 · 严重：功能/正确性缺陷

### 6. 有两套执行引擎，其中一套完全是死代码
`src\main\run-manager.js`（213 行，`RunManager`，planner/executor/reviewer 三角色工作流）+ `src\main\store.js`（83 行，`JsonRunStore`）**在运行时代码里零引用**：
- `main.js` 只 new 了 `ConversationManager`
- 全仓搜索 `RunManager` / `JsonRunStore` 只命中定义本身和 `tests\run-manager.test.js`、`tests\store.test.js`

同理 `src\main\providers\dsh.js:7` 的 `DshAdapter`（headless `--json` 模式，103 行）也是死代码——`defaultAdapterFactory` 只用 `DshAcpAdapter`，但 `tests\dsh-adapter.test.js` 有 4 个测试在测它。
**修改方向**：删除 `run-manager.js`、`store.js` 及对应 2 个测试文件；删除 `DshAdapter` 及 `dsh-adapter.test.js`（或明确标注 `@deprecated` 并移入 `legacy/`）。**这是"完成度"最刺眼的证据 —— 会让人以为项目有两套没收敛的架构。**

### 7. 事件被双写，磁盘和内存都翻倍
- `conversation-manager.js:247-248`：每个事件既 `conversation.events.push(event)`，又 `store.appendEvent(...)` 写到 `<id>.jsonl`
- `conversation-store.js:74-79` `save()` 把整个 conversation（**含 `events` 数组和每条事件的 `raw` 原始 CLI JSON**）写进 `conversations.json`
- `conversation-manager.js:45` `getConversation` 却只从 `.jsonl` 读事件 → `conversations.json` 里那份是**纯浪费的死数据**
- `conversation-manager.js:239` `#adapterEvent` 对**每个流式 token** 都调一次 `#event` → 一次长回答产生上千条事件，每条带 `raw`

结果：`conversations.json` 会被流式 token 级别的原始事件撑到几十 MB，而且 `#flush()` 每次都全量重写这个文件。
**修改方向**：`events` 只落 `.jsonl`，`conversations.json` 里剔除 `events`；`raw` 只在调试开关打开时持久化；token 级 delta 不单独存事件。

### 8. `conversations.json` 全量重写 = O(n²) 写放大
`conversation-store.js:112-129` `#flush()` 每次 `save()` 都把**所有对话**序列化后整体重写；`copy()`（`:135`）还是 `JSON.parse(JSON.stringify())` 深拷贝。
**修改方向**：改为每对话一个文件（或 SQLite / better-sqlite3），至少把索引与内容分离。

### 9. `#exists()` 用读整个文件来判断存在
`conversation-store.js:131`：`async #exists(file) { try { await readFile(file); return true; } catch { return false; } }`
对一个几十 MB 的 `conversations.json` 做存在性判断就是全读一遍；对目录还会抛 `EISDIR`。
**修改方向**：`access()` / `stat()`。

### 10. 两套互相矛盾的 ID 校验
- `conversation-store.js:134`：`/^[a-zA-Z0-9_-]{1,100}$/`
- `conversation-manager.js:337`：`/^[a-f0-9-]{36}(?:-[a-f0-9-]{36})?$/`（只接受小写 UUID）

`cancel()`（`:114`）里 `ctl.conversation.id !== validId(id)` 遇到非法 id 会**抛异常**而不是返回 `false`，IPC 层直接变成 rejected promise。
**修改方向**：统一成一个校验函数，取消类操作用"校验失败返回 false"而非抛错。

### 11. 子代理配额计数在参数校验之前
`conversation-manager.js:201`：`if (++ctl.toolCalls > MAX_CHILDREN)` 在 `args.cli`/`task` 校验（`:202-204`）之前自增。模型传错参数也会消耗 6 次配额。
**修改方向**：先校验再计数。

### 12. 每轮结束都销毁 adapter，但 runtime 缓存不肯清
`conversation-manager.js:286` `#finish()` 里 `await ctl.adapter.dispose()`，但 `this.runtime`（`:303-311`）里那条记录**不删**。
后果：① 下一轮 `#adapter()` 返回的是**已 dispose 的实例**，靠 `connect()` 里 `if (this.peer ...)` 兜底重连；② 于是**每一轮都要重新 spawn 一次 Codex app-server / DSH ACP 进程并重新 `thread/resume` / `session/resume`**，"复用原生会话"的性能收益被抵消；③ runtime Map 单调增长。
**修改方向**：二选一——要么 turn 结束后保留进程（真正的会话复用），要么结束时就 `runtime.delete()` 并接受冷启动。

### 13. 审批自动超时的状态不同步
`codex.js:162` 和 `dsh.js:268` 都有 120 秒定时器，超时自动 `decline`/`cancel`。但 `ConversationManager.pendingApprovals`（`conversation-manager.js:260`）是**另一个 Map**，adapter 侧超时后 CM 完全不知情：
- 对话 `status` 卡在 `awaiting-approval`
- UI 上的审批卡片一直挂着，直到整个 turn 结束才被 `#finish`（`:278-282`）清掉
**修改方向**：adapter 超时时向 CM 回发一个 `approval_expired` 事件。

### 14. Codex 的工具调用在 UI 里根本看不到
`App.tsx:266` 的过滤器：`/tool|delegate|handoff|approval|session_update|agent_thought/`
但 `codex.js:177` 发出的事件类型是 `message.method` 原样，即 `item/started`、`item/completed`、`item/agentMessage/delta`、`item/commandExecution/...`、`turn/completed` —— **没有一个能被这个正则命中**。
所以"工具与子代理事件"面板里 Codex 侧永远是空的（只有 `delegate_*` 和 `handoff` 会显示）。
**修改方向**：在 adapter 层把 Codex 的 `item/*` 归一化成自定义事件类型，或把正则改成包含 `item/`、`turn/`。

### 15. Markdown 不支持链接，所以链接不可点
`App.tsx:320-329` `renderInline()` 只处理 `` `code` ``、`**bold**`、`*italic*`，**没有 `[text](url)` 分支**；同时 `main.js:52-55` `setWindowOpenHandler(() => ({action:'deny'}))` 拒绝所有新窗口，也没有 `shell.openExternal`。
结果：模型输出里的链接是纯文本，点了没反应，也无法复制成可点链接。
**修改方向**：parser 支持链接 → `renderInline` 输出 `<a>` → 主进程加一个 `asteria:open-external` IPC，用 `shell.openExternal` 且校验 `http/https`。

### 16. `DshAcpAdapter.connect()` 返回的数据是假的
`dsh.js:26`：`version: '读取中'`, `capabilities: { modelSelection: false }`
但实际支持 `session/set_config_option` 选模型（`dsh.js:160`）。
而且 `conversation-manager.js:66` 用 `{ ...detected.dsh, ...dshState }` 展开 —— `dshState.version` 把 `detectClis` 探测到的**真实版本号覆盖成"读取中"**，永久显示占位符。
**修改方向**：`version` 用探测值，`modelSelection: true`。

### 17. `dsh.js:218` 是死条件
`if (!active.done || this.active === active) { await this.#terminate(); ... }`
`active.done` 是 `new Promise(...)`，**永远 truthy**，所以 `!active.done` 恒为 `false`，整个判断退化成 `this.active === active`。
**修改方向**：删掉 `!active.done ||`。

### 18. `codex.js:105` 的早退会挂 3 秒
`if (signal?.aborted) { void abort(); return; }` 在 `new Promise` 里直接 return，**没有 resolve**。只能靠 `#interruptActive()`（`:189-206`）里 `Promise.race([active.done, 3s timeout])` 把 3 秒等满后走 `#terminate()` 才 settle。
**修改方向**：这里直接 `finish({status:'cancelled'})`。

### 19. `codex.js:82` 把 `onToolCall` 存在实例上
`this.onToolCall = onToolCall;`，`#serverRequest` 里读 `this.onToolCall`（`:151`）。主/子 adapter 是不同实例所以侥幸正确，但同一个 adapter 上并发两个 turn（当前被 `#assertIdle` 挡住）就会串话。
**修改方向**：挂到 `active` 对象上。

### 20. `delegate-broker.js:50` 是死代码
`if (result.isError) result.isError = true;` —— `result` 的形状是 `{ content: [...] }`，**永远没有 `isError` 字段**。
**修改方向**：删除，或在 `handlers.delegate` 返回带 `isError` 时正确地透传。

### 21. `json-rpc.js` 缺背压与缓冲上限
- `#buffer`（`:6`）无上限：一个异常/恶意的 CLI 子进程可以持续吐无换行的数据把主进程内存吃光
- `#write()`（`:44-47`）忽略 `child.stdin.write()` 的返回值，没有处理 `drain`
**修改方向**：`#buffer` 加 8MB 上限并断连；`#write` 处理背压。

### 22. CLI 探测路径硬编码到某个特定发行版
- `cli-discovery.js:7-9`：`CODEX_ENTRY = %APPDATA%\npm\node_modules\@openai\codex\bin\codex.js`、`DSH_ENTRY = %APPDATA%\dsh-tauri\dependencies\dsh\...`、`DSH_NODE = %APPDATA%\dsh-tauri\runtime\node.exe`
- `cli-discovery.js:30`：`%LOCALAPPDATA%\deepseek-harness\bin\dsh.cmd`

`dsh-tauri` 是某个特定桌面壳的安装布局。换台机器、换安装方式（npm 全局装 / pnpm / 独立 exe）就找不到。
- `cli-discovery.js:73-75` 还用正则从 `dsh.cmd` 里抠 `DSH_BIN=` / `$dshBin = '...'`，非常脆弱。
- `cli-discovery.js:7` `process.env.APPDATA || ''` 在非 Windows 上会拼出**相对路径**；`dsh.js:35` 的 `process.env.USERPROFILE` 同理（会得到 `undefined\.dsh`）

**修改方向**：探测顺序改为 `settings → PATH → 官方安装位置 → 常见包管理器位置`；用 `os.homedir()`/`app.getPath()` 而不是裸环境变量；`.cmd` 解析失败就放弃而不是正则硬猜。

### 23. 没有 CSP
`index.html` 没有 `<meta http-equiv="Content-Security-Policy">`，`main.js` 也没设置 `session.defaultSession.webRequest.onHeadersReceived`。
Electron 会打"内容安全策略缺失"的安全警告。虽然当前 renderer 不用 `innerHTML`（这点做得很好），但缺少 CSP 是 Electron 应用的标准审计项。
**修改方向**：加 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:*`。

---

## P2 · 工程质量

### 24. 主进程零类型检查
`tsconfig.json:13` 的 `include` 只有 `["src/renderer/**/*.ts", "src/renderer/**/*.tsx"]`。`src/main/` 下 **9 个 .js 文件（约 66KB 核心逻辑）完全不参与 `tsc`**，`strict: true` 形同虚设。
也没有 `checkJs` / `allowJs` / `// @ts-check`。
**修改方向**：主进程迁 `.ts`（推荐）或至少加 `checkJs: true` + JSDoc；`include` 加 `src/main/**/*.js`。

### 25. 没有任何 lint
没有 `.eslintrc*` / `eslint.config.*` / `biome.json` / `.prettierrc`，`package.json` 没有 `lint` 脚本。
但 `App.tsx:100` 里赫然写着 `// eslint-disable-next-line react-hooks/exhaustive-deps` —— **注释是给一个不存在的 ESLint 写的**，这条 `useEffect(..., [])` 的真实依赖问题因此无人看守。
**修改方向**：加 ESLint（或更轻的 Biome）+ `lint` 脚本，接进 CI。

### 26. 没有 CI
`.github/` 不存在。README 让用户手动跑 `npm run typecheck && npm test && npm run build`，没有任何自动验证。
**修改方向**：加 `.github/workflows/ci.yml`（windows-latest，Node 24，typecheck + test + build）。

### 27. `scripts/build-main.mjs` 只是 `cp`
```js
await cp('src/main', 'dist/main', { recursive: true });
```
主进程**完全没打包**：`dist/main/` 是 11 个裸 JS 文件直接进 `app.asar`，无压缩、无 tree-shake、无 sourcemap。
**修改方向**：用 esbuild 打包成单文件 + 生成 sourcemap（也能顺带把 `preload.cjs` 的路径统一）。

### 28. 依赖版本策略混乱
- `typescript: "^7.0.2"`：TypeScript 7 是大版本跃迁（原生移植版），`^7.0.2` 会拉到任何 7.x；`node_modules/typescript` 装的就是它
- `electron: "^44.9.0"`、`vite: "^8.3.4"`、`@vitejs/plugin-react: "^6.1.2"` 全是 `^` 浮动
- 而 `react: "19.3.1"`、`react-dom: "19.3.1"` 是精确 pin

同一个 lockfile 下没问题，但 `electron` 用 `^` 意味着换台机器 `npm install`（而非 `npm ci`）可能拿到不同 Chromium 大版本，渲染行为不可复现。
**修改方向**：统一策略（建议全部精确 pin，靠 Renovate/Dependabot 升级）；electron 尤其要 pin。

### 29. `package.json` 元数据不全
缺 `license`、`author`、`repository`、`homepage`、`bugs`、`engines.node`（README 明说需要 Node 24）。
`"private": true` 对开源无影响，可保留。
**修改方向**：补齐上述字段。

### 30. `react` / `react-dom` 放在 `dependencies`
Vite 已经把 React 打进 `dist/renderer/assets/index-*.js`（241KB），运行时不需要 `node_modules`。放在 `dependencies` 会让 electron-builder 把整个 `node_modules/react*` 也塞进 `app.asar`（虽然 `files` 白名单兜住了，但语义错误）。
**修改方向**：移到 `devDependencies`。

### 31. electron-builder 配置过薄
`package.json:29-50`：没有 `icon`（会出默认 Electron 图标）、没有 `asar`/`asarUnpack` 显式配置、没有 `copyright`、没有 `artifactName`、`target: "dir"` 只产出免安装目录（不能分发安装包，也不签名）。
`Source\` 下也没有任何 `build/` 资源目录、没有 `.ico`。
**修改方向**：加 `build/icon.ico`（256×256 多尺寸），`win.target` 补 `nsis`/`portable`，加 `artifactName`。

### 32. 测试策略空洞处
- **渲染层零覆盖**：`App.tsx`（329 行，全部交互逻辑）没有任何测试，仓库里也没有 jsdom / @testing-library 依赖
- `markdown.js` 只测了 block parser，`renderInline()` 的正则（`App.tsx:321`）没测
- 全部 adapter 都是 fake，没有一次真实 CLI 的端到端集成测试（README 说"已验证 codex-cli 0.162.1 / DSH 0.2.0-rc.2"，但没有可复现的验证脚本）
- `tests\conversation-manager.test.js:119` 用 `for (...) await setTimeout(5)` + 400 次重试做时序断言，是典型的 flaky 来源
- `npm test` 就是裸 `node --test`，无覆盖率、无 `--test-concurrency` 控制；测试用 `path.resolve('work', ...)` 会在源码目录里造 `work/` 目录

**修改方向**：加 `@testing-library/react` + jsdom 覆盖 `App.tsx` 关键路径；加一个 `test:integration` 脚本（可选，需真实 CLI，CI 里 skip）；用 `AbortSignal`/`deferred` 替代 sleep 轮询。

### 33. `styles.css` 是 24KB / 64 行
平均每行 380 个字符，大量规则挤在单行里（见文件第 29、34、58 行）。改一个颜色要在 380 字符的行里找。
**修改方向**：格式化（Prettier / Stylelint），拆成 tokens / layout / components 三层。

---

## P3 · 体验与文档

### 34. 归档是"黑洞"
`ConversationManager.archive()` 只设 `archived: true`，`App.tsx:231` 列表用 `filter(item => !item.archived)` 过滤掉。
**归档后没有任何入口能再看到它** —— 数据永远留在磁盘上，但 UI 里永久消失。同时也没有真正的"删除对话"功能。
**修改方向**：加"已归档"视图 + 恢复/永久删除。

### 35. 无用的快捷键提示
`App.tsx:229`：`<kbd>⌘ K</kbd>` —— 既是 macOS 符号（应用是 Windows-only），也**没有绑定任何键盘处理**。
**修改方向**：改成 `Ctrl K` 并真的实现聚焦搜索。

### 36. `refresh()` 的闭包过期
`App.tsx:105-114` 的 `refresh()` 读闭包里的 `cli`，设置面板的"应用并检查模型"按钮（`:225`）用它判断"当前 CLI 没模型"——用户切换 CLI 后点它，报错会针对旧的 CLI。
**修改方向**：传参或读 ref。

### 37. 缺 UI 状态样式
`styles.css` 里 `mini-state` / `status-badge` 只定义了 `.running/.connecting/.completed/.failed`。
`idle`、`cancelled`、`interrupted`、`awaiting-approval` 四个状态**没有样式** → 侧栏小圆点和状态徽章在这些状态下是灰的/无色的，用户看不出"正在等审批"。
**修改方向**：补齐 4 个状态色（`awaiting-approval` 尤其需要醒目）。

### 38. 其他体验欠账
- 代码块只有"复制"，无语法高亮、无行号、无换行折行
- 消息不能重新生成、不能编辑、不能删除单条
- 输入框固定 `rows={2}`，不会随内容长高
- 搜索只匹配 `title`/`cwd`/`model`，**不搜消息正文**
- 全站硬编码中文，无 i18n
- `kbd` 提示、`avatar`、可点击 `div` 缺 aria/role，键盘可达性差
- 没有 loading skeleton，冷启动时列表/消息区空白

### 39. 文档问题
- `Source\README.md` 只有 35 行，**没有**：徽章、截图（`Preview\` 里 3 张 PNG 一张都没被引用）、目录结构、架构说明、贡献指南、License 段落、常见问题
- 根目录 3 份中文 md（`Asteria-2.0-UI移植说明.md` 1,083 B、`Asteria-2.0-使用说明.md` 2,250 B、`Asteria-2.0-验收报告.md` 3,590 B）+ `Asteria-2.0-验收数据.json`（38,226 B）是一次性交付物，和 `Source\README.md` 内容重叠
- `docs\cli-capabilities.md` 写死 `codex-cli 0.162.1` / DSH `0.2.0-rc.2`，但 README 没给最低版本要求
- `Asteria-2.0-使用说明.md` 说数据在 `%APPDATA%\asteria\state`，而 `main.js:16` 实际是 `app.getPath('userData') + '\state'`（目录名大小写/来源不符）
- 没有 `CONTRIBUTING.md`、`SECURITY.md`、`.editorconfig`、`.nvmrc`

### 40. 缺失的常规兜底
- 无 `app.setAppUserModelId`（Windows 任务栏分组/通知异常）
- 生产模式没关 DevTools、没裁剪默认菜单（默认 Electron 菜单带 "Reload"/"Toggle DevTools"）
- `main.js:54` dev 白名单硬编码 `http://127.0.0.1:5173/`，vite 端口被占用换端口后 dev 模式直接白屏（应读 `ASTERIA_DEV_URL` 的 origin）
- `conversation-manager.js:331` `#emit` 里 `try { listener(event) } catch {}` 静默吞掉所有订阅者异常，出问题时无任何痕迹
- 无崩溃/错误日志落盘，用户报 bug 时没有任何可诊断材料

---

## 做得好的地方（改的时候别弄坏）

1. **安全基线正确**：`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`（`main.js:50`），`preload.cjs` 只暴露白名单 IPC，`setWindowOpenHandler` 全拒。
2. **渲染层无 XSS**：`App.tsx:288` 注释写明"React text nodes only"，`renderText` 全程不碰 `innerHTML`，Markdown 自己写了个 45 行的安全 parser。
3. **原子写 + 备份恢复**：`conversation-store.js:112-129` 写临时文件 + rename，Windows `EPERM` 时降级到 `.bak` 往返，`#initialize` 能识别 `.corrupt-*` 并把损坏文件另存 —— 并且有 4 个测试覆盖这些路径。
4. **多 agent 委派是真的**：`delegate-broker.js` 起一个 loopback HTTP MCP endpoint（随机 32 字节 token 路径），Codex 走 `dynamicTools` + `item/tool/call`，DSH 走 ACP session 级 `mcpServers`，**不写用户全局 profile** —— 这个设计很干净。
5. **状态机严谨**：`#assertIdle` 全局单活动锁、`#finish` 幂等（`ctl.finished` 短路）、取消时先 `abort` 再 `stop` 再等 `operation`、审批在 `#finish` 里统一回收。
6. **子代理边界清晰**：串行队列（`delegateQueue`）、最多 6 个、10 分钟超时、父取消级联、DSH 强制拒 `readOnly`（因为 ACP 无沙箱）—— 这些"诚实的限制"写进了 README 和 tool description，比假装支持要好得多。
7. **37 个测试全绿**，覆盖了 UTF-8 跨 chunk 切割、JSON-RPC 半行缓冲、Windows 替换备份、陈旧进程恢复、审批 ID 跨 peer 唯一性这些真容易错的点。

---

## 建议的下一轮修改顺序

| 批次 | 内容 | 预计 |
|---|---|---|
| 1 | 重构仓库：源码提到根、`.gitignore`、`LICENSE`、根 `README.md`（带截图）、删 236MB 产物与 `test-out.txt`/`acl-report` | 必修 |
| 2 | 删死代码：`run-manager.js`、`store.js`、`DshAdapter` 及 3 个关联测试文件 | 必修 |
| 3 | 修正确性：事件双写、`#exists`、ID 校验、adapter 生命周期、审批超时同步、Codex 工具事件可见、Markdown 链接、CSP | 必修 |
| 4 | 补工程化：ESLint + CI + 主进程 `checkJs` + electron-builder icon/nsis + 依赖 pin | 强烈建议 |
| 5 | 补体验：归档视图、删除对话、状态色、代码高亮、搜索正文、快捷键 | 建议 |
| 6 | 补测试：`App.tsx` 的 jsdom 测试、`renderInline` 正则测试、去 flaky | 建议 |
