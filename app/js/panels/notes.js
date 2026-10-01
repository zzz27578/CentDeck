/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 便签：贴在元素上的"一次性任务"或"长期规则"（第二步起 AI 改这一块前必须先读规则）
import { el, esc, uid, toast, openModal } from '../core/ui.js';

export function setupNotes(app) {
  const { bus } = app;
  const notes = () => { const p = app.project(); if (!Array.isArray(p.notes)) p.notes = []; return p.notes; };

  app.notes = {
    addFor(info) {
      if (!info || info.generated) { toast(i18nText('先选中一个代码里存在的元素'), 'err'); return; }
      let kind = 'rule';
      const body = el(i18nTpl`<div>
        <p class="hint">长期规则会在助手修改此元素时提供约束。临时要求请使用画布便签。</p>
        <textarea class="ipt" rows="3" placeholder="比如：这里保持简洁，不要加图标"></textarea>
        <div class="hint" style="margin-top:8px">贴在 ${esc(app.editor.describe(info))}</div></div>`);
      body.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { kind = b.dataset.k; body.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); }; });
      const ta = body.querySelector('textarea');
      openModal({
        title: i18nText('添加元素规则'), width: 460, body,
        actions: [{ label: i18nText('取消') }, { label: i18nText('贴上'), kind: 'primary', onClick: async (close) => {
          const text = ta.value.trim();
          if (!text) { ta.focus(); return; }
          const n = { id: uid('nt'), page: app.state.page, selector: info.selector, kind, text, done: false, createdAt: new Date().toISOString() };
          const list = notes();
          await bus.doMeta({ label: kind === 'rule' ? i18nText('新增长期规则') : i18nText('新增任务便签'), apply: () => list.push(n), revert: () => { const i = list.indexOf(n); if (i >= 0) list.splice(i, 1); } });
          bus.emit('notes');
          toast(kind === 'rule' ? i18nText('长期规则已贴上') : i18nText('任务便签已贴上'), 'ok');
          close();
        } }],
      });
      setTimeout(() => ta.focus(), 50);
    },
  };

  bus.registerPanel({
    id: 'notes', title: i18nText('元素规则'), icon: 'sticky', views: ['edit', 'overview'],
    badge: () => notes().filter((n) => !n.done && n.kind === 'task').length,
    render(host) {
      let tab = 'all';
      const paint = () => {
        const list = notes(), proj = app.project();
        host.innerHTML = '';
        const tabs = el(i18nTpl`<div class="p-sec"><div class="seg" style="width:100%">
          <button data-t="all" style="flex:1">全部 ${list.length}</button><button data-t="task" style="flex:1">任务 ${list.filter((n) => n.kind === 'task').length}</button><button data-t="rule" style="flex:1">规则 ${list.filter((n) => n.kind === 'rule').length}</button></div>
          <div class="hint" style="margin-top:8px">右键元素添加长期规则。历史任务便签保留在任务分类中。</div></div>`);
        tabs.querySelectorAll('[data-t]').forEach((b) => { b.classList.toggle('on', b.dataset.t === tab); b.onclick = () => { tab = b.dataset.t; paint(); }; });
        host.appendChild(tabs);
        const shown = list.filter((n) => tab === 'all' || n.kind === tab);
        if (!shown.length) { host.appendChild(el(i18nText('<div class="empty">这一类还没有便签</div>'))); return; }
        shown.forEach((n) => {
          const pg = (proj.pages.find((p) => p.file === n.page) || {}).title || n.page;
          const row = el(i18nTpl`<div class="list-row ${n.done ? 'done' : ''}"><span class="chip ${n.kind === 'rule' ? 'blue' : 'yellow'}">${n.kind === 'rule' ? i18nText('规则') : i18nText('任务')}</span>
            <div class="grow"><div class="t1">${esc(n.text)}</div><div class="t2">${esc(pg)} · ${esc((n.selector || '').split(' > ').pop().replace(/:nth-of-type\((\d+)\)/, '[$1]'))}</div></div>
            <button class="icon-btn sm" data-del aria-label="删除规则" data-tip="删除">×</button></div>`);
          row.querySelector('[data-del]').onclick = async (e) => {
            e.stopPropagation();
            const i = list.indexOf(n);
            await bus.doMeta({ label: i18nText('删除便签'), apply: () => { const j = list.indexOf(n); if (j >= 0) list.splice(j, 1); }, revert: () => list.splice(Math.min(i, list.length), 0, n) });
            paint();
          };
          row.onclick = async () => { if (app.view() !== 'edit' || app.state.page !== n.page) await app.openPage(n.page); setTimeout(() => { app.editor.select(n.selector); const s = app.editor.selection; if (s) s.element.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 150); };
          host.appendChild(row);
        });
      };
      paint();
      this._o = bus.on('notes', () => host.isConnected && paint());
    },
    onHide() { if (this._o) this._o(); },
  });
}
