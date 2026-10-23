# Asteria 2.0 UI 适配

按用户要求先完成真实 CLI 会话与跨 CLI 派遣，再处理界面。

在 [DSH 社区插件市场](https://dshmarketplace.dev/plugins?category=theme) 找到 [DSH Catppuccin Theme](https://github.com/NoNameLeGo/dsh-catppuccin-theme)，并读取了源码及 MIT 许可证。研究参考版本为提交 `2b53263de7a214b786910e65f4d653e94830ed52`。

移植内容是 Latte、Mocha 语义配色，以及半透明侧栏、输入框和卡片的视觉处理。Asteria 将这些颜色映射到自己的 CSS 变量，重新实现了聊天列表、会话侧栏、模型选择、子代理卡片和本机偏好保存。

原插件依赖 DSH 的主题运行时、页面插槽、`--dsw-*` 变量和 DOM 标记，不能直接装进这个 Electron/React 应用。Asteria 没有引入这些宿主适配代码，也没有向用户的 DSH 全局配置安装主题插件。

MIT 原文随程序及源码的 `THIRD_PARTY_NOTICES.txt` 提供。界面支持两种主题、中文字体、键盘焦点、Markdown、代码复制、会话搜索和可展开的工具详情。
