// 拖动与缩放：只改视觉预览（translate / scale / width），松手才写回源码。
import { buildIndex, snapMove, linesFor, snapEdge } from './guides.js';
import { toast } from '../core/ui.js';

export const CONTAINERS = 'section, header, footer, nav, main, article, aside';
const NAMES = { section: '版块', header: '页眉', footer: '页脚', nav: '导航', main: '主体', article: '文章块', aside: '侧栏', body: '整页' };
const T_SCREEN = 6;

const tr = (v) => { const p = String(v || '').split(/\s+/).map(parseFloat); return [p[0] || 0, p[1] || 0]; };
const arrowX = (d) => (d >= 0 ? '→ ' : '← ') + Math.abs(d);
const arrowY = (d) => (d >= 0 ? '↓ ' : '↑ ') + Math.abs(d);

// 参照物：所在区域里可见的元素 + 父元素 + 区域本身；同级兄弟用于等间距
function collectRefs(ed, elm, scope) {
  const w = ed.frame.win, vh = w.innerHeight;
  const view = { y1: w.scrollY - vh, y2: w.scrollY + vh * 2 };
  const refs = [];
  const all = scope.querySelectorAll('[data-loc]');
  for (let i = 0; i < all.length && refs.length < 360; i++) {
    const o = all[i];
    if (o === elm || o.contains(elm) || elm.contains(o)) continue;
    const r = ed.pageRect(o);
    if (r.w < 2 || r.h < 2 || r.y > view.y2 || r.y + r.h < view.y1) continue;
    refs.push(r);
  }
  const par = elm.parentElement && elm.parentElement !== ed.frame.doc.body ? ed.pageRect(elm.parentElement) : null;
  if (par) refs.push(par);
  const peers = [...(elm.parentElement ? elm.parentElement.children : [])]
    .filter((o) => o !== elm && o.hasAttribute('data-loc'))
    .map((o) => ed.pageRect(o)).filter((r) => r.w > 1 && r.h > 1);
  return { refs, peers };
}

function containerList(ed, elm) {
  return [...ed.frame.doc.querySelectorAll(CONTAINERS)]
    .filter((c) => c !== elm && !elm.contains(c))
    .map((c) => ({ c, r: ed.pageRect(c) }));
}
function containerAt(list, x, y) {
  let hit = null, area = Infinity;
  list.forEach(({ c, r }) => {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && r.w * r.h < area) { hit = c; area = r.w * r.h; }
  });
  return hit;
}

function track(onMove, onUp, onCancel) {
  const mv = (e) => onMove(e);
  const up = (e) => { stop(); onUp(e); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); onCancel(); } };
  function stop() {
    window.removeEventListener('pointermove', mv, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('keydown', key, true);
  }
  window.addEventListener('pointermove', mv, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('keydown', key, true);
}

// ---------- 移动 ----------
export function startMove(ed, info0, e0, onClick) {
  let info = info0, elm = info.element, swapped = false;
  const p0 = ed.toPage(e0.clientX, e0.clientY);
  let st = null, dx = 0, dy = 0, crossed = false;
  const ov = ed.ov;

  function begin() {
    const blk = ed.movableOf(elm);
    if (blk !== elm) { ed.select(blk); info = ed.selection; elm = blk; swapped = true; }
    if (ed.isLocked(info)) { toast('这个元素已锁定，先解锁再拖', 'err'); return false; }
    const cont = elm.parentElement ? elm.parentElement.closest(CONTAINERS) : null;
    const scope = cont || ed.frame.doc.body;
    const { refs, peers } = collectRefs(ed, elm, scope);
    const contR = cont ? ed.pageRect(cont) : null;
    if (contR) refs.push(contR);
    st = {
      r0: ed.pageRect(elm), t0: tr(elm.style.translate), inline0: elm.style.translate,
      cont, contR, index: buildIndex(refs), peers, list: containerList(ed, elm),
    };
    ov.place(ov.origin, st.r0);
    if (contR) {
      ov.place(ov.range, contR);
      ov.rangeLabel.textContent = `可移动范围：${NAMES[cont.tagName.toLowerCase()] || cont.tagName.toLowerCase()} <${cont.tagName.toLowerCase()}>`;
    }
    ov.sel.classList.add('dragging');
    ov.hide(ov.hover);
    ed.dragging = true;
    ed.setHint(`${swapped ? `这是行内文字，拖的是它所在的 &lt;${info.tag}&gt; 整块 · ` : ''}拖动中 · 按住 <b>Alt</b> 暂停吸附 · 按住 <b>Shift</b> 只走横 / 竖 · <b>Esc</b> 取消`);
    return true;
  }

  function finishVisuals() {
    ov.hide(ov.origin); ov.hide(ov.range); ov.range.classList.remove('out');
    ov.clearGuides(); ov.hidePill();
    ov.sel.classList.remove('dragging');
    ed.dragging = false;
    ed.setHint('');
  }

  track((e) => {
    const p = ed.toPage(e.clientX, e.clientY);
    let mx = p.x - p0.x, my = p.y - p0.y;
    const z = ed.stage.zoom;
    if (!st) {
      if (Math.hypot(mx, my) * z < 3) return;
      if (!begin()) { st = false; return; }
    }
    if (st === false) return;
    let lockX = false, lockY = false;
    if (e.shiftKey) { if (Math.abs(mx) >= Math.abs(my)) { my = 0; lockY = true; } else { mx = 0; lockX = true; } }
    const r0 = st.r0;
    const m = { x: r0.x + mx, y: r0.y + my, w: r0.w, h: r0.h };
    let res = { dx: 0, dy: 0, lines: [], gaps: [], snapped: false };
    if (!e.altKey) res = snapMove(m, st.index, st.peers, T_SCREEN / z, { lockX, lockY });
    dx = Math.round(mx + res.dx);
    dy = Math.round(my + res.dy);
    elm.style.translate = `${st.t0[0] + dx}px ${st.t0[1] + dy}px`;
    const cx = r0.x + dx + r0.w / 2, cy = r0.y + dy + r0.h / 2;
    crossed = containerAt(st.list, cx, cy) !== (st.cont || null);
    ov.range.classList.toggle('out', crossed);
    ov.drawGuides(res.lines, res.gaps);
    const text = crossed
      ? '移出了所在区域 · 松手后会恢复原位并记成草图标记'
      : `${arrowX(dx)}　${arrowY(dy)}${res.snapped ? '　<b>已对齐</b>' : ''}`;
    ov.showPill(text, r0.x + dx, r0.y + dy + r0.h + 10, crossed ? 'out' : res.snapped ? 'snap' : '');
  }, () => {
    if (!st) { if (st === null && onClick) onClick(); return; }
    finishVisuals();
    if (!dx && !dy) { elm.style.translate = st.inline0; return; }
    if (crossed) {
      elm.style.translate = st.inline0;
      ed.onMoveCrossed(info, dx, dy, st.cont);
      return;
    }
    ed.commitMove(info, dx, dy, () => { elm.style.translate = st.inline0; });
  }, () => {
    if (st) { elm.style.translate = st.inline0; finishVisuals(); }
  });
}

// ---------- 缩放（角点=等比视觉缩放；边线=改宽/高）----------
export function startResize(ed, info, hd, e0) {
  const elm = info.element;
  if (ed.isLocked(info)) { toast('这个元素已锁定', 'err'); return; }
  const ov = ed.ov, win = ed.frame.win;
  const cs = win.getComputedStyle(elm);
  const r0 = ed.pageRect(elm);
  const saved = { scale: elm.style.scale, translate: elm.style.translate, width: elm.style.width, height: elm.style.height };
  const s0 = parseFloat(elm.style.scale) || parseFloat(cs.scale) || 1;
  let [tx, ty] = tr(elm.style.translate);
  const corner = hd.length === 2;
  const sx = hd.includes('e') ? 1 : hd.includes('w') ? -1 : 0;
  const sy = hd.includes('s') ? 1 : hd.includes('n') ? -1 : 0;
  const ax = sx > 0 ? r0.x : sx < 0 ? r0.x + r0.w : r0.x + r0.w / 2;
  const ay = sy > 0 ? r0.y : sy < 0 ? r0.y + r0.h : r0.y + r0.h / 2;
  const scope = (elm.parentElement && elm.parentElement.closest(CONTAINERS)) || ed.frame.doc.body;
  const { refs } = collectRefs(ed, elm, scope);
  const index = buildIndex(refs);
  const layoutW = elm.offsetWidth || r0.w / s0, layoutH = elm.offsetHeight || r0.h / s0;
  const cssW = parseFloat(cs.width) || layoutW, cssH = parseFloat(cs.height) || layoutH;
  let s = s0, newW = null, newH = null, moved = false;
  ov.sel.classList.add('dragging');
  ed.dragging = true;
  ed.setHint(corner ? '拖角点：等比缩放（只改看起来的大小，不挤动别人）· <b>Esc</b> 取消' : '拖边线：改宽度 / 高度（可能让周围内容让位）· <b>Esc</b> 取消');

  const anchorFix = () => {   // 让对角 / 对边保持不动
    const r = ed.pageRect(elm);
    const cx = sx > 0 ? r.x : sx < 0 ? r.x + r.w : r.x + r.w / 2;
    const cy = sy > 0 ? r.y : sy < 0 ? r.y + r.h : r.y + r.h / 2;
    if (sx) tx += ax - cx;
    if (sy) ty += ay - cy;
    if (corner && !sx) tx += ax - cx;
    elm.style.translate = `${Math.round(tx)}px ${Math.round(ty)}px`;
  };

  track((e) => {
    moved = true;
    const p = ed.toPage(e.clientX, e.clientY);
    const T = T_SCREEN / ed.stage.zoom;
    let guideRect;
    if (corner) {
      let k = ((p.x - ax) * sx * r0.w + (p.y - ay) * sy * r0.h) / (r0.w * r0.w + r0.h * r0.h);
      if (!e.altKey) {
        const ex = ax + sx * r0.w * k, ey = ay + sy * r0.h * k;
        const cxs = snapEdge(ex, index.xs, T), cys = snapEdge(ey, index.ys, T);
        if (cxs && (!cys || Math.abs(cxs) <= Math.abs(cys))) k = Math.abs(ex + cxs - ax) / r0.w;
        else if (cys) k = Math.abs(ey + cys - ay) / r0.h;
      }
      k = Math.min(6, Math.max(0.1, k));
      s = Math.round(s0 * k * 1000) / 1000;
      elm.style.scale = String(s);
      anchorFix();
      ov.showPill(`等比缩放 ${Math.round(s * 100)}%`, p.x + 14, p.y + 14);
    } else if (sx) {
      let edge = sx > 0 ? Math.max(r0.x + 8, p.x) : Math.min(r0.x + r0.w - 8, p.x);
      if (!e.altKey) edge += snapEdge(edge, index.xs, T);
      const vis = Math.abs(edge - ax);
      newW = Math.max(8, Math.round(cssW + (vis / s0 - layoutW)));
      elm.style.width = newW + 'px';
      anchorFix();
      ov.showPill(`宽 ${Math.round(vis / s0)} px`, p.x + 14, p.y + 14);
    } else {
      let edge = sy > 0 ? Math.max(r0.y + 8, p.y) : Math.min(r0.y + r0.h - 8, p.y);
      if (!e.altKey) edge += snapEdge(edge, index.ys, T);
      const vis = Math.abs(edge - ay);
      newH = Math.max(8, Math.round(cssH + (vis / s0 - layoutH)));
      elm.style.height = newH + 'px';
      anchorFix();
      ov.showPill(`高 ${Math.round(vis / s0)} px`, p.x + 14, p.y + 14);
    }
    guideRect = ed.pageRect(elm);
    ov.drawGuides(e.altKey ? [] : linesFor(guideRect, index).lines, []);
  }, () => {
    ov.clearGuides(); ov.hidePill(); ov.sel.classList.remove('dragging');
    ed.dragging = false; ed.setHint('');
    const restore = () => Object.assign(elm.style, saved);
    if (!moved) return;
    const props = {};
    const t = (Math.round(tx) || Math.round(ty)) ? `${Math.round(tx)}px ${Math.round(ty)}px` : null;
    if (corner) { props.scale = Math.abs(s - 1) < 0.005 ? null : String(s); props.translate = t; }
    else { if (newW != null) props.width = newW + 'px'; if (newH != null) props.height = newH + 'px'; props.translate = t; }
    const label = corner ? `缩放到 ${Math.round(s * 100)}%` : newW != null ? `宽度改为 ${newW}px` : `高度改为 ${newH}px`;
    ed.commitStyle(info, props, label, restore);
  }, () => {
    Object.assign(elm.style, saved);
    ov.clearGuides(); ov.hidePill(); ov.sel.classList.remove('dragging');
    ed.dragging = false; ed.setHint('');
  });
}
