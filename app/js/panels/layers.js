// 图层：按代码结构列出本页元素，点一下就在页面上选中并滚到它
import { esc } from '../core/ui.js';

const ICON = { text: '文', image: '图', control: '钮', container: '块' };

export function setupLayers(app) {
  app.bus.registerPanel({
    id: 'layers', title: '图层', icon: 'layers', views: ['edit'],
    render(host) {
      const paint = () => {
        const ed = app.editor;
        if (!ed.frame) { host.innerHTML = '<div class="empty">打开一页后这里显示它的结构</div>'; return; }
        const els = ed.frame.parsed.elements;
        const sel = ed.selection;
        const kids = new Map();
        els.forEach((e) => { const k = e.parent == null ? -1 : e.parent; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(e); });
        const rows = [];
        const walk = (k, d) => (kids.get(k) || []).forEach((e) => {
          if (e.tag === 'br' || (d > 0 && ['path', 'circle', 'rect', 'stop', 'line', 'polyline', 'g', 'defs', 'linearGradient', 'text', 'ellipse', 'textPath'].includes(e.tag))) return;
          const t = e.textOnly && e.text.trim() ? e.text.trim().slice(0, 18) : '';
          rows.push(`<div class="list-row layer ${sel && sel.loc === e.loc ? 'on' : ''}" data-loc="${e.loc}" style="padding-left:${10 + d * 13}px">
            <span class="chip" style="width:22px;justify-content:center;padding:0">${ICON[e.type] || '块'}</span>
            <div class="grow"><div class="t1">&lt;${esc(e.tag)}&gt;${e.classes && e.classes[0] ? `<span style="color:var(--dim)">.${esc(e.classes[0])}</span>` : ''} ${esc(t)}</div></div>
            <span class="t2">${e.line}</span></div>`);
          walk(e.loc, d + 1);
        });
        walk(-1, 0);
        host.innerHTML = rows.join('') || '<div class="empty">这一页没有元素</div>';
        host.querySelectorAll('[data-loc]').forEach((r) => {
          r.onclick = () => {
            const loc = +r.dataset.loc;
            ed.select(loc);
            const n = ed.frame.elByLoc(loc);
            if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
          };
        });
        const on = host.querySelector('.on');
        if (on) on.scrollIntoView({ block: 'nearest' });
      };
      paint();
      this._a = app.bus.on('select', () => host.isConnected && paint());
      this._b = app.bus.on('rendered', () => host.isConnected && paint());
    },
    onHide() { if (this._a) this._a(); if (this._b) this._b(); },
  });
}
