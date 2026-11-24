// ==UserScript==
// @name         iWrite 写作助手 · 粘贴解锁 Pro
// @namespace    https://github.com/Phiedeir/iwrite-paste-unlock
// @version      2.0.0
// @description  适配 iWrite 新版写作页（Umi + antd TextArea）：解除「该作业不允许复制粘贴 / 不允许拖入内容」限制，并提供与新界面风格一致的悬浮工具面板。
// @author       Phiedeir
// @homepageURL  https://github.com/Phiedeir/iwrite-paste-unlock
// @supportURL   https://github.com/Phiedeir/iwrite-paste-unlock/issues
// @match        https://iwrite.unipus.cn/*
// @run-at       document-start
// @grant        none
// @license      GPL-3.0
// ==/UserScript==

/*
 * 原理（针对 2025/2026 新版前端）：
 *   新版写作页编辑器是 antd <TextArea>，限制逻辑写在 React 的合成事件里：
 *     onPaste:     e => { ht && (e.preventDefault(), message.warning('该作业不允许复制粘贴')) }
 *     onDrop:      e => { ht && (e.preventDefault(), message.warning('该作业不允许拖入内容')) }
 *     onDragOver:  e => { ht && e.preventDefault() }
 *   其中 ht = task.copy === 0（服务端下发）。
 *
 *   因此最稳的绕过不是去改那个闭包变量，而是在事件原型上放行这几类事件的
 *   preventDefault —— 浏览器恢复默认行为，文本照常插入，React 的 onChange
 *   随后收到 input 事件、受控 state 正常更新（已在真机验证）。
 *
 *   旧版（UEditor）页面同时保留 beforepaste 兼容处理。
 */

(function () {
  'use strict';

  if (window.__IW_WRITE_PRO__) return;
  window.__IW_WRITE_PRO__ = true;

  /* ------------------------------------------------------------------ *
   * 0. 偏好
   * ------------------------------------------------------------------ */
  const LS_KEY = 'iwrite.pro.prefs.v1';
  const DEFAULTS = { guard: true, mute: true, collapsed: true, x: null, y: null };
  const prefs = Object.assign({}, DEFAULTS, readPrefs());
  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch {}
  }

  /* ------------------------------------------------------------------ *
   * 1. 事件层：放行粘贴 / 拖拽
   * ------------------------------------------------------------------ */
  const ALLOW_TYPES = new Set(['paste', 'drop', 'dragover', 'dragenter', 'beforeinput']);
  const RAW_PREVENT_DEFAULT = Event.prototype.preventDefault;

  function enableGuard() {
    if (Event.prototype.preventDefault && Event.prototype.preventDefault.__iwp) return;
    const patched = function () {
      const t = String(this && this.type || '').toLowerCase();
      if (ALLOW_TYPES.has(t)) return;          // 放行：不阻止默认行为
      return RAW_PREVENT_DEFAULT.apply(this, arguments);
    };
    patched.__iwp = true;
    patched.__iwpRaw = RAW_PREVENT_DEFAULT;
    try { Event.prototype.preventDefault = patched; } catch {}
  }

  function disableGuard() {
    const cur = Event.prototype.preventDefault;
    if (cur && cur.__iwp && cur.__iwpRaw) {
      try { Event.prototype.preventDefault = cur.__iwpRaw; } catch {}
    }
  }

  // document-start 立刻上保护
  if (prefs.guard) enableGuard();

  /* ------------------------------------------------------------------ *
   * 2. 旧版 UEditor 兼容（toSubmitTask 页面）
   * ------------------------------------------------------------------ */
  function legacyUEditorHook() {
    const tryHook = () => {
      const UE = window.UE;
      if (!UE || typeof UE.getEditor !== 'function') return false;
      try {
        const ed = UE.getEditor('editor');
        if (ed && ed.addListener) ed.addListener('beforepaste', () => true);
        return true;
      } catch { return false; }
    };
    if (tryHook()) return;
    let n = 0;
    const t = setInterval(() => { if (tryHook() || ++n > 40) clearInterval(t); }, 500);
  }

  /* ------------------------------------------------------------------ *
   * 3. 提示静音：「该作业不允许复制粘贴 / 拖入内容」
   * ------------------------------------------------------------------ */
  const TOAST_RE = /不允许复制粘贴|不允许拖入内容/;

  function muteToasts(root) {
    const nodes = root.querySelectorAll
      ? root.querySelectorAll('.ant-message-notice, .ant-message, .ant-notification-notice')
      : [];
    nodes.forEach((n) => {
      if (TOAST_RE.test(n.textContent || '')) {
        n.style.display = 'none';
        n.dataset.iwpMuted = '1';
      }
    });
  }

  function startToastMute() {
    if (!prefs.mute || !document.documentElement) return;
    muteToasts(document);
    const mo = new MutationObserver((muts) => {
      if (!prefs.mute) return;
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (TOAST_RE.test(n.textContent || '')) {
            const box = (n.closest && n.closest('.ant-message-notice')) || n;
            box.style.display = 'none';
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ *
   * 4. 编辑器定位
   * ------------------------------------------------------------------ */
  const EDITOR_SELECTORS = [
    'textarea[placeholder*="撰写"]',
    'textarea[placeholder*="作文"]',
    'textarea[class*="editorWrap"]',
    '.editorWrap textarea',
    'textarea.ant-input-borderless',
    'textarea.ant-input',
  ];

  function findEditor() {
    for (const sel of EDITOR_SELECTORS) {
      const list = document.querySelectorAll(sel);
      for (const el of list) {
        if (el.offsetParent === null) continue;          // 不可见
        if (/撰写|作文/.test(el.placeholder || '')) return el;
      }
    }
    // 兜底：可见 textarea 中 rows/尺寸最大的那个（排除 antd 的隐藏测量框）
    const cands = [...document.querySelectorAll('textarea')].filter(
      (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 80
    );
    cands.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
    return cands[0] || null;
  }

  /* ------------------------------------------------------------------ *
   * 5. 写入受控组件（React）
   * ------------------------------------------------------------------ */
  const NATIVE_VALUE_SET = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

  function writeValue(ta, next, caret) {
    NATIVE_VALUE_SET.call(ta, next);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof caret === 'number') {
      try { ta.focus(); ta.setSelectionRange(caret, caret); } catch {}
    }
    syncStat();
  }

  function insertAtCaret(ta, text) {
    const cur = ta.value || '';
    const start = typeof ta.selectionStart === 'number' ? ta.selectionStart : cur.length;
    const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : cur.length;
    const next = cur.slice(0, start) + text + cur.slice(end);
    writeValue(ta, next, start + text.length);
  }

  function appendText(ta, text) {
    const cur = ta.value || '';
    const next = cur && !/\n\s*$/.test(cur) ? cur + '\n\n' + text : cur + text;
    writeValue(ta, next, next.length);
  }

  /* ------------------------------------------------------------------ *
   * 6. 字数统计（与站点口径对齐：按空白分词）
   * ------------------------------------------------------------------ */
  function countWords(text) {
    const t = (text || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }

  /* ------------------------------------------------------------------ *
   * 7. 面板 UI
   * ------------------------------------------------------------------ */
  const CSS = `
  .iwp-root{position:fixed;z-index:2147483000;font-family:inherit;font-size:13px;color:#1f2a37;
    background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(16,24,40,.16),0 2px 6px rgba(16,24,40,.08);
    border:1px solid rgba(62,128,240,.14);width:250px;overflow:hidden;user-select:none;
    transition:box-shadow .18s ease}
  .iwp-root.iwp-dragging{box-shadow:0 16px 40px rgba(16,24,40,.22)}
  .iwp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:move;
    background:linear-gradient(180deg,#f7faff,#f2f6ff);border-bottom:1px solid #eaf0fd}
  .iwp-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.16);flex:none}
  .iwp-root.iwp-off .iwp-dot{background:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.16)}
  .iwp-title{font-weight:600;letter-spacing:.2px;flex:1}
  .iwp-badge{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(34,197,94,.12);color:#15803d;font-weight:600}
  .iwp-root.iwp-off .iwp-badge{background:rgba(148,163,184,.16);color:#64748b}
  .iwp-fold{border:0;background:transparent;cursor:pointer;color:#64748b;font-size:14px;line-height:1;padding:2px 4px;border-radius:6px}
  .iwp-fold:hover{background:rgba(62,128,240,.1);color:#3E80F0}
  .iwp-body{padding:10px 12px 12px}
  .iwp-stat{display:flex;align-items:baseline;gap:6px;margin-bottom:10px;color:#475569}
  .iwp-stat b{font-size:18px;color:#3E80F0;font-variant-numeric:tabular-nums}
  .iwp-stat i{font-style:normal;font-variant-numeric:tabular-nums}
  .iwp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .iwp-btn{border:1px solid #dbe4f5;background:#fff;color:#334155;border-radius:9px;padding:7px 8px;
    font-size:12.5px;cursor:pointer;transition:all .15s ease;font-family:inherit}
  .iwp-btn:hover{border-color:#3E80F0;color:#3E80F0;background:#f5f9ff}
  .iwp-btn:active{transform:translateY(1px)}
  .iwp-btn.iwp-primary{background:#3E80F0;border-color:#3E80F0;color:#fff}
  .iwp-btn.iwp-primary:hover{background:#2f6ede;color:#fff}
  .iwp-switch{display:flex;gap:12px;margin-top:10px;color:#475569;font-size:12px}
  .iwp-switch label{display:flex;align-items:center;gap:5px;cursor:pointer}
  .iwp-switch input{accent-color:#3E80F0;cursor:pointer}
  .iwp-tip{margin-top:9px;padding-top:8px;border-top:1px dashed #e6ecf7;color:#94a3b8;font-size:11px;line-height:1.5}
  .iwp-root.iwp-collapsed{width:auto}
  .iwp-root.iwp-collapsed .iwp-body{display:none}
  .iwp-root.iwp-collapsed .iwp-badge{display:none}
  .iwp-toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);background:#1f2a37;color:#fff;
    padding:9px 14px;border-radius:10px;font-size:12.5px;z-index:2147483001;box-shadow:0 8px 24px rgba(0,0,0,.22);
    opacity:0;transition:opacity .2s ease;pointer-events:none}
  .iwp-toast.iwp-show{opacity:1}
  `;

  let root = null, statEl = null, badgeEl = null, editor = null, toastEl = null, boundEditor = null;

  function injectStyle() {
    if (document.getElementById('iwp-style')) return;
    const s = document.createElement('style');
    s.id = 'iwp-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'iwp-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('iwp-show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('iwp-show'), 1800);
  }

  function buildUI() {
    injectStyle();
    if (root) return;

    root = document.createElement('div');
    root.className = 'iwp-root' + (prefs.collapsed ? ' iwp-collapsed' : '');
    root.innerHTML = `
      <div class="iwp-head">
        <span class="iwp-dot"></span>
        <span class="iwp-title">写作助手</span>
        <span class="iwp-badge">已解除</span>
        <button class="iwp-fold" title="收起 / 展开">${prefs.collapsed ? '+' : '–'}</button>
      </div>
      <div class="iwp-body">
        <div class="iwp-stat"><b data-iwp-words>0</b><span>词</span><i data-iwp-chars>0</i><span>字符</span></div>
        <div class="iwp-grid">
          <button class="iwp-btn iwp-primary" data-act="paste">粘贴到光标</button>
          <button class="iwp-btn" data-act="append">追加到末尾</button>
          <button class="iwp-btn" data-act="copy">复制全文</button>
          <button class="iwp-btn" data-act="clear">清空正文</button>
        </div>
        <div class="iwp-switch">
          <label><input type="checkbox" data-act="guard"> 解除限制</label>
          <label><input type="checkbox" data-act="mute"> 静音提示</label>
        </div>
        <div class="iwp-tip">Ctrl+Shift+V 强制粘贴 · Ctrl+Shift+U 收起面板</div>
      </div>`;
    document.body.appendChild(root);

    statEl = root.querySelector('[data-iwp-words]');
    badgeEl = root.querySelector('.iwp-badge');

    root.querySelector('[data-act="guard"]').checked = !!prefs.guard;
    root.querySelector('[data-act="mute"]').checked = !!prefs.mute;
    applyState();

    // 位置
    if (prefs.x != null && prefs.y != null) {
      root.style.left = prefs.x + 'px';
      root.style.top = prefs.y + 'px';
    } else {
      root.style.right = '20px';
      root.style.bottom = '160px';
    }

    // 事件
    root.querySelector('.iwp-fold').addEventListener('click', () => {
      prefs.collapsed = !prefs.collapsed;
      root.classList.toggle('iwp-collapsed', prefs.collapsed);
      root.querySelector('.iwp-fold').textContent = prefs.collapsed ? '+' : '–';
      savePrefs();
    });

    root.querySelectorAll('.iwp-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(btn.dataset.act));
    });

    root.querySelector('[data-act="guard"]').addEventListener('change', (e) => {
      prefs.guard = e.target.checked;
      savePrefs();
      prefs.guard ? enableGuard() : disableGuard();
      applyState();
      toast(prefs.guard ? '已解除粘贴限制' : '已恢复站点原始限制');
    });

    root.querySelector('[data-act="mute"]').addEventListener('change', (e) => {
      prefs.mute = e.target.checked;
      savePrefs();
      toast(prefs.mute ? '已静音站点提示' : '站点提示已恢复');
    });

    enableDrag();
  }

  function applyState() {
    if (!root) return;
    root.classList.toggle('iwp-off', !prefs.guard);
    if (badgeEl) badgeEl.textContent = prefs.guard ? '已解除' : '原始限制';
  }

  function enableDrag() {
    const head = root.querySelector('.iwp-head');
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('.iwp-fold')) return;
      const r = root.getBoundingClientRect();
      dragging = true;
      root.classList.add('iwp-dragging');
      root.style.left = r.left + 'px';
      root.style.top = r.top + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    // 注意：上面的 preventDefault 会被我们自己的 guard 放行，这里改用直接 return 控制
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const nx = Math.max(4, Math.min(window.innerWidth - root.offsetWidth - 4, ox + e.clientX - sx));
      const ny = Math.max(4, Math.min(window.innerHeight - 40, oy + e.clientY - sy));
      root.style.left = nx + 'px';
      root.style.top = ny + 'px';
    }, true);
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('iwp-dragging');
      const r = root.getBoundingClientRect();
      prefs.x = Math.round(r.left);
      prefs.y = Math.round(r.top);
      savePrefs();
    }, true);
  }

  /* ------------------------------------------------------------------ *
   * 8. 动作
   * ------------------------------------------------------------------ */
  async function readClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      return t || '';
    } catch {
      return null;
    }
  }

  async function handleAction(act) {
    editor = findEditor();
    if (!editor && act !== 'copy') {
      toast('未找到作文输入框，请先打开写作页');
      return;
    }
    if (act === 'paste' || act === 'append') {
      const text = await readClipboard();
      if (text == null) { toast('浏览器未授权读取剪贴板，请用 Ctrl+V（限制已解除）'); return; }
      if (!text.trim()) { toast('剪贴板是空的'); return; }
      act === 'paste' ? insertAtCaret(editor, text) : appendText(editor, text);
      toast(act === 'paste' ? `已粘贴 ${text.length} 字符` : `已追加 ${text.length} 字符`);
      return;
    }
    if (act === 'copy') {
      const text = editor ? editor.value || '' : '';
      if (!text) { toast('正文为空'); return; }
      try { await navigator.clipboard.writeText(text); toast(`已复制 ${text.length} 字符`); }
      catch { toast('复制失败，请手动全选复制'); }
      return;
    }
    if (act === 'clear') {
      writeValue(editor, '');
      toast('正文已清空（可用 Ctrl+Z 撤销）');
    }
  }

  function syncStat() {
    if (!statEl) return;
    const ta = findEditor();
    const text = ta ? ta.value || '' : '';
    statEl.textContent = countWords(text);
    const chars = root && root.querySelector('[data-iwp-chars]');
    if (chars) chars.textContent = text.length;
  }

  /* ------------------------------------------------------------------ *
   * 9. 快捷键
   * ------------------------------------------------------------------ */
  function bindHotkeys() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        if (!root) buildUI();
        prefs.collapsed = !prefs.collapsed;
        root.classList.toggle('iwp-collapsed', prefs.collapsed);
        root.querySelector('.iwp-fold').textContent = prefs.collapsed ? '+' : '–';
        savePrefs();
        return;
      }
      if (mod && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        const ta = document.activeElement && document.activeElement.tagName === 'TEXTAREA'
          ? document.activeElement : findEditor();
        if (!ta) return;
        e.preventDefault();
        readClipboard().then((text) => {
          if (text == null) { toast('读取剪贴板被拒绝，请直接 Ctrl+V'); return; }
          if (!text) { toast('剪贴板是空的'); return; }
          insertAtCaret(ta, text);
          toast(`已粘贴 ${text.length} 字符`);
        });
      }
    }, true);
  }

  /* ------------------------------------------------------------------ *
   * 10. 挂载与 SPA 路由监听
   * ------------------------------------------------------------------ */
  function ensureMounted() {
    if (!document.body) return;
    const ta = findEditor();
    editor = ta;
    if (ta) {
      if (!root) buildUI();
      if (!root.isConnected) document.body.appendChild(root);
      root.style.display = '';
      // 编辑器元素在 SPA 切换/重渲染后会被替换，必须重新绑定监听
      if (ta !== boundEditor) {
        ta.addEventListener('input', syncStat);
        ta.addEventListener('keyup', syncStat);
        boundEditor = ta;
        syncStat();
      }
    } else if (root) {
      root.style.display = 'none';   // 非写作页收起
    }
  }

  function start() {
    startToastMute();
    legacyUEditorHook();
    bindHotkeys();
    ensureMounted();
    const mo = new MutationObserver(() => ensureMounted());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(ensureMounted, 1200);   // 兜底：路由切换 / 框架重渲染
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();