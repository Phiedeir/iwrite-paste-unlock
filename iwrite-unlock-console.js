/* iWrite 粘贴解锁 —— 控制台临时版
 * 用法：在 https://iwrite.unipus.cn/student/daily/write 页面按 F12，
 *       切到 Console，把下面整段粘进去回车。刷新页面后失效，需重跑。
 * 长期使用请装 iwrite-paste-unlock-pro.user.js（Tampermonkey）。
 */
(() => {
  const ALLOW = new Set(['paste', 'drop', 'dragover', 'dragenter']);
  const raw = Event.prototype.preventDefault;
  if (!Event.prototype.preventDefault.__iwp) {
    const patched = function () {
      const t = String((this && this.type) || '').toLowerCase();
      if (ALLOW.has(t)) return;              // 放行粘贴/拖拽的默认行为
      return raw.apply(this, arguments);
    };
    patched.__iwp = 1;
    patched.__iwpRaw = raw;
    Event.prototype.preventDefault = patched;
  }
  // 静音站点提示
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && /不允许复制粘贴|不允许拖入内容/.test(n.textContent || '')) {
        const box = (n.closest && n.closest('.ant-message-notice')) || n;
        box.style.display = 'none';
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  console.log('%c iWrite 粘贴限制已解除 —— 现在可以直接 Ctrl+V', 'color:#3E80F0;font-weight:bold;font-size:13px');
})();