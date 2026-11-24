# 新版 iWrite 写作页限制实现分析

> 分析对象：`https://iwrite.unipus.cn/student/daily/write?taskId=...&uid=...&classId=...`
> 分析时间：2026-11-24
> 方法：静态比对生产 bundle + Chrome DevTools Protocol 真机验证

## 1. 技术栈识别

首页 HTML（`https://iwrite.unipus.cn/`）只输出一个空的 `#root` 与两个入口资源：

```html
<script>window.publicPath = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ || "/newfe/";</script>
<link rel="stylesheet" href="/newfe/umi.css" />
<div id="root">…loading…</div>
<script src="/newfe/umi.js"></script>
```

- `umi.js` 体积 **5,562,306 字节**，单文件包含全部路由与页面组件（未做 code-splitting）
- 样式 `umi.css` 约 1.02 MB
- 页面模板里出现 `ant-spin` / `ant-message` 等类名 → **Ant Design**
- 引入 `qiankun` 的 publicPath 变量 → 微前端容器（本仓库不涉及）
- 字体 `AlibabaPuHuiTi-3`

真机 DOM（写作页）确认：

```html
<textarea class="ant-input ant-input-borderless editor___Y7_5o"
          placeholder="请在此撰写你的作文..."></textarea>
<div class="editorWrap___3Kvn5">…</div>
<button class="saveBtn___YabrT">保存</button>
<button class="submitBtn___G0p0x">提交</button>
```

类名带 hash 后缀（CSS Modules），**不能作为长期稳定的选择器**。

## 2. 旧方案失效的直接原因

老脚本做的是：

```js
UE.getEditor('editor').addListener('beforepaste', () => true);
```

这是百度 **UEditor** 的接口。在 `umi.js` 全文中检索：

```
beforepaste   → 0 处
UEditor       → 0 处
UE.getEditor  → 0 处
ueditor       → 0 处
```

即新版页面**完全不含 UEditor**，`UE` 是 `undefined`，脚本第一行就抛错（或静默跳过），自然无效。

## 3. 限制逻辑的真实位置

在 `umi.js` 中检索 `onPaste`，在偏移 `172721` 处命中写作页组件：

```js
Object(I["jsx"])(i["a"].TextArea, {
  className: Q.a.editor,
  value: D,
  placeholder: "请在此撰写你的作文...",
  autoSize: { minRows: 12, maxRows: 22 },
  bordered: false,
  onChange: e => gt(e.target.value),
  onPaste: bt,      // ← 粘贴拦截
  onDrop: yt,       // ← 拖入拦截
  onDragOver: jt    // ← 拖拽悬停拦截
})
```

三个 handler 的定义在同一组件内（偏移 `161925` 起）：

```js
ht = null != $e && 0 === Number($e.copy),          // 开关：任务数据 copy === 0 → 禁止

vt = e => { E(e), Je.current = !0 },               // 标题 onChange
gt = e => { P(e), Je.current = !0 },               // 正文 onChange

bt = e => { ht && (e.preventDefault(), f["default"].warning("该作业不允许复制粘贴")) },
yt = e => { ht && (e.preventDefault(), f["default"].warning("该作业不允许拖入内容")) },
jt = e => { ht && e.preventDefault() },
```

要点：

1. **`ht` 来自服务端**：写作任务详情接口下发的 `copy` 字段，`0` 表示该作业禁止复制粘贴（教师侧开关）。
2. **`bt` 做了两件事**：`preventDefault()` 掐掉浏览器默认粘贴行为，然后弹 antd message。
3. 拦截只发生在 **React 合成事件**上，没有 document 级 `addEventListener('paste')`（全文检索 `addEventListener("paste")` 为 0 处）。
4. 同一页面还有 `onChange` 直接 `setState`，**没有对粘贴内容做任何过滤或来源校验**（无 `isTrusted` 判断逻辑，全文 `isTrusted` 仅 1 处，属 React 内部）。

旁证：同组件还实现了图片 OCR 填正文（`ocrRecognize`）、写作计时（`writingTime: Math.max(1, floor(ae/60))`）、提交前中英文校验等，说明该页面是纯前端驱动的写作流程。

