# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 2.0.0 — 2026-11-24

**重写：适配 iWrite 新版前端（Umi + antd）**

- 新版写作页编辑器由 UEditor 改为 antd `TextArea`，限制逻辑位于 React 合成事件 `onPaste` / `onDrop` / `onDragOver` 的 `preventDefault()`；旧版 `UE.getEditor(...).addListener('beforepaste', …)` 方案彻底失效
- 新方案：在 `Event.prototype.preventDefault` 层对 `paste` / `drop` / `dragover` / `dragenter` / `beforeinput` 放行，不依赖 DOM 结构与类名
- 新增悬浮工具面板（与站点新 UI 风格一致）：状态徽标、实时词/字符统计、粘贴到光标、追加到末尾、复制全文、清空正文
- 新增站点提示静音（`该作业不允许复制粘贴` / `不允许拖入内容`）
- 新增快捷键：`Ctrl+Shift+V` 强制粘贴、`Ctrl+Shift+U` 收起/展开面板
- 新增面板拖拽与位置记忆（`localStorage`）
- 新增 SPA 兼容：路由切换/重渲染后自动重新定位编辑器，元素更替后重绑监听
- 移除对 jQuery 的依赖（`@require jquery` 删除）
- 保留旧版 `/student/toSubmitTask`（UEditor）兼容钩子
- 权限收敛为 `@grant none`（必须在页面上下文才能改写 `Event.prototype`）

## 1.0.1 — 2022-04-09（上游）

- 原作者 MagicMonkey-XK 版本，基于 UEditor `beforepaste` 返回 `true`
- 参考仓库：https://github.com/MagicMonkey-XK/XKScript