/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 草图：画笔 / 箭头 / 方框 / 圆圈 / 便签钉 / 参考图 / 橡皮。画在页面上方的透明层里（页面坐标，随页面滚动），
// 贴着下面的元素走；每一笔都能写一句要求，全部可撤销；攒一批导出任务单交给 AI。
import { el, esc, uid, toast, showMenu } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { bindKey } from '../core/keys.js';
import { getViewport } from '../core/viewport.js';
import { exportTaskSheet } from './tasksheet.js';
import { nextColorNumber, migrateColorNumbers } from '../core/note-numbers.js';

const SVGNS = 'http://www.w3.org/2000/svg';
import {COLORS,notePalette} from '../core/note-colors.js';
export {COLORS};
export const TYPE_NAME = { pen: i18nText('画笔'), arrow: i18nText('箭头'), rect: i18nText('方框'), ellipse: i18nText('圆圈'), note: i18nText('便签钉'), image: i18nText('参考图'), verdict: i18nText('修改受阻') };
const TOOLS = [
  { id: 'pen', label: i18nText('画笔'), tip: i18nText('画笔：随手圈画'), icon: 'pen', kbd: 'D' },
  { id: 'arrow', label: i18nText('箭头'), tip: i18nText('箭头：从这里指到那里（按住 Shift 走整角度）'), icon: 'arrow', kbd: 'A' },
  { id: 'rect', label: i18nText('方框'), tip: i18nText('方框：框出一块区域（Shift 画正方形）'), icon: 'rect', kbd: 'F' },
  { id: 'ellipse', label: i18nText('圆圈'), tip: i18nText('圆圈：圈出重点（Shift 画正圆）'), icon: 'ellipse', kbd: 'G' },
  { id: 'note', label: i18nText('便签钉'), tip: i18nText('便签钉：点一下，写一句要求'), icon: 'note', kbd: 'S' },
  { id: 'image', label: i18nText('插图'), tip: i18nText('插图：放一张参考图，像 Word 一样随意拖动、缩放（也可以直接粘贴或把图片拖进来）'), icon: 'image', kbd: 'I' },
  { id: 'eraser', label: i18nText('橡皮'), tip: i18nText('橡皮：点或划过标记就擦掉'), icon: 'eraser', kbd: 'X' },
];

export function setupSketch(app) {
  const { bus } = app;
  let color = localStorage.getItem('cd.skColor') || COLORS[0];
  let visible = true, selId = null, svg = null, htmlLayer = null, cardEl = null;
  const nodes = new Map();   // id → { g, pin, off }

  // 标记列表；顺手把旧版的"虚影"换成箭头、给没有编号的标记补上全局编号（@ 引用要用）
  const marks = () => {
    const p = app.project();
    if (!p) return [];
    if (!Array.isArray(p.marks)) p.marks = [];
    migrateColorNumbers(p, 'marks');
    let max = p.marks.reduce((m, x) => Math.max(m, x.no || 0), 0);
    p.marks.forEach((m) => {
      if (m.type === 'ghost' && m.box && m.pts) {
        const [x, y, w, h] = m.box, d = [m.pts[1][0] - m.pts[0][0], m.pts[1][1] - m.pts[0][1]];
        m.type = 'arrow';
        m.intent = 'move';
        m.pts = [[x + w / 2, y + h / 2], [x + w / 2 + d[0], y + h / 2 + d[1]]];
        delete m.box;
      }
      if (!m.no) m.no = ++max;
    });
    return p.marks;
  };
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
    if (m.type === 'image') {
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      add('image', { href: m.src, x, y, width: w, height: h, preserveAspectRatio: 'none' });
      add('rect', { x, y, width: w, height: h, class: 'sk-img-frame', fill: 'transparent' });
      return g;
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
    const xs = m.pts.map((p) => p[0]), ys = m.pts.map((p) => p[1]);
    if (m.type === 'image') return [Math.min(...xs), Math.min(...ys)];
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
    pageMarks(ed).forEach((m) => {
      const g = shapeOf(m);
      svg.appendChild(g);
      const [px, py] = pinPos(m);
      const pin = el(`<div class="sk-pin ${m.done ? 'done' : ''} ${m.type === 'verdict' ? 'auto' : ''}" data-id="${m.id}" style="left:${px}px;top:${py}px;--c:${m.color}"><b>${m.done ? '✓' : m.no}</b>${m.text ? `<span>${esc(m.text.slice(0, 40))}</span>` : ''}</div>`);
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
    if (htmlLayer) imageHandles(ed, selId ? findMark(selId) : null);
  }

  // ---------- 标记卡片：写要求 / 换颜色 / 完成 / 删除 ----------
  function closeCard() {
    if (cardEl) { nodes.get(cardEl.dataset.id)?.pin.classList.remove('editing'); cardEl.remove(); cardEl = null; }
  }
  function openCard(ed, m, focus) {
    closeCard();
    if (!htmlLayer) return;
    const [px, py] = pinPos(m);
    cardEl = el(i18nTpl`<div class="sk-card" data-id="${m.id}" style="left:${px}px;top:${py}px">
      <div class="skc-head"><i style="background:${m.color}"></i><span>${esc(TYPE_NAME[m.type] || i18nText('标记'))}</span>${m.meta ? `<small>${esc(m.meta)}</small>` : ''}</div>
      <textarea class="ipt" rows="3" aria-label="便签内容" placeholder="添加批注…">${esc(m.text || '')}</textarea>
      <div class="skc-acts">
        ${notePalette(m.color)}
        <span class="grow"></span>
        <button class="note-confirm" data-a="done" aria-label="保存并收起便签">${icon('check', 15)}确认</button>
        <button class="icon-btn sm" data-a="del" data-tip="删除" data-kbd="Del">${icon('trash', 15)}</button>
      </div></div>`);
    htmlLayer.appendChild(cardEl);
    nodes.get(m.id)?.pin.classList.add('editing');
    const ta = cardEl.querySelector('textarea');
    let saving=false;
    const confirm = async () => { if(saving)return;saving=true;const text=ta.value.trim();selId=null;closeCard();if(text!==m.text||m.done)await update(m, {text, done:false}, i18nText('保存便签'), ed);select(ed, null); };
    ta.addEventListener('blur', confirm);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); confirm(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); confirm(); } });
    cardEl.querySelectorAll('button').forEach(b=>b.onpointerdown=e=>e.preventDefault());
    cardEl.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => update(m, { color: b.dataset.c, text:ta.value }, i18nText('换标记颜色'), ed); });
    cardEl.querySelector('[data-a=done]').onclick = confirm;
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
    m.no = nextColorNumber(list, m.color);
    m.page = m.page || ed.page;
    m.createdAt = new Date().toISOString();
    m.vp = { w: getViewport().w, h: getViewport().h };
    await bus.doMeta({ label: i18nText('新增草图标记：') + (TYPE_NAME[m.type] || ''), apply: () => list.push(m), revert: () => { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); } });
    if (ed && ed.ov) { render(ed); select(ed, m.id, focus); }
    bus.emit('marks');
    return m;
  }
  async function update(m, patch, label, ed) {
    if (patch.color && patch.color !== m.color) patch.no = nextColorNumber(marks(), patch.color, m);
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
      label: ms.length > 1 ? i18nTpl`擦掉 ${ms.length} 个标记` : i18nText('删除草图标记'),
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
      activate: () => {
        visible = true;
        const ed = app.editor;
        if (ed.ov) ed.ov.skHost.classList.remove('hidden');
        ed.clearSelection();
        if (type === 'image') { pickImage(ed); setTimeout(() => ed.setTool('select'), 0); }
      },
      down(e, ed) {
        const p0 = ed.toPage(e.clientX, e.clientY);
        const z = ed.stage.zoom;
        if (type === 'note') {
          const a = anchorFor(ed, p0.x, p0.y);
          add({ type: 'note', color, pts: [[p0.x, p0.y]], anchor: a, text: '', done: false, meta: a ? i18nTpl`贴在 <${a.tag}> 第 ${a.line} 行` : '' }, ed, true);
          return;
        }
        if (type === 'eraser') { erase(ed, e); return; }
        if (type === 'image') { pickImage(ed); return; }
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
          add({ ...last, anchor: a, text: '', done: false, meta: a ? i18nTpl`在 <${a.tag}> 第 ${a.line} 行附近` : '' }, ed, false);
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
  // 拖出可移动范围时：画一条从原位置指向目标位置的箭头，意图交给 AI
  function addMoveArrow(ed, o, dx, dy) {
    const info = ed.infoOf(o), r = ed.pageRect(o);
    const c = [r.x + r.w / 2, r.y + r.h / 2];
    return add({
      type: 'arrow', intent: 'move', color: '#8b5cf6', width: Math.round((3 / ed.stage.zoom) * 10) / 10,
      pts: [c, [c[0] + Math.round(dx), c[1] + Math.round(dy)]],
      anchor: info.generated ? null : { selector: info.selector, x0: r.x, y0: r.y, tag: info.tag, line: info.line }, text: '', done: false,
      meta: i18nTpl`想把 ${ed.describe(info)} 挪到箭头指的位置（向${dx >= 0 ? i18nText('右') : i18nText('左')} ${Math.abs(Math.round(dx))}、向${dy >= 0 ? i18nText('下') : i18nText('上')} ${Math.abs(Math.round(dy))} 像素）`,
    }, ed, true);
  }

  // ---------- 参考图：像 Word 里的浮动图片，放在所有内容上方，可拖可缩放，不写进代码 ----------
  async function uploadImage(file) {
    const name = (file.name || 'paste.png').replace(/[^\w.一-龥-]+/g, '_');
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error(i18nText('读取图片失败'))); r.readAsDataURL(file); });
    const saved = await app.api.saveAsset(app.project().id, `ref-${Date.now().toString(36)}-${name}`, b64);
    return { asset: saved.filename, src: saved.url };
  }
  function imageSize(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth || 400, i.naturalHeight || 300]); i.onerror = () => res([400, 300]); i.src = src; });
  }
  async function addImage(ed, img, at) {
    const [nw, nh] = await imageSize(img.src);
    const w0 = ed.frame.win.innerWidth;
    const k = Math.min(1, (w0 * 0.36) / nw, 520 / nh);
    const w = Math.round(nw * k), h = Math.round(nh * k);
    const c = at || { x: ed.frame.win.scrollX + w0 / 2, y: ed.frame.win.scrollY + ed.frame.win.innerHeight / 2 };
    const pts = [[Math.round(c.x - w / 2), Math.round(c.y - h / 2)], [Math.round(c.x + w / 2), Math.round(c.y + h / 2)]];
    const a = anchorFor(ed, c.x, c.y);
    await add({ type: 'image', color: '#3b82f6', src: img.src, asset: img.asset, pts, ratio: nw / nh, anchor: a, text: '', done: false, meta: i18nTpl`参考图 assets/${img.asset}` }, ed, false);
    ed.setTool('select');
  }
  async function imageFromFiles(ed, files, at) {
    const pics = [...files].filter((f) => /^image\//.test(f.type));
    if (!pics.length) return false;
    for (const f of pics) {
      try { await addImage(ed, await uploadImage(f), at); } catch { /* 已提示 */ }
    }
    toast(i18nText('参考图已放上页面：拖动挪位置，拖角缩放；它只是草图，不会写进代码'), 'ok', 3600);
    return true;
  }
  function pickImage(ed) {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    i.multiple = true;
    i.onchange = () => imageFromFiles(ed, i.files);
    i.click();
  }
  // 选中参考图时四个角的缩放手柄（按比例缩放，和 Word 一样）
  function imageHandles(ed, m) {
    htmlLayer.querySelectorAll('.sk-ihd').forEach((n) => n.remove());
    if (!m || m.type !== 'image') return;
    const n = nodes.get(m.id);
    const [a, b] = m.pts;
    [['nw', a[0], a[1]], ['ne', b[0], a[1]], ['sw', a[0], b[1]], ['se', b[0], b[1]]].forEach(([k, x, y]) => {
      const h = el(`<i class="sk-ihd ${k}" style="left:${x}px;top:${y}px"></i>`);
      if (n && n.pin.style.translate) h.style.translate = n.pin.style.translate;
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fx = k.includes('w') ? b[0] : a[0], fy = k.includes('n') ? b[1] : a[1];
        let pts = m.pts;
        const mv = (ev) => {
          const p = ed.toPage(ev.clientX, ev.clientY);
          let w = Math.max(24, Math.abs(p.x - fx));
          const hgt = w / (m.ratio || 1);
          const x1 = k.includes('w') ? fx - w : fx, y1 = k.includes('n') ? fy - hgt : fy;
          pts = [[Math.round(x1), Math.round(y1)], [Math.round(x1 + w), Math.round(y1 + hgt)]];
          const ng = shapeOf({ ...m, pts });
          ng.setAttribute('transform', n.g.getAttribute('transform') || '');
          ng.classList.add('sel');
          n.g.replaceWith(ng);
          n.g = ng;
        };
        const up = () => {
          window.removeEventListener('pointermove', mv, true);
          window.removeEventListener('pointerup', up, true);
          if (pts !== m.pts) update(m, { pts }, i18nText('缩放参考图'), ed);
        };
        window.addEventListener('pointermove', mv, true);
        window.addEventListener('pointerup', up, true);
      });
      htmlLayer.appendChild(h);
    });
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
    const up = (ev) => {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (ev.type === 'pointercancel') { render(ed); return; }
      if (!d) return;
      update(m, { pts: m.pts.map((q) => [q[0] + d[0], q[1] + d[1]]) }, m.type === 'image' ? i18nText('挪动参考图') : i18nText('挪动草图标记'), ed);
    };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return true;
  }
  function hitContext(e, ed) {
    const m = hitAt(ed, e.clientX, e.clientY);
    if (!m) return false;
    select(ed, m.id);
    showMenu([
      { title: TYPE_NAME[m.type] || i18nText('标记') },
      { label: i18nText('写要求'), icon: 'edit', onClick: () => select(ed, m.id, true) },
      { label: i18nTpl`@ 引用 #${m.no} 到助手`, icon: 'at', onClick: () => app.agent.addRef({ kind: 'mark', id:m.id, color:m.color, no: m.no, page: m.page, title: `${TYPE_NAME[m.type] || i18nText('标记')}` }) },
      '-',
      { label: i18nText('删除'), icon: 'trash', kbd: 'Del', danger: true, onClick: () => remove([m], ed) },
    ], e.clientX, e.clientY);
    return true;
  }

  // ---------- 对外 ----------
  app.sketch = {
    tick: (ed) => tick(ed),
    hitSelect, hitContext,
    addMoveArrow: (info, dx, dy) => addMoveArrow(app.editor, info.element, dx, dy),
    imageFromFiles: (files, at) => imageFromFiles(app.editor, files, at),
    addImage: (img, at) => addImage(app.editor, img, at),
    list: () => marks(),
    markFromVerdict: (res, extra = {}) => {
      const ed = app.editor;
      const info = ed.selection;
      const r = info ? ed.pageRect(info.element) : { x: ed.frame.win.scrollX + 40, y: ed.frame.win.scrollY + 40 };
      add({ type: 'verdict', color: '#e5484d', pts: [[r.x, r.y]], auto: true, text: '', done: false,
        anchor: info && !info.generated ? { selector: info.selector, x0: r.x, y0: r.y, tag: info.tag, line: info.line } : null,
        meta: i18nTpl`${extra.label || i18nText('修改')}受阻：${String(res.reason || '').slice(0, 60)}` }, ed, true);
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
      const box = el(i18nTpl`<div style="display:flex;align-items:center;gap:2px">
        <div class="dock-colors" data-colors>${COLORS.map((c) => i18nTpl`<button data-c="${c}" style="background:${c};color:${c}" data-tip="笔的颜色"></button>`).join('')}</div>
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
    bindKey(t.kbd, { id: 'tool.' + t.id, label: t.label, group: i18nText('草图'), when: () => app.state.view === 'edit' && !app.editor.textEditing, run: () => app.editor.setTool(t.id) });
  });
  bindKey(['Delete', 'Backspace'], { hidden: true, priority: 5, when: () => app.state.view === 'edit' && !!selId, run: () => { const m = findMark(selId); if (m) remove([m], app.editor); } });
  bindKey('Esc', { hidden: true, priority: 5, when: () => app.state.view === 'edit' && !!selId, run: () => select(app.editor, null) });
  bus.on('rendered', () => render(app.editor));
  // 粘贴图片 / 把图片文件拖到页面上 → 参考图
  document.addEventListener('paste', (e) => {
    if (app.state.view !== 'edit' || !app.editor.frame || app.editor.textEditing) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length && [...files].some((f) => /^image\//.test(f.type))) { e.preventDefault(); imageFromFiles(app.editor, files); }
  });
  document.addEventListener('dragover', (e) => {
    if (app.state.view !== 'edit' || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    if (e.target.closest && e.target.closest('.stage-host')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  document.addEventListener('drop', (e) => {
    if (app.state.view !== 'edit' || !e.dataTransfer || !e.dataTransfer.files.length) return;
    if (!(e.target.closest && e.target.closest('.stage-host'))) return;
    e.preventDefault();
    imageFromFiles(app.editor, e.dataTransfer.files, app.editor.toPage(e.clientX, e.clientY));
  });
  bus.on('page', () => { selId = null; render(app.editor); });

  // ---------- 左侧面板：全部标记 ----------
  bus.registerPanel({
    id: 'marks', title: i18nText('草图标记'), icon: 'marks', views: ['edit', 'overview'],
    badge: () => marks().filter((m) => !m.done).length,
    render(host) {
      const paint = () => {
        const list = marks();
        const proj = app.project();
        host.innerHTML = '';
        const bar = el(i18nTpl`<div class="p-sec"><div class="p-actions">
          <button class="btn small primary" data-sheet>${icon('copy', 14)}导出任务单（${list.filter((m) => !m.done).length}）</button></div>
          <div class="hint" style="margin-top:8px">用底部工具坞里的画笔、箭头、方框、便签钉在页面上画；每个标记都可以写一句要求。修改遇到红灯也会自动记到这里。</div></div>`);
        bar.querySelector('[data-sheet]').onclick = () => exportTaskSheet(app);
        host.appendChild(bar);
        if (!list.length) { host.appendChild(el(i18nText('<div class="empty">还没有标记</div>'))); return; }
        proj.pages.forEach((pg) => {
          const ms = list.filter((m) => m.page === pg.file);
          if (!ms.length) return;
          host.appendChild(el(`<div class="p-sec-title" style="padding:12px 14px 4px;margin:0">${esc(pg.title)}</div>`));
          ms.forEach((m) => {
            const row = el(i18nTpl`<div class="list-row ${m.done ? 'done' : ''}"><span class="sk-dot" style="background:${m.color || '#e5484d'}">${m.no}</span>
              <div class="grow"><div class="t1">${esc(m.text || i18nText('（还没写要求）'))}</div><div class="t2">${esc(TYPE_NAME[m.type] || m.type)}${m.meta ? ' · ' + esc(m.meta) : ''}</div></div>
              <button class="icon-btn sm" aria-label="删除标记" data-tip="删除">${icon('trash',14)}</button></div>`);
            row.querySelector('button').onclick = (e) => { e.stopPropagation(); remove([m], app.view() === 'edit' ? app.editor : null); };
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
