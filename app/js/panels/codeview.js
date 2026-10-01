/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 源码：只读查看当前页代码（带行号），选中元素时高亮它所在的行
import { el, esc, toast, copyText } from '../core/ui.js';
import { icon } from '../core/icons.js';

export function setupCodeview(app) {
  app.bus.registerPanel({
    id: 'codeview', title: i18nText('源码'), icon: 'code', views: ['edit'],
    render(host) {
      host.parentElement.parentElement.style.setProperty('--drawer-w', '420px');
      const paint = () => {
        const ed = app.editor;
        if (!ed.frame) { host.innerHTML = i18nText('<div class="empty">打开一页后这里显示它的代码</div>'); return; }
        const src = ed.frame.source, sel = ed.selection;
        const a = sel && !sel.generated ? sel.line : -1, b = sel && !sel.generated ? sel.endLine : -1;
        host.innerHTML = '';
        const bar = el(i18nTpl`<div class="p-sec" style="display:flex;gap:6px;align-items:center"><button class="btn small">${icon('copy', 14)}复制整页代码</button><span class="hint">只读；直接改代码留给第三步的代码插件</span></div>`);
        bar.querySelector('button').onclick = async () => { const ok = await copyText(src); toast(ok ? i18nText('已复制') : i18nText('复制失败'), ok ? 'ok' : 'err'); };
        host.appendChild(bar);
        const pre = el('<pre class="code-view"></pre>');
        pre.innerHTML = src.split('\n').map((l, i) => `<div class="cv ${i + 1 >= a && i + 1 <= b ? 'on' : ''}"><i>${i + 1}</i><span>${esc(l) || ' '}</span></div>`).join('');
        host.appendChild(pre);
        const on = pre.querySelector('.cv.on');
        if (on) on.scrollIntoView({ block: 'center' });
      };
      paint();
      this._a = app.bus.on('select', () => host.isConnected && paint());
      this._b = app.bus.on('rendered', () => host.isConnected && paint());
    },
    onHide() {
      const d = document.getElementById('drawer');
      if (d) d.style.removeProperty('--drawer-w');
      if (this._a) this._a(); if (this._b) this._b();
    },
  });
}
