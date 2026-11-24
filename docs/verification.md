# 端到端验证记录

> 环境：Chrome 158.0.8127.36（CDP `--remote-debugging-port=9222`）、Windows、
> 页面 `https://iwrite.unipus.cn/student/daily/write?taskId=…`
> 日期：2026-11-24

所有验证均通过 CDP 完成，不是"看代码推断"。

## 实验 1：限制是否真的在事件层

对真实编辑器派发**可取消**的合成事件，观察 `defaultPrevented`：

```js
const ta = document.querySelector('textarea[placeholder*="撰写"]');
const dt = new DataTransfer(); dt.setData('text/plain', 'HELLO_PASTE_TEST');
const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
ta.dispatchEvent(ev);
ev.defaultPrevented;   // → true，说明 React 的 onPaste 确实调了 preventDefault
```

同类测试 `drop` / `dragover` 同样为 `true`。

## 实验 2：patch 后是否放行

在页面上下文注入：

```js
const raw = Event.prototype.preventDefault;
Event.prototype.preventDefault = function () {
  const t = String(this.type || '').toLowerCase();
  if (['paste','drop','dragover','dragenter','beforeinput'].includes(t)) return;
  return raw.apply(this, arguments);
};
```

结果：

| 事件 | patch 前 `defaultPrevented` | patch 后 |
| --- | --- | --- |
| `paste` | `true` | `false` |
| `drop` | `true` | `false` |
| `dragover` | `true` | `false` |

## 实验 3：真实按键 `Ctrl+V`（不是 `insertText`）

用 CDP `Input.dispatchKeyEvent` 派发**可信**按键事件（`rawKeyDown` + `char` + `keyUp`，`modifiers=2` 即 Ctrl），先 `Page.bringToFront` 并把焦点放到编辑器，剪贴板预置一段英文。

```
focus:      { focused: true, val_len: 0 }
after paste:{ val_len: 202, head: "Family meals matter a lot in China. People treat a shared di" }
toasts:     [{ txt: "该作业不允许复制粘贴", hidden: "none" }]
```

- 文本成功写入（0 → 202 字符）
- 站点仍然弹了提示，但被脚本设为 `display:none`（`hidden: "none"`）
- 折叠态（面板收起成小胶囊）下同样有效

## 实验 4：React 受控 state 是否吃到内容

只改 DOM 不改 state 的话，任何重渲染都会把值回写成空。所以直接从 fiber 里读 state：

```js
const ta = document.querySelector('textarea[placeholder*="撰写"]');
const fk = Object.keys(ta).find(k => k.startsWith('__reactFiber$'));
let fiber = ta[fk], found = [];
while (fiber) {
  let hook = fiber.memoizedState;
  while (hook) {
    if (typeof hook.memoizedState === 'string' && hook.memoizedState.length > 20)
      found.push({ len: hook.memoizedState.length, head: hook.memoizedState.slice(0, 40) });
    hook = hook.next;
  }
  fiber = fiber.return;
}
```

结果：

```json
{ "dom_len": 202,
  "react_state_strings": [{ "len": 202, "head": "Family meals matter a lot in China. People treat a shared di" }],
  "has_onPaste": true, "has_onChange": true }
```

→ React state 里的正文字符串长度与 DOM 一致，**提交时 `article` 字段会带上内容**，不存在"只改了显示"的问题。

进一步佐证：期间触发过一次整页 `reload()`，正文内容由站点自动恢复（说明内容进入了站点的保存链路）。

## 实验 5：面板词数与站点口径

同一状态下：

| 来源 | 数值 |
| --- | --- |
| 站点页脚「字数」 | 41 |
| 面板统计 | `41 词 / 202 字符` |

口径一致（按空白分词）。

## 实验 6：提示静音

| 检查 | 结果 |
| --- | --- |
| `document.querySelectorAll('.ant-message-notice')` | 1 条：「该作业不允许复制粘贴」 |
| 该节点 `style.display` | `none` |

## 复现脚本

验证用的最小 CDP 驱动（Node 22+，使用内置 `WebSocket`）：

```js
// 连接 9222，取第一个 iwrite 页面 target
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = list.find(t => t.type === 'page' && /iwrite\.unipus\.cn/.test(t.url));
const ws = new WebSocket(target.webSocketDebuggerUrl);
```

随后 `Runtime.evaluate`（`awaitPromise: true, userGesture: true`）执行上面的探测片段，`Input.dispatchKeyEvent` 派发真实按键，`Page.captureScreenshot` 截图。

## 结论

| 结论项 | 状态 |
| --- | --- |
| 粘贴限制位于 React 合成事件的 `preventDefault` | 已证实 |
| 原型层放行可恢复浏览器默认粘贴 | 已证实（真实按键） |
| 内容进入 React 受控 state，可正常保存/提交 | 已证实 |
| 站点提示可静音 | 已证实 |
| 不修改网络请求 / 响应 | 设计如此，未做任何拦截 |