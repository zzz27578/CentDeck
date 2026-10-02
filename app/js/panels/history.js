/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 版本历史：每次写回代码前服务端自动留一份旧版本（最多 20 份），可一键恢复
import { el, esc, fmtTime, confirmDlg, toast } from '../core/ui.js';

export function setupHistory(app) {
  app.bus.registerPanel({
    id: 'history', title: i18nText('版本历史'), icon: 'history', views: ['edit', 'overview'],
    async render(host) {
      host.innerHTML = i18nText('<div class="empty">读取中…</div>');
      let list = [];
      try { list = await app.api.listHistory(app.project().id); } catch { host.innerHTML = i18nText('<div class="empty">读取失败</div>'); return; }
      host.innerHTML = i18nText('<div class="p-sec"><div class="hint">每次改动写进代码之前，旧版本都会自动存在这里（最多 20 份）。撤销用 Ctrl+Z 更快；这里适合回到很久以前的样子。</div></div>');
      if (!list.length) { host.appendChild(el(i18nText('<div class="empty">还没有历史版本</div>'))); return; }
      const titleOf = (f) => (app.project().pages.find((p) => p.file === f) || {}).title || f;
      list.forEach((h) => {
        const row = el(i18nTpl`<div class="list-row"><div class="grow"><div class="t1">${esc(fmtTime(h.time))} · ${esc(titleOf(h.file))}</div><div class="t2">${esc(h.file)}</div></div><button class="btn small">恢复</button></div>`);
        row.querySelector('button').onclick = async () => {
          const ok = await confirmDlg({ title: i18nText('恢复历史版本'), okLabel: i18nText('恢复'), body: i18nTpl`用 <b>${esc(fmtTime(h.time))}</b> 的版本覆盖 <b>${esc(titleOf(h.file))}</b>。<br>现在的内容不会丢：会先自动再存一份。` });
          if (!ok) return;
          try { await app.api.restoreHistory(app.project().id, h.hid); app.bus.clearStacks(); await app.refreshProject(); toast(i18nText('已恢复'), 'ok'); await app.reloadView(); } catch { /* api 已提示 */ }
        };
        host.appendChild(row);
      });
    },
  });
}
