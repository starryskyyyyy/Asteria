# 贡献指南

## 环境

- Node.js ≥ 22（CI 覆盖 22 与 24）
- Windows 是主要开发平台，Linux 需通过 CI
- 想手工验收「真实会话」时，需要本机已安装并登录 `codex` 与/或 `dsh`

## 开发流程

```bash
npm ci
npm run dev        # 终端 1：Vite 开发服务器
npm run app        # 终端 2：Electron（默认加载 dist/）
```

指向开发服务器时需要设置 `ASTERIA_DEV_URL`（见 README「快速开始」）。改了 `src/main/` 下的文件要重新 `npm run build` 才能生效——主进程不会热重载。

## 提交前必须全绿

```bash
npm run typecheck
npm test
npm run build
```

CI 会在 Windows 与 Linux、Node 22 与 24 上跑同样三项，PR 需全绿才能合并。

## 代码约定

- 主进程是原生 ESM（`src/main/**/*.js`），渲染进程是 TypeScript + React（`src/renderer/**`）。**不要在渲染进程里引入 Node API**：它只允许通过 `window.asteria` 这一个冻结的桥通信。
- 新增 IPC 通道时，需要同时改三处：`src/main/main.js` 的 `ipcMain.handle`、`src/main/preload.cjs` 的桥方法、`src/renderer/types.ts` 的类型声明。
- 持久化写入必须走 `conversation-store.js`，不要直接 `writeFile` 到状态目录——那里有原子替换、备份回滚和 id 校验。
- 面向用户的新文案用简体中文；注释与类型名用英文。
- 安全相关改动（`webPreferences`、CSP、`shell.openExternal`、导航拦截、`setPermissionRequestHandler`）请在 PR 描述里写明影响。

## 测试

- 使用 Node 内置 `node:test` + `node:assert/strict`，不要引入额外测试框架。
- 测试文件放在 `tests/`，命名 `*.test.js`。
- 涉及文件系统的测试必须建自己的临时目录（`mkdtemp`），并在 `finally` / `t.after` 里清理。
- 不要写依赖真实 CLI、真实网络或真实用户数据的测试；这类验收写在 `docs/` 里手工执行。

## 提交信息

采用 Conventional Commits 风格：`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`，正文说明「为什么」而不是「改了什么」。
