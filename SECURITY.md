# 安全策略

## 支持的版本

只有当前最新的 `2.x` 版本会收到安全修复。

## 报告漏洞

**请不要开公开 issue。** 使用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/zh/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)（仓库 → Security → Report a vulnerability）提交，或在仓库主页找到维护者邮箱私下联系。

请在报告里尽量包含：复现步骤、影响范围（渲染进程 / 主进程 / 存储 / CLI 子进程）、Asteria 版本与平台、以及你认为的攻击者前提（例如「需要先让模型输出恶意链接」）。

## 设计上的信任边界

理解下面几点能帮你判断什么算漏洞：

- **Asteria 本身不调用模型服务**。所有模型流量都发生在用户自己安装的 `codex` / `dsh` 子进程里，凭据由这些 CLI 自己管理，Asteria 不读取、不存储、不转发它们。
- **模型输出是不可信输入**。渲染进程用 Markdown 渲染模型输出，会剥离 HTML、拦截非 `http/https/mailto` 链接；电击式攻击（prompt injection）属于被委托 CLI 的责任范围，不算 Asteria 的渲染层漏洞——除非它能突破渲染进程边界。
- **渲染进程没有 Node**。`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，只能看到 `preload.cjs` 暴露的冻结方法表；能突破这一层（例如通过未过滤的 IPC 参数拿到任意文件写入）才算漏洞。
- **审批是单次的**。设计上不提供「永久允许」，未知或缺失选项一律拒绝。如果你发现某条路径能在用户未确认的情况下让 CLI 执行命令，那就是漏洞。
- **状态目录是用户数据**。`%APPDATA%\Asteria\state` 里的对话内容未经加密，与大多数桌面聊天客户端一致；需要磁盘加密请用操作系统能力。

## 已知的非问题

- 检测到自动更新的缺失：Asteria 不实现自动更新，也不校验自身二进制签名，分发渠道的信任由用户自行判断。
- 子代理工作目录与主会话相同、且 DSH 通道无法强制只读——这已在 README「已知限制」中说明，属于公开的行为约束而非漏洞。