## 4. 三种绕过思路对比

| 方案 | 做法 | 可行性 | 结论 |
| --- | --- | --- | --- |
| A. 改闭包变量 `ht` | 设法让 `ht` 为 `false` | 变量在函数作用域内，外部不可达；除非改 React fiber/memoizedState，脆弱且侵入性强 | 放弃 |
| B. 改接口响应 | 拦截 fetch/XHR，把 `"copy":0` 改成 `"copy":1` | 客户端提示会消失，但要重写响应体（重建 `Response`、处理 XHR `responseText`），有破坏 `content-length` / 压缩头的风险 | 不作为默认，仅记录 |
| C. 放行 `preventDefault` | patch `Event.prototype.preventDefault`，对 `paste/drop/dragover/dragenter/beforeinput` 直接 return | 浏览器恢复默认行为，React 仍能收到 `input` → `onChange`；不碰数据、不改请求、不依赖类名 | **采用** |

方案 C 之所以成立，是因为 **React 的 `SyntheticEvent.preventDefault()` 最终会调用原生事件对象的 `preventDefault()`**。把原生方法改成对这几类事件空实现后：

```
dispatch paste 事件
  → React root 上的委托监听触发
  → 合成事件 handler bt 执行
  → bt 调 e.preventDefault()  → 空实现，原生 defaultPrevented 仍为 false
  → 浏览器执行默认粘贴 → 文本插入 textarea
  → 浏览器派发 input 事件
  → React onChange(gt) → setState(新值)
  → 受控 value 与 DOM 一致（不会回写成空）
```

而且这条路径**完全不依赖 DOM 结构或类名**，站点改版只要还拦在事件层就有效。

副作用只有一个：`bt` 里的 `message.warning` 仍会弹。脚本用 `MutationObserver` 匹配文案 `不允许复制粘贴|不允许拖入内容`，给对应的 `.ant-message-notice` 设 `display:none`。

## 5. 写入受控组件（面板按钮用）

直接 `textarea.value = text` 会被 React 的受控渲染回写（因为 React 的 state 没变）。正确做法是调用原生 setter 再派发 `input`：

```js
const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
setValue.call(ta, next);
ta.dispatchEvent(new Event('input', { bubbles: true }));   // React onChange 收到
```

`粘贴到光标` 会读取 `selectionStart/selectionEnd` 做插入，写完后恢复光标位置。

## 6. 编辑器定位策略

类名带 hash（`editor___Y7_5o`）不可靠，脚本按优先级匹配并做可见性/尺寸双重校验：

```js
const EDITOR_SELECTORS = [
  'textarea[placeholder*="撰写"]',
  'textarea[placeholder*="作文"]',
  'textarea[class*="editorWrap"]',
  '.editorWrap textarea',
  'textarea.ant-input-borderless',
  'textarea.ant-input',
];
```

兜底：取当前可见、高度 > 80px 的最大 `textarea`（排除 antd 用于计算 `autoSize` 的隐藏测量框）。

因为 umi 是 SPA，脚本用 `MutationObserver` + 定时兜底重新定位编辑器并在元素更替后重绑监听。

## 7. 复现方法

1. 下载 bundle：

```powershell
Invoke-WebRequest -Uri 'https://iwrite.unipus.cn/newfe/umi.js' -OutFile umi.js
```

2. 定位限制逻辑（Python）：

```python
s = open("umi.js", encoding="utf-8", errors="replace").read()
i = s.find("onPaste:bt")
print(s[i-120:i+120])
```

3. 运行时验证（Chrome 带调试端口启动）：

```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\tmp\chrome-debug https://iwrite.unipus.cn/
```

4. 用 CDP 对页面派发可取消的 `paste` 事件，观察 `defaultPrevented`（详见 [verification.md](verification.md)）。

## 8. 结论

新版限制是一层**纯客户端的 UI 约束**，实现方式是 React 合成事件里的 `preventDefault()`。在事件原型层放行即可完整恢复粘贴能力，且不影响页面自身的数据流。方案不修改任何网络请求与响应。