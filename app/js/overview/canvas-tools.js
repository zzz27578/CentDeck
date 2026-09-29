// 总览画布右侧的工具条：指针 / 框选 / 画笔 / 手
//   框选：框住页面上的一块，直接变成助手输入框里的一个引用（图标 + 页面名 + 区域）
//   画笔：在画布上随手写写画画（整块画布的批注，可撤销，右键删除）
import { icon } from '../core/icons.js';
import { el, esc, uid, toast, showMenu } from '../core/ui.js';
import { bindKey, comboFor } from '../core/keys.js';

const SVGNS = 'http://www.w3.org/2000/svg';
export const OV_TOOLS = [
  { id: 'pointer', label: '指针', tip: '指针：点选页面、拖标题摆位置', icon: 'select', kbd: 'R' },
  { id: 'marquee', label: '框选', tip: '框选：框住页面上的一块，直接引用到助手', icon: 'marquee', kbd: 'M' },
  { id: 'pen', label: '画笔', tip: '画笔：在画布上随手批注', icon: 'pen', kbd: 'D' },
  { id: 'hand', label: '手', tip: '手：拖动画布（也可以按住空格或中键）', icon: 'hand', kbd: 'H' },
];

export function createCanvasTools(app, c) {
  // c：{ host, world, cam(), toWorld(x, y), cards(), select(file), redraw() }
  let tool = 'pointer', strip = null, inkLayer = null;
  const ink = () => { const p = app.project(); if (!Array.isArray(p.canvasInk)) p.canvasInk = []; return p.canvasInk; };

  function mount(wrap) {
    strip = el(`<div class="ov-tools">${OV_TOOLS.map((t) => `<button class="icon-btn" data-t="${t.id}" data-tip="${esc(t.tip)}" data-kbd="${esc(comboFor('ov.tool.' + t.id, t.kbd))}" data-tip-place="left">${icon(t.icon, 19)}</button>`).join('')}</div>`);
    strip.onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) setTool(b.dataset.t); };
    wrap.appendChild(strip);
    inkLayer = document.createElementNS(SVGNS, 'svg');
    inkLayer.setAttribute('class', 'ov-ink');
    c.world.appendChild(inkLayer);
    paintInk();
    setTool(tool);
  }
  function setTool(t) {
    tool = t;
    if (strip) strip.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    c.host.dataset.tool = t;
  }
  function paintInk() {
    if (!inkLayer) return;
    inkLayer.innerHTML = '';
    ink().forEach((s) => {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', 'M' + s.pts.map((q) => q.join(' ')).join(' L'));
      p.setAttribute('stroke', s.color);
      p.setAttribute('stroke-width', s.width);
      p.setAttribute('class', 'ov-stroke');
      p.dataset.id = s.id;
      inkLayer.appendChild(p);
    });
  }

  // 返回 true 表示这次按下由工具处理了（卡片自己的拖动/选中不再响应）
  function down(e) {
    if (e.button !== 0) return false;
    if (tool === 'hand') return false;             // 交给画布平移
    if (tool === 'pointer') return false;
    e.preventDefault();
    e.stopPropagation();
    const a = c.toWorld(e.clientX, e.clientY);
    if (tool === 'pen') {
      const pts = [[Math.round(a.x), Math.round(a.y)]];
      const w = Math.max(2, 3 / c.cam().z);
      const live = document.createElementNS(SVGNS, 'path');
      live.setAttribute('class', 'ov-stroke');
      live.setAttribute('stroke', '#e5484d');
      live.setAttribute('stroke-width', w);
      inkLayer.appendChild(live);
      const mv = (ev) => { const p = c.toWorld(ev.clientX, ev.clientY); pts.push([Math.round(p.x), Math.round(p.y)]); live.setAttribute('d', 'M' + pts.map((q) => q.join(' ')).join(' L')); };
      const up = () => {
        window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true);
        live.remove();
        if (pts.length < 3) return;
        const s = { id: uid('ink'), pts, color: '#e5484d', width: Math.round(w * 10) / 10 };
        const list = ink();
        app.bus.doMeta({ label: '画布批注', apply: () => list.push(s), revert: () => { const i = list.indexOf(s); if (i >= 0) list.splice(i, 1); } }).then(paintInk);
      };
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', up, true);
      return true;
    }
    // 框选
    const box = el('<div class="ov-marquee"></div>');
    c.world.appendChild(box);
    let b = a;
    const mv = (ev) => {
      b = c.toWorld(ev.clientX, ev.clientY);
      Object.assign(box.style, { left: Math.min(a.x, b.x) + 'px', top: Math.min(a.y, b.y) + 'px', width: Math.abs(b.x - a.x) + 'px', height: Math.abs(b.y - a.y) + 'px' });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true);
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      box.classList.add('done');
      setTimeout(() => box.remove(), 900);
      if (r.w * c.cam().z < 8 || r.h * c.cam().z < 8) return;
      const hits = c.cards().filter((k) => r.x < k.x + k.w && r.x + r.w > k.x && r.y < k.y + k.h && r.y + r.h > k.y);
      if (!hits.length) { toast('框里没有页面', 'err'); return; }
      hits.forEach((k) => {
        const x1 = Math.max(r.x, k.x), y1 = Math.max(r.y, k.y), x2 = Math.min(r.x + r.w, k.x + k.w), y2 = Math.min(r.y + r.h, k.y + k.h);
        const s = k.scale || 1;
        app.agent.addRef({
          kind: 'region', page: k.file, popup: k.popup || null,
          title: k.popup ? `${k.title} · ${k.popup}` : k.title,
          rect: { x: Math.round((x1 - k.x) / s), y: Math.round((y1 - k.y) / s), w: Math.round((x2 - x1) / s), h: Math.round((y2 - y1) / s) },
        });
      });
      app.toggleAgent(true);
      toast(`已把 ${hits.length} 处框选放进助手输入框`, 'ok', 2200);
    };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
    return true;
  }
  function context(e) {
    const s = e.target.closest && e.target.closest('.ov-stroke');
    if (!s || !s.dataset.id) return false;
    e.preventDefault();
    const list = ink();
    const item = list.find((x) => x.id === s.dataset.id);
    showMenu([{ label: '删除这笔批注', icon: 'trash', danger: true, onClick: () => {
      const i = list.indexOf(item);
      app.bus.doMeta({ label: '删除画布批注', apply: () => list.splice(list.indexOf(item), 1), revert: () => list.splice(i, 0, item) }).then(paintInk);
    } }], e.clientX, e.clientY);
    return true;
  }
  function clearInk() {
    const list = ink(), old = list.slice();
    if (!old.length) return;
    app.bus.doMeta({ label: '清除画布批注', apply: () => list.splice(0), revert: () => list.push(...old) }).then(paintInk);
  }

  const inOv = () => app.state.view === 'overview';
  OV_TOOLS.forEach((t) => bindKey(t.kbd, { id: 'ov.tool.' + t.id, label: t.label, group: '总览', when: inOv, run: () => setTool(t.id) }));
  return { mount, setTool, down, context, clearInk, repaint: paintInk, get tool() { return tool; } };
}
