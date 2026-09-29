// 草图：画笔 / 箭头 / 方框 / 圆圈 / 便签钉 / 虚影 / 橡皮。画在页面上方的透明层里（页面坐标，随页面滚动），
// 贴着下面的元素走；每一笔都能写一句要求，全部可撤销；攒一批导出任务单交给 AI。
import { el, esc, uid, toast, showMenu } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { bindKey } from '../core/keys.js';
import { getViewport } from '../core/viewport.js';
import { exportTaskSheet } from './tasksheet.js';

const SVGNS = 'http://www.w3.org/2000/svg';
export const COLORS = ['#e5484d', '#f5a524', '#16a34a', '#3b82f6', '#8b5cf6', '#1f2430'];
const TYPE_NAME = { pen: '画笔', arrow: '箭头', rect: '方框', ellipse: '圆圈', note: '便签钉', ghost: '虚影移动', verdict: '修改受阻' };
const TOOLS = [
  { id: 'pen', label: '画笔', tip: '画笔：随手圈画', icon: 'pen', kbd: 'P' },
  { id: 'arrow', label: '箭头', tip: '箭头：从这里指到那里（按住 Shift 走整角度）', icon: 'arrow', kbd: 'A' },
  { id: 'rect', label: '方框', tip: '方框：框出一块区域（Shift 画正方形）', icon: 'rect', kbd: 'R' },
  { id: 'ellipse', label: '圆圈', tip: '圆圈：圈出重点（Shift 画正圆）', icon: 'ellipse', kbd: 'O' },
  { id: 'note', label: '便签钉', tip: '便签钉：点一下，写一句要求', icon: 'note', kbd: 'N' },
  { id: 'ghost', label: '虚影', tip: '虚影：把元素的影子拖到想放的位置（不改代码）', icon: 'ghost', kbd: 'G' },
  { id: 'eraser', label: '橡皮', tip: '橡皮：点或划过标记就擦掉', icon: 'eraser', kbd: 'E' },
];

export function setupSketch(app) {
  const { bus } = app;
  let color = localStorage.getItem('cd.skColor') || COLORS[0];
  let visible = true, selId = null, svg = null, htmlLayer = null, cardEl = null;
  const nodes = new Map();   // id → { g, pin, off }

  const marks = () => { const p = app.project(); if (!p) return []; if (!Array.isArray(p.marks)) p.marks = []; return p.marks; };
  const pageMarks = (ed) => marks().filter((m) => m.page === ed.page && Array.isArray(m.pts));
  const findMark = (id) => marks().find((m) => m.id === id);

  // ---------- 锚点：标记跟着下面的元素走 ----------
  function anchorFor(ed, x, y) {
    const w = ed.frame.win, doc = ed.frame.doc;
    const n = doc.elementFromPoint(x - w.scrollX, y - w.scrollY);
    const o = n && ed.frame.owner(n);
    if (!o) return null;
    const r = ed.pageRect(o);
    return { selector: ed.selectorOf(o), x0: r.x, y0: r.y, tag: o.tagName.toLowerCase(), line: (ed.frame.parsed.byLoc(ed.frame.locOf(o)) || {}).line };
  }
  function offsetOf(ed, m) {
    if (!m.anchor || !m.anchor.selector) return { dx: 0, dy: 0, drift: false };
    const p = ed.frame.parsed.bySelector(m.anchor.selector);
    const e = p && ed.frame.elByLoc(p.loc);
    if (!e) return { dx: 0, dy: 0, drift: true };
    const r = ed.pageRect(e);
    return { dx: r.x - m.anchor.x0, dy: r.y - m.anchor.y0, drift: false };
  }

  // ---------- 画出来 ----------
  const smooth = (pts) => {
    if (pts.length < 3) return 'M' + pts.map((p) => p.join(' ')).join(' L');
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const l = pts[pts.length - 1];
    return d + ` L${l[0]} ${l[1]}`;
  };
  function shapeOf(m) {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'sk-mark' + (m.done ? ' done' : ''));
    g.dataset.id = m.id;
    const sw = m.width || 3;
    const add = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); g.appendChild(n); return n; };
    const stroke = { stroke: m.color, 'stroke-width': sw, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const [a, b] = m.pts;
    if (m.type === 'pen') add('path', { d: smooth(m.pts), ...stroke });
    if (m.type === 'arrow') {
      add('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...stroke });
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = Math.max(12, sw * 4);
      const p1 = [b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45)], p2 = [b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)];
      add('path', { d: `M${p1.join(' ')} L${b.join(' ')} L${p2.join(' ')} Z`, fill: m.color, stroke: m.color, 'stroke-width': sw, 'stroke-linejoin': 'round' });
    }
    if (m.type === 'rect') add('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), rx: 4, ...stroke, fill: m.color + '10' });
    if (m.type === 'ellipse') add('ellipse', { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2, ...stroke, fill: m.color + '10' });
    if (m.type === 'ghost') {
      const [x, y, w, h] = m.box;
      add('line', { x1: x + w / 2, y1: y + h / 2, x2: x + w / 2 + (b[0] - a[0]), y2: y + h / 2 + (b[1] - a[1]), stroke: m.color, 'stroke-width': 2, 'stroke-dasharray': '6 5' });
      add('rect', { x: x + (b[0] - a[0]), y: y + (b[1] - a[1]), width: w, height: h, rx: 6, stroke: m.color, 'stroke-width': 2, 'stroke-dasharray': '7 5', fill: m.color + '14' });
    }
    // 命中用的粗透明描边
    if (m.type !== 'note' && m.type !== 'verdict') {
      const hit = g.cloneNode(true);
      hit.querySelectorAll('*').forEach((n) => { n.setAttribute('stroke', 'transparent'); n.setAttribute('stroke-width', Math.max(14, sw + 10)); n.setAttribute('fill', 'none'); });
      hit.setAttribute('class', 'sk-hit');
      g.appendChild(hit);
    }
    return g;
  }
  function pinPos(m) {
    if (m.type === 'note' || m.type === 'verdict') return m.pts[0];
    if (m.type === 'ghost') return [m.box[0] + (m.pts[1][0] - m.pts[0][0]) + m.box[2], m.box[1] + (m.pts[1][1] - m.pts[0][1])];
    const xs = m.pts.map((p) => p[0]), ys = m.pts.map((p) => p[1]);
    return [Math.max(...xs), Math.min(...ys)];
  }

  function render(ed) {
    if (!ed.ov) return;
    const host = ed.ov.skHost;
    host.innerHTML = '';
    nodes.clear();
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'sk-svg');
    htmlLayer = el('<div class="sk-html"></div>');
    host.append(svg, htmlLayer);
    host.classList.toggle('hidden', !visible);
    pageMarks(ed).forEach((m, i) => {
      const g = shapeOf(m);
      svg.appendChild(g);
      const [px, py] = pinPos(m);
      const pin = el(`<div class="sk-pin ${m.done ? 'done' : ''} ${m.type === 'verdict' ? 'auto' : ''}" data-id="${m.id}" style="left:${px}px;top:${py}px;--c:${m.color}"><b>${m.done ? '✓' : i + 1}</b>${m.text ? `<span>${esc(m.text.slice(0, 40))}</span>` : ''}</div>`);
      htmlLayer.appendChild(pin);
      nodes.set(m.id, { g, pin, off: null, m });
    });
    if (selId && !nodes.has(selId)) selId = null;
    syncSel(ed);
    tick(ed);
  }
  function tick(ed) {
    if (!ed.frame || !ed.frame.doc || !nodes.size) return;
    nodes.forEach((n) => {
      const o = offsetOf(ed, n.m);
      const key = o.dx.toFixed(1) + ',' + o.dy.toFixed(1) + o.drift;
      if (n.off === key) return;
      n.off = key;
      n.g.setAttribute('transform', `translate(${o.dx} ${o.dy})`);
      n.pin.style.translate = `${o.dx}px ${o.dy}px`;
      n.pin.classList.toggle('drift', o.drift);
      if (cardEl && cardEl.dataset.id === n.m.id) cardEl.style.translate = `${o.dx}px ${o.dy}px`;
    });
  }
  function syncSel(ed) {
    nodes.forEach((n, id) => { n.g.classList.toggle('sel', id === selId); n.pin.classList.toggle('sel', id === selId); });
    if (!selId) closeCard();
  }

  // ---------- 标记卡片：写要求 / 换颜色 / 完成 / 删除 ----------
  function closeCard() { if (cardEl) { cardEl.remove(); cardEl = null; } }
  function openCard(ed, m, focus) {
    closeCard();
    if (!htmlLayer) return;
    const [px, py] = pinPos(m);
    cardEl = el(`<div class="sk-card" data-id="${m.id}" style="left:${px + 14}px;top:${py + 10}px">
      <div class="skc-head"><i style="background:${m.color}"></i><span>${esc(TYPE_NAME[m.type] || '标记')}</span>${m.meta ? `<small>${esc(m.meta)}</small>` : ''}</div>
      <textarea class="ipt" rows="3" placeholder="写一句要求，比如：这个按钮挪到标题右边、换成品牌色">${esc(m.text || '')}</textarea>
      <div class="skc-acts">
        <div class="skc-colors">${COLORS.map((c) => `<button data-c="${c}" style="background:${c}" class="${c === m.color ? 'on' : ''}"></button>`).join('')}</div>
        <span class="grow"></span>
        <button class="icon-btn sm ${m.done ? 'on' : ''}" data-a="done" data-tip="${m.done ? '标为未完成' : '打勾完成'}">${icon('check', 15)}</button>
        <button class="icon-btn sm" data-a="del" data-tip="删除" data-kbd="Del">${icon('trash', 15)}</button>
      </div></div>`);
    htmlLayer.appendChild(cardEl);
    const ta = cardEl.querySelector('textarea');
    const save = () => { const v = ta.value.trim(); if (v !== (m.text || '')) update(m, { text: v }, '写标记要求', ed); };
    ta.addEventListener('blur', save);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ta.value = m.text || ''; ta.blur(); select(ed, null); } });
    cardEl.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => update(m, { color: b.dataset.c }, '换标记颜色', ed); });
    cardEl.querySelector('[data-a=done]').onclick = () => update(m, { done: !m.done }, m.done ? '标记改为未完成' : '标记打勾完成', ed);
    cardEl.querySelector('[data-a=del]').onclick = () => remove([m], ed);
    const n = nodes.get(m.id);
    if (n && n.off) cardEl.style.translate = n.pin.style.translate;
    if (focus) setTimeout(() => ta.focus(), 30);
  }
  function select(ed, id, focus) {
    selId = id;
    syncSel(ed);
    const m = id && findMark(id);
    if (m) { ed.clearSelection(); openCard(ed, m, focus); }
  }

  // ---------- 数据变更（全部可撤销） ----------
  async function add(m, ed, focus) {
    const list = marks();
    m.id = m.id || uid('mk');
    m.page = m.page || ed.page;
    m.createdAt = new Date().toISOString();
    m.vp = { w: getViewport().w, h: getViewport().h };
    await bus.doMeta({ label: '新增草图标记：' + (TYPE_NAME[m.type] || ''), apply: () => list.push(m), revert: () => { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); } });
    if (ed && ed.ov) { render(ed); select(ed, m.id, focus); }
    bus.emit('marks');
    return m;
  }
  async function update(m, patch, label, ed) {
    const old = {};
    Object.keys(patch).forEach((k) => { old[k] = m[k]; });
    await bus.doMeta({ label, apply: () => Object.assign(m, patch), revert: () => Object.assign(m, old) });
    const keep = selId;
    if (ed && ed.ov) { render(ed); if (keep) select(ed, keep); }
    bus.emit('marks');
  }
  async function remove(ms, ed) {
    const list = marks();
    const idx = ms.map((m) => list.indexOf(m));
    await bus.doMeta({
      label: ms.length > 1 ? `擦掉 ${ms.length} 个标记` : '删除草图标记',
      apply: () => ms.forEach((m) => { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); }),
      revert: () => ms.map((m, k) => [m, idx[k]]).sort((a, b) => a[1] - b[1]).forEach(([m, i]) => list.splice(Math.min(i, list.length), 0, m)),
    });
    selId = null;
    if (ed && ed.ov) render(ed);
    bus.emit('marks');
  }

  // ---------- 命中 ----------
  function hitAt(ed, cx, cy) {
    const t = document.elementFromPoint(cx, cy);
    const pin = t && t.closest && t.closest('.sk-pin');
    if (pin) return findMark(pin.dataset.id);
    const hitG = t && t.closest && t.closest('.sk-mark');
    return hitG ? findMark(hitG.dataset.id) : null;
  }

  // ---------- 绘制工具 ----------
  function drawTool(type) {
    return {
      ...TOOLS.find((t) => t.id === type), group: 'sketch', cls: type === 'eraser' ? 't-eraser' : type === 'note' ? 't-note' : 't-draw',
      activate: () => { visible = true; const ed = app.editor; if (ed.ov) ed.ov.skHost.classList.remove('hidden'); ed.clearSelection(); },
      down(e, ed) {
        const p0 = ed.toPage(e.clientX, e.clientY);
        const z = ed.stage.zoom;
        if (type === 'note') {
          const a = anchorFor(ed, p0.x, p0.y);
          add({ type: 'note', color, pts: [[p0.x, p0.y]], anchor: a, text: '', done: false, meta: a ? `贴在 <${a.tag}> 第 ${a.line} 行` : '' }, ed, true);
          return;
        }
        if (type === 'eraser') { erase(ed, e); return; }
        if (type === 'ghost') { ghostDrag(ed, e, p0); return; }
        const sw = Math.round((3 / z) * 10) / 10;
        const live = document.createElementNS(SVGNS, 'g');
        live.setAttribute('class', 'sk-live');
        svg.appendChild(live);
        let pts = [[p0.x, p0.y]];
        const draw = (shift) => {
          const m = { type, color, width: sw, pts: type === 'pen' ? pts : [pts[0], pts[pts.length - 1]] };
          if (shift && type !== 'pen') {
            const [a, b] = m.pts;
            if (type === 'arrow') {
              const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
              m.pts = [a, [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]];
            } else {
              const s = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
              m.pts = [a, [a[0] + s * Math.sign(b[0] - a[0] || 1), a[1] + s * Math.sign(b[1] - a[1] || 1)]];
            }
          }
          live.innerHTML = '';
          live.appendChild(shapeOf({ ...m, id: 'live' }));
          return m;
        };
        let last = null;
        const mv = (ev) => {
          const p = ed.toPage(ev.clientX, ev.clientY);
          const q = pts[pts.length - 1];
          if (type === 'pen') { if (Math.hypot(p.x - q[0], p.y - q[1]) < 1.5 / z) return; pts.push([p.x, p.y]); } else pts = [pts[0], [p.x, p.y]];
          last = draw(ev.shiftKey);
        };
        const up = () => {
          window.removeEventListener('pointermove', mv, true);
          window.removeEventListener('pointerup', up, true);
          live.remove();
          if (!last) return;
          const xs = last.pts.map((p) => p[0]), ys = last.pts.map((p) => p[1]);
          const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
          if (Math.max(w, h) * z < 6) return;
          if (type === 'pen') last.pts = simplify(last.pts, 0.7 / z).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
          const a = anchorFor(ed, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
          add({ ...last, anchor: a, text: '', done: false, meta: a ? `在 <${a.tag}> 第 ${a.line} 行附近` : '' }, ed, false);
        };
        window.addEventListener('pointermove', mv, true);
        window.addEventListener('pointerup', up, true);
      },
    };
  }
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const d2 = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], l = vx * vx + vy * vy; let t = l ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l : 0; t = Math.max(0, Math.min(1, t)); const x = a[0] + t * vx - p[0], y = a[1] + t * vy - p[1]; return x * x + y * y; };
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let idx = -1, max = eps * eps;
      for (let i = s + 1; i < e; i++) { const d = d2(pts[i], pts[s], pts[e]); if (d > max) { max = d; idx = i; } }
      if (idx > 0) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function erase(ed, e0) {
    const hit = new Set();
    const tryHit = (ev) => { const m = hitAt(ed, ev.clientX, ev.clientY); if (m && !hit.has(m)) { hit.add(m); const n = nodes.get(m.id); if (n) { n.g.style.opacity = '.2'; n.pin.style.opacity = '.2'; } } };
    tryHit(e0);
    const up = () => { window.removeEventListener('pointermove', tryHit, true); window.removeEventListener('pointerup', up, true); if (hit.size) remove([...hit], ed); };
    window.addEventListener('pointermove', tryHit, true);
    window.addEventListener('pointerup', up, true);
  }
  function ghostDrag(ed, e0, p0) {
    const n = ed.pickAt(e0.clientX, e0.clientY);
    const o = n && ed.frame.owner(n);
    if (!o) { toast('从一个具体的元素上开始拖', 'err'); return; }
    const r = ed.pageRect(o);
    const live = document.createElementNS(SVGNS, 'g');
    svg.appendChild(live);
    let p = p0;
    const mv = (ev) => {
      p = ed.toPage(ev.clientX, ev.clientY);
      live.innerHTML = '';
      live.appendChild(shapeOf({ id: 'live', type: 'ghost', color, pts: [[p0.x, p0.y], [p.x, p.y]], box: [r.x, r.y, r.w, r.h] }));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      live.remove();
      if (Math.hypot(p.x - p0.x, p.y - p0.y) * ed.stage.zoom < 6) return;
      addGhostFor(ed, o, r, p.x - p0.x, p.y - p0.y);
    };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
  }
  function addGhostFor(ed, o, r, dx, dy) {
    const info = ed.infoOf(o);
    return add({
      type: 'ghost', color, pts: [[0, 0], [Math.round(dx), Math.round(dy)]], box: [r.x, r.y, r.w, r.h],
      anchor: { selector: info.selector, x0: r.x, y0: r.y, tag: info.tag, line: info.line }, text: '', done: false,
      meta: `把 ${ed.describe(info)} 向${dx >= 0 ? '右' : '左'} ${Math.abs(Math.round(dx))}、向${dy >= 0 ? '下' : '上'} ${Math.abs(Math.round(dy))} 像素`,
    }, ed, false);
  }

  // 选择工具下：点标记 = 选中它；按住拖 = 挪动它
  function hitSelect(e, ed) {
    if (!visible) return false;
    const m = hitAt(ed, e.clientX, e.clientY);
    if (!m) { if (selId) select(ed, null); return false; }
    select(ed, m.id);
    const p0 = ed.toPage(e.clientX, e.clientY);
    const n = nodes.get(m.id);
    let d = null;
    const mv = (ev) => {
      const p = ed.toPage(ev.clientX, ev.clientY);
      d = [p.x - p0.x, p.y - p0.y];
      if (Math.hypot(d[0], d[1]) * ed.stage.zoom < 3) { d = null; return; }
      const base = (n.off || '0,0').split(',').map(parseFloat);
      n.g.setAttribute('transform', `translate(${base[0] + d[0]} ${base[1] + d[1]})`);
      n.pin.style.translate = `${base[0] + d[0]}px ${base[1] + d[1]}px`;
      closeCard();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      if (!d) return;
      // 虚影只挪"目标位置"，其它标记整体平移
      const pts = m.type === 'ghost'
        ? [m.pts[0], [m.pts[1][0] + d[0], m.pts[1][1] + d[1]]]
        : m.pts.map((q) => [q[0] + d[0], q[1] + d[1]]);
      update(m, { pts }, '挪动草图标记', ed);
    };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
    return true;
  }
  function hitContext(e, ed) {
    const m = hitAt(ed, e.clientX, e.clientY);
    if (!m) return false;
    select(ed, m.id);
    showMenu([
      { title: TYPE_NAME[m.type] || '标记' },
      { label: '写要求', icon: 'edit', onClick: () => select(ed, m.id, true) },
      { label: m.done ? '标为未完成' : '打勾完成', icon: 'check', onClick: () => update(m, { done: !m.done }, '标记打勾', ed) },
      '-',
      { label: '删除', icon: 'trash', kbd: 'Del', danger: true, onClick: () => remove([m], ed) },
    ], e.clientX, e.clientY);
    return true;
  }

  // ---------- 对外 ----------
  app.sketch = {
    tick: (ed) => tick(ed),
    hitSelect, hitContext,
    addGhost: (info, dx, dy) => { const ed = app.editor; const r = ed.pageRect(info.element); addGhostFor(ed, info.element, r, dx, dy); },
    markFromVerdict: (res, extra = {}) => {
      const ed = app.editor;
      const info = ed.selection;
      const r = info ? ed.pageRect(info.element) : { x: ed.frame.win.scrollX + 40, y: ed.frame.win.scrollY + 40 };
      add({ type: 'verdict', color: '#e5484d', pts: [[r.x, r.y]], auto: true, text: '', done: false,
        anchor: info && !info.generated ? { selector: info.selector, x0: r.x, y0: r.y, tag: info.tag, line: info.line } : null,
        meta: `${extra.label || '修改'}受阻：${String(res.reason || '').slice(0, 60)}` }, ed, true);
    },
    markElement: (info) => {
      const ed = app.editor;
      const r = ed.pageRect(info.element);
      add({ type: 'note', color, pts: [[r.x + r.w, r.y]], text: '', done: false,
        anchor: info.generated ? null : { selector: info.selector, x0: r.x, y0: r.y, tag: info.tag, line: info.line },
        meta: ed.describe(info) }, ed, true);
    },
    addRaw: (m) => add(m, null, false),
    focusMark: (m) => { const ed = app.editor; if (!ed.frame) return; const [x, y] = pinPos(m); ed.frame.win.scrollTo({ top: Math.max(0, y - 200), behavior: 'smooth' }); select(ed, m.id); },
    dockTail(ed) {
      const box = el(`<div style="display:flex;align-items:center;gap:2px">
        <div class="dock-colors" data-colors>${COLORS.map((c) => `<button data-c="${c}" style="background:${c};color:${c}" data-tip="笔的颜色"></button>`).join('')}</div>
        <button class="icon-btn" data-vis data-tip="显示 / 隐藏标记" data-tip-place="top">${icon('eye', 18)}</button>
        <button class="dock-toggle" data-sheet data-tip="把所有标记整理成任务单，复制给任何 AI" data-tip-place="top">${icon('copy', 15)}任务单</button></div>`);
      box.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { color = b.dataset.c; localStorage.setItem('cd.skColor', color); app.sketch.syncDock(ed, box.parentElement); }; });
      box.querySelector('[data-vis]').onclick = () => { visible = !visible; if (ed.ov) ed.ov.skHost.classList.toggle('hidden', !visible); app.sketch.syncDock(ed, box.parentElement); };
      box.querySelector('[data-sheet]').onclick = () => exportTaskSheet(app);
      return box;
    },
    syncDock(ed, dock) {
      if (!dock) return;
      const sk = ed.tools.get(ed.tool) && ed.tools.get(ed.tool).group === 'sketch';
      const cs = dock.querySelector('[data-colors]');
      if (cs) { cs.style.display = sk && ed.tool !== 'eraser' ? 'flex' : 'none'; cs.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === color)); }
      const v = dock.querySelector('[data-vis]');
      if (v) { v.innerHTML = icon(visible ? 'eye' : 'eyeOff', 18); v.classList.toggle('on', !visible); }
    },
  };

  TOOLS.forEach((t) => {
    app.editor.registerTool(drawTool(t.id));
    bindKey(t.kbd, { label: t.label, group: '草图', when: () => app.state.view === 'edit' && !app.editor.textEditing, run: () => app.editor.setTool(t.id) });
  });
  bindKey(['Delete', 'Backspace'], { hidden: true, priority: 5, when: () => app.state.view === 'edit' && !!selId, run: () => { const m = findMark(selId); if (m) remove([m], app.editor); } });
  bindKey('Esc', { hidden: true, priority: 5, when: () => app.state.view === 'edit' && !!selId, run: () => select(app.editor, null) });
  bus.on('rendered', () => render(app.editor));
  bus.on('page', () => { selId = null; render(app.editor); });

  // ---------- 左侧面板：全部标记 ----------
  bus.registerPanel({
    id: 'marks', title: '草图标记', icon: 'marks', views: ['edit', 'overview'],
    badge: () => marks().filter((m) => !m.done).length,
    render(host) {
      const paint = () => {
        const list = marks();
        const proj = app.project();
        host.innerHTML = '';
        const bar = el(`<div class="p-sec"><div class="p-actions">
          <button class="btn small primary" data-sheet>${icon('copy', 14)}导出任务单（${list.filter((m) => !m.done).length}）</button></div>
          <div class="hint" style="margin-top:8px">用底部工具坞里的画笔、箭头、方框、便签钉在页面上画；每个标记都可以写一句要求。修改遇到红灯也会自动记到这里。</div></div>`);
        bar.querySelector('[data-sheet]').onclick = () => exportTaskSheet(app);
        host.appendChild(bar);
        if (!list.length) { host.appendChild(el('<div class="empty">还没有标记</div>')); return; }
        proj.pages.forEach((pg) => {
          const ms = list.filter((m) => m.page === pg.file);
          if (!ms.length) return;
          host.appendChild(el(`<div class="p-sec-title" style="padding:12px 14px 4px;margin:0">${esc(pg.title)}</div>`));
          ms.forEach((m, i) => {
            const row = el(`<div class="list-row ${m.done ? 'done' : ''}"><span class="sk-dot" style="background:${m.color || '#e5484d'}">${i + 1}</span>
              <div class="grow"><div class="t1">${esc(m.text || '（还没写要求）')}</div><div class="t2">${esc(TYPE_NAME[m.type] || m.type)}${m.meta ? ' · ' + esc(m.meta) : ''}</div></div>
              <input type="checkbox" ${m.done ? 'checked' : ''} data-tip="打勾完成"></div>`);
            row.querySelector('input').onclick = (e) => { e.stopPropagation(); update(m, { done: e.target.checked }, '标记打勾', app.view() === 'edit' ? app.editor : null); };
            row.onclick = async () => {
              if (app.view() !== 'edit' || app.state.page !== m.page) await app.openPage(m.page);
              setTimeout(() => app.sketch.focusMark(m), 120);
            };
            host.appendChild(row);
          });
        });
      };
      paint();
      this._off = bus.on('marks', () => host.isConnected && paint());
    },
    onHide() { if (this._off) this._off(); },
  });
}
