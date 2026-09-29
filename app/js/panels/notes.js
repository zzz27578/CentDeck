// 便签：贴在元素上的"一次性任务"或"长期规则"（第二步起 AI 改这一块前必须先读规则）
import { el, esc, uid, toast, openModal } from '../core/ui.js';

export function setupNotes(app) {
  const { bus } = app;
  const notes = () => { const p = app.project(); if (!Array.isArray(p.notes)) p.notes = []; return p.notes; };

  app.notes = {
    addFor(info) {
      if (!info || info.generated) { toast('先选中一个代码里存在的元素', 'err'); return; }
      let kind = 'task';
      const body = el(`<div>
        <div class="seg" style="width:100%;margin-bottom:12px"><button data-k="task" class="on" style="flex:1">一次性任务 · 改完打勾</button><button data-k="rule" style="flex:1">长期规则 · 一直有效</button></div>
        <textarea class="ipt" rows="3" placeholder="比如：这里保持简洁，不要加图标"></textarea>
        <div class="hint" style="margin-top:8px">贴在 ${esc(app.editor.describe(info))}</div></div>`);
      body.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { kind = b.dataset.k; body.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); }; });
      const ta = body.querySelector('textarea');
      openModal({
        title: '贴便签', width: 460, body,
        actions: [{ label: '取消' }, { label: '贴上', kind: 'primary', onClick: async (close) => {
          const text = ta.value.trim();
          if (!text) { ta.focus(); return; }
          const n = { id: uid('nt'), page: app.state.page, selector: info.selector, kind, text, done: false, createdAt: new Date().toISOString() };
          const list = notes();
          await bus.doMeta({ label: kind === 'rule' ? '新增长期规则' : '新增任务便签', apply: () => list.push(n), revert: () => { const i = list.indexOf(n); if (i >= 0) list.splice(i, 1); } });
          bus.emit('notes');
          toast(kind === 'rule' ? '长期规则已贴上' : '任务便签已贴上', 'ok');
          close();
        } }],
      });
      setTimeout(() => ta.focus(), 50);
    },
  };

  bus.registerPanel({
    id: 'notes', title: '便签', icon: 'sticky', views: ['edit', 'overview'],
    badge: () => notes().filter((n) => !n.done && n.kind === 'task').length,
    render(host) {
      let tab = 'all';
      const paint = () => {
        const list = notes(), proj = app.project();
        host.innerHTML = '';
        const tabs = el(`<div class="p-sec"><div class="seg" style="width:100%">
          <button data-t="all" style="flex:1">全部 ${list.length}</button><button data-t="task" style="flex:1">任务 ${list.filter((n) => n.kind === 'task').length}</button><button data-t="rule" style="flex:1">规则 ${list.filter((n) => n.kind === 'rule').length}</button></div>
          <div class="hint" style="margin-top:8px">右键页面元素 →"贴便签"。长期规则以后会被每个 AI 先读。</div></div>`);
        tabs.querySelectorAll('[data-t]').forEach((b) => { b.classList.toggle('on', b.dataset.t === tab); b.onclick = () => { tab = b.dataset.t; paint(); }; });
        host.appendChild(tabs);
        const shown = list.filter((n) => tab === 'all' || n.kind === tab);
        if (!shown.length) { host.appendChild(el('<div class="empty">这一类还没有便签</div>')); return; }
        shown.forEach((n) => {
          const pg = (proj.pages.find((p) => p.file === n.page) || {}).title || n.page;
          const row = el(`<div class="list-row ${n.done ? 'done' : ''}"><span class="chip ${n.kind === 'rule' ? 'blue' : 'yellow'}">${n.kind === 'rule' ? '规则' : '任务'}</span>
            <div class="grow"><div class="t1">${esc(n.text)}</div><div class="t2">${esc(pg)} · ${esc((n.selector || '').split(' > ').pop().replace(/:nth-of-type\((\d+)\)/, '[$1]'))}</div></div>
            <input type="checkbox" ${n.done ? 'checked' : ''} data-tip="完成"><button class="icon-btn sm" data-del data-tip="删除">×</button></div>`);
          row.querySelector('input').onclick = async (e) => { e.stopPropagation(); const v = e.target.checked; await bus.doMeta({ label: '便签打勾', apply: () => { n.done = v; }, revert: () => { n.done = !v; } }); paint(); };
          row.querySelector('[data-del]').onclick = async (e) => {
            e.stopPropagation();
            const i = list.indexOf(n);
            await bus.doMeta({ label: '删除便签', apply: () => { const j = list.indexOf(n); if (j >= 0) list.splice(j, 1); }, revert: () => list.splice(Math.min(i, list.length), 0, n) });
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
