/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 覆盖层：悬停框、选中框（标签+8 个手柄）、可移动范围框、原位置轮廓、参考线、数值气泡、波及闪框。
// 放在工作台文档里、盖在 iframe 上方，页面代码完全不受影响；.ovl-page 跟随页面滚动，里面用"页面坐标"。
import { el } from '../core/ui.js';
import { icon } from '../core/icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function createOverlay(device) {
  const root = el(i18nTpl`<div class="ovl t-select">
    <div class="ovl-page">
      <div class="ov-box ov-range"><i></i></div>
      <div class="ov-box ov-origin"></div>
      <div class="ov-box ov-hover"></div>
      <div class="ov-flash"></div>
      <div class="sk-host"></div>
      <svg class="ov-guides" width="1" height="1"></svg>
      <div class="ov-box ov-sel">
        <div class="ov-tag"><span></span><button data-act="parent" data-tip="选择外面一层" data-kbd="Shift+Enter">${icon('parent', 13)}</button></div>
        <div class="ov-size"></div>
        ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i class="hd ${h} ${h.length === 1 ? 'edge' : ''}" data-hd="${h}"></i>`).join('')}
      </div>
    </div>
    <div class="ov-pill"></div>
  </div>`);
  device.appendChild(root);
  const q = (s) => root.querySelector(s);
  const o = {
    root,
    page: q('.ovl-page'),
    range: q('.ov-range'), rangeLabel: q('.ov-range i'),
    origin: q('.ov-origin'), hover: q('.ov-hover'),
    sel: q('.ov-sel'), tag: q('.ov-tag span'), size: q('.ov-size'),
    guides: q('.ov-guides'), pill: q('.ov-pill'), flash: q('.ov-flash'), skHost: q('.sk-host'),
    scroll: { x: 0, y: 0 },
  };
  o.setScroll = (x, y) => { o.scroll = { x, y }; o.page.style.transform = `translate(${-x}px, ${-y}px)`; };
  o.place = (box, r) => {
    if (!r) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.left = r.x + 'px';
    box.style.top = r.y + 'px';
    box.style.width = Math.max(0, r.w) + 'px';
    box.style.height = Math.max(0, r.h) + 'px';
  };
  o.hide = (box) => { box.style.display = 'none'; };
  // 数值气泡：页面坐标 → 覆盖层坐标（覆盖层本身不滚动）
  o.showPill = (html, px, py, cls = '') => {
    o.pill.className = 'ov-pill ' + cls;
    o.pill.innerHTML = html;
    o.pill.style.display = 'block';
    const inv = parseFloat(getComputedStyle(root).getPropertyValue('--inv')) || 1;
    o.pill.style.transform = `translate(${px - o.scroll.x}px, ${py - o.scroll.y}px) scale(${inv})`;
    o.pill.style.transformOrigin = '0 0';
    o.pill.style.left = '0';
    o.pill.style.top = '0';
  };
  o.hidePill = () => { o.pill.style.display = 'none'; };
  o.flashRects = (rects, color) => {
    o.flash.innerHTML = '';
    rects.forEach((r) => {
      const b = el('<div class="ov-affect"></div>');
      Object.assign(b.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      if (color) b.style.borderColor = color;
      o.flash.appendChild(b);
    });
    clearTimeout(o._ft);
    o._ft = setTimeout(() => { o.flash.innerHTML = ''; }, 2700);
  };
  // 参考线：lines [{x1,y1,x2,y2}]，gaps [{x1,y1,x2,y2,label}]（等距标注）
  o.drawGuides = (lines = [], gaps = []) => {
    const g = o.guides;
    g.innerHTML = '';
    const inv = parseFloat(getComputedStyle(root).getPropertyValue('--inv')) || 1;
    lines.forEach((l) => {
      const ln = document.createElementNS(SVGNS, 'line');
      ln.setAttribute('x1', l.x1); ln.setAttribute('y1', l.y1); ln.setAttribute('x2', l.x2); ln.setAttribute('y2', l.y2);
      g.appendChild(ln);
      [[l.x1, l.y1], [l.x2, l.y2]].forEach(([cx, cy]) => {
        const d = document.createElementNS(SVGNS, 'circle');
        d.setAttribute('class', 'dot'); d.setAttribute('cx', cx); d.setAttribute('cy', cy); d.setAttribute('r', 2.2 * inv);
        g.appendChild(d);
      });
    });
    gaps.forEach((gp) => {
      const grp = document.createElementNS(SVGNS, 'g');
      grp.setAttribute('class', 'gap');
      const ln = document.createElementNS(SVGNS, 'line');
      ln.setAttribute('x1', gp.x1); ln.setAttribute('y1', gp.y1); ln.setAttribute('x2', gp.x2); ln.setAttribute('y2', gp.y2);
      grp.appendChild(ln);
      const cx = (gp.x1 + gp.x2) / 2, cy = (gp.y1 + gp.y2) / 2;
      const w = (String(gp.label).length * 7 + 10) * inv, h = 16 * inv;
      const bg = document.createElementNS(SVGNS, 'rect');
      bg.setAttribute('x', cx - w / 2); bg.setAttribute('y', cy - h / 2); bg.setAttribute('width', w); bg.setAttribute('height', h); bg.setAttribute('rx', 4 * inv);
      grp.appendChild(bg);
      const tx = document.createElementNS(SVGNS, 'text');
      tx.setAttribute('x', cx); tx.setAttribute('y', cy + 4 * inv); tx.setAttribute('text-anchor', 'middle');
      tx.textContent = gp.label;
      grp.appendChild(tx);
      g.appendChild(grp);
    });
  };
  o.clearGuides = () => { o.guides.innerHTML = ''; };
  o.setTool = (cls) => { root.className = 'ovl ' + cls; };
  return o;
}
