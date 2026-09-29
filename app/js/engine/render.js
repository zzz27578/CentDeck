// render.js —— 浏览器侧渲染 + 编辑层（只能在浏览器里跑，Node 下只能 import 不能调用）
// 移植自 demo/core.js（instrument 渲染、ensureUi 编辑层、pick/snap/collateral/flash）
//        与 demo/edit.js（悬停轮廓、点选、拖动预览、对齐参考线、跨区域判定）。
//
// 硬约定：本模块只负责"看"和"摆预览"——拖动过程只改 iframe 里的视觉层 translate（不写源码、
// 绝不碰 transform），松手时把 dx/dy 通过 hooks.onDrop 交给调用方，由调用方去调 writeback.applyEdit。
//
// 用法：
//   const session = await render(iframe, html, {
//     onSelect(info) {},          // info 见 getSelection() 的结构
//     onDrop(drop) {},            // 拖动松手：{ selector, loc, generated, dx, dy, crossed, before, restore() }
//     onDblClick(info) {},        // 双击（界面层可借此进入改字流程）
//     containers: 'section, ...', // 可选：跨区域判定的容器选择器
//   });
//   const res = applyEdit(session.source, { kind:'move', target: drop.selector, dx: drop.dx, dy: drop.dy, crossed: drop.crossed });
//   if (res.newSource) await session.setSource(res.newSource); else drop.restore();

import { parse, instrument } from './parse.js';

const DEFAULT_CONTAINERS = 'section, header, footer, nav, main, article, aside';
const UI_ID = '__ce_ui';

export function render(iframe, html, hooks = {}) {
  const containers = hooks.containers || DEFAULT_CONTAINERS;
  const parentWin = iframe.ownerDocument.defaultView;
  let doc = null, win = null, ui = null;
  let rafId = 0, destroyed = false;
  const disposers = []; // makeMeasure 创建的隐藏框架等资源的清理函数
  const state = { source: String(html), parsed: null, selEl: null, lastSelector: null };
  let drag = null;

  // ---------- 几何工具 ----------
  function pageRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height };
  }
  function place(box, r, pad = 0) {
    box.style.left = (r.x - pad) + 'px';
    box.style.top = (r.y - pad) + 'px';
    box.style.width = (r.w + pad * 2) + 'px';
    box.style.height = (r.h + pad * 2) + 'px';
  }
  function running(el) { // 动画在播的元素不做对齐候选/波及对比（demo 同款策略）
    try { return !!(el.getAnimations && el.getAnimations().some(a => a.playState === 'running')); }
    catch (e) { return false; }
  }

  // ---------- 编辑层（注入到 iframe 文档里）移植 demo/core.js ensureUi ----------
  function injectUi() {
    const old = doc.getElementById(UI_ID);
    if (old) old.remove();
    const st = doc.createElement('style');
    st.id = UI_ID + '_style';
    st.textContent =
      '#' + UI_ID + '{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;font:12px/20px "Microsoft YaHei",sans-serif}' +
      '#' + UI_ID + ' .h{position:absolute;display:none;border:1px dashed #4c7dff;background:rgba(76,125,255,.06)}' +
      '#' + UI_ID + ' .s{position:absolute;display:none;border:2px solid #4c7dff;border-radius:3px}' +
      '#' + UI_ID + ' .s span{position:absolute;left:-2px;top:-22px;padding:0 6px;background:#4c7dff;color:#fff;border-radius:4px 4px 0 0;white-space:nowrap}' +
      '#' + UI_ID + ' .g i{position:absolute;background:#ff3b7f}' +
      '#' + UI_ID + ' .f i{position:absolute;border:2px solid #ff9f1a;background:rgba(255,159,26,.14);border-radius:3px;animation:__ce_fade 2.6s forwards}' +
      '#' + UI_ID + ' .lb{position:absolute;display:none;padding:2px 8px;background:#1f2430;color:#fff;border-radius:4px;white-space:nowrap}' +
      '@keyframes __ce_fade{0%,70%{opacity:1}100%{opacity:0}}';
    const root = doc.createElement('div');
    root.id = UI_ID;
    root.innerHTML = '<div class="h"></div><div class="s"><span></span></div><div class="g"></div><div class="f"></div><div class="lb"></div>';
    doc.head.appendChild(st);
    doc.body.appendChild(root);
    ui = { root, hover: root.children[0], sel: root.children[1], selTag: root.children[1].firstChild, guides: root.children[2], flash: root.children[3], label: root.children[4] };
  }
  function isUi(node) {
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) if (n.id && n.id.indexOf(UI_ID) === 0) return true;
    return false;
  }
  // 点到的元素：body/html/编辑层本身不算
  function pick(node) {
    if (!node || node.nodeType !== 1 || isUi(node)) return null;
    if (node.tagName === 'BODY' || node.tagName === 'HTML') return null;
    return node;
  }
  const byLoc = loc => doc.querySelector('[data-loc="' + loc + '"]');

  // ---------- 选中信息（返回给界面层的结构） ----------
  function domSelector(el) { // 给没有门牌号的运行时元素拼 DOM 路径（仅供描述/转草图）
    const seg = [];
    for (let n = el; n && n !== doc.body && n.nodeType === 1; n = n.parentElement) {
      let nth = 1, sib = n;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === n.tagName) nth++;
      seg.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + nth + ')');
    }
    return 'body > ' + seg.join(' > ');
  }
  function buildInfo(el) {
    if (!el) return null;
    if (!el.hasAttribute('data-loc')) { // 程序运行时生成的：源码里没有它的门牌号
      return {
        generated: true, loc: null, selector: domSelector(el), tag: el.tagName.toLowerCase(),
        line: null, endLine: null, type: null, text: (el.textContent || '').trim().slice(0, 60) || null,
        rect: pageRect(el), element: el
      };
    }
    const loc = +el.getAttribute('data-loc');
    const e = state.parsed.elements[loc];
    return {
      generated: false, loc, selector: e.selector, tag: e.tag, type: e.type,
      line: e.line, endLine: e.endLine, col: e.col, endCol: e.endCol,
      sharedClass: e.sharedClass, sharedClasses: e.sharedClasses,
      transformAnim: e.transformAnim, animNames: e.animNames, jsDynamic: e.jsDynamic,
      text: e.textOnly ? e.text.trim() : null, textOnly: e.textOnly, style: e.style,
      rect: pageRect(el), element: el
    };
  }
  function doSelect(el) {
    state.selEl = el && el.isConnected ? el : null;
    state.lastSelector = state.selEl && state.selEl.hasAttribute('data-loc')
      ? state.parsed.elements[+state.selEl.getAttribute('data-loc')].selector : null;
    if (ui) ui.hover.style.display = 'none';
  }

  // ---------- 悬停 / 点击选中 / ctrl 逐层选中（移植 demo/edit.js） ----------
  function onMove(e) {
    if (drag) return dragMove(e);
    if (!ui) return;
    const el = pick(e.target);
    if (!el || el === state.selEl) { ui.hover.style.display = 'none'; return; }
    ui.hover.style.display = 'block';
    ui.hover.style.borderColor = el.hasAttribute('data-loc') ? '#4c7dff' : '#999999'; // 灰虚线=程序生成
    place(ui.hover, pageRect(el), 1);
  }
  function outerOf(el) { // 逐层选中：找最近的带门牌号的祖先
    for (let n = el.parentElement; n && n !== doc.body; n = n.parentElement) if (n.hasAttribute('data-loc')) return n;
    return null;
  }
  let lastClick = { x: 0, y: 0, t: 0 };
  let pendingDrag = null;
  function cycleSelect(ev, fallback) { // 同一位置连点：在光标下那一摞元素间循环切层
    const now = Date.now();
    if (lastClick.t && now - lastClick.t < 600 && Math.hypot(ev.clientX - lastClick.x, ev.clientY - lastClick.y) < 4) {
      const stack = (doc.elementsFromPoint ? doc.elementsFromPoint(ev.clientX, ev.clientY) : [fallback]).filter((n) => pick(n));
      if (stack.length > 1) {
        const i = stack.indexOf(state.selEl);
        const next = stack[(i + 1) % stack.length];
        lastClick = { x: ev.clientX, y: ev.clientY, t: now };
        selectAndNotify(next);
        return true;
      }
    }
    lastClick = { x: ev.clientX, y: ev.clientY, t: now };
    return false;
  }
  function maybeDrag(el, x, y) {
    // 锁定预判（壳层 canDrag）：被锁元素干脆不让拖，不"拖了白拖"松手弹回
    if (hooks.canDrag && !hooks.canDrag(buildInfo(el))) return;
    startDrag(el, { clientX: x, clientY: y });
  }
  function onDown(e) {
    if (e.button !== 0) return;
    const el = pick(e.target);
    if (!el) { doSelect(null); if (hooks.onSelect) hooks.onSelect(null); return; }
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { // Ctrl+点击：在父链上逐层向外选
      if (state.selEl && (state.selEl === el || state.selEl.contains(el))) {
        const up = outerOf(state.selEl);
        if (up && up !== state.selEl) selectAndNotify(up); else selectAndNotify(el);
      } else selectAndNotify(el);
      return;
    }
    // 按住选中元素内部任意处：拖得动（含容器被子元素填满的情况）；没拖动则按普通点击（含连点切层）
    if (state.selEl && state.selEl !== el && state.selEl.contains(el)) {
      pendingDrag = { el: state.selEl, x: e.clientX, y: e.clientY, used: false };
      const target = el;
      const onUpPre = (ev) => {
        doc.removeEventListener('mousemove', onMvPre, true);
        if (pendingDrag && !pendingDrag.used) {
          if (!cycleSelect(ev, target) && target !== state.selEl) selectAndNotify(target);
        }
        pendingDrag = null;
      };
      const onMvPre = (ev) => {
        if (!pendingDrag || pendingDrag.used) return;
        if (Math.abs(ev.clientX - pendingDrag.x) + Math.abs(ev.clientY - pendingDrag.y) >= 3) {
          pendingDrag.used = true;
          doc.removeEventListener('mousemove', onMvPre, true);
          maybeDrag(pendingDrag.el, pendingDrag.x, pendingDrag.y);
        }
      };
      doc.addEventListener('mousemove', onMvPre, true);
      doc.addEventListener('mouseup', onUpPre, { once: true });
      return;
    }
    if (el === state.selEl) { maybeDrag(el, e.clientX, e.clientY); return; } // 按住选中元素本身 → 拖动
    if (!cycleSelect(e, el)) selectAndNotify(el);
  }
  function selectAndNotify(el) { doSelect(el); if (hooks.onSelect) hooks.onSelect(buildInfo(el)); }

  // ---------- 拖动（只改视觉层 translate，不写源码）移植 demo/edit.js ----------
  function containerOf(el) { return el.parentElement ? el.parentElement.closest(containers) : null; }
  function visualTranslate(el) { // 视觉层当前偏移（源码内联 translate + 拖动中的预览增量以 el.style 为准）
    const v = el.style && el.style.translate;
    if (v) { const p = v.split(/\s+/).map(parseFloat); return [p[0] || 0, p[1] || 0]; }
    return [0, 0];
  }
  function startDrag(el, e) {
    const cont = containerOf(el);
    const cands = { x: [], y: [] }; // 对齐候选：同容器内各元素三边 + 容器中线（demo 同款）
    (cont || doc.body).querySelectorAll('[data-loc]').forEach(o => {
      if (o === el || el.contains(o) || o.contains(el) || running(o)) return;
      const q = pageRect(o);
      if (!q.w || !q.h) return;
      cands.x.push([q.x, o], [q.x + q.w / 2, o], [q.x + q.w, o]);
      cands.y.push([q.y, o], [q.y + q.h / 2, o], [q.y + q.h, o]);
    });
    if (cont) { const c = pageRect(cont); cands.x.push([c.x + c.w / 2, cont]); }
    drag = {
      el, sx: e.clientX, sy: e.clientY, r: pageRect(el),
      base: visualTranslate(el), inline0: el.style.translate || '',
      cont, cands, before: session.snapRects(), moved: false, dx: 0, dy: 0, snap: { x: null, y: null }
    };
  }
  function snap1(edges, cands) { // 6 像素内吸附（demo 同款）
    let best = null;
    edges.forEach(v => cands.forEach(c => {
      const d = c[0] - v;
      if (Math.abs(d) <= 6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c[0] };
    }));
    return best;
  }
  function drawGuides(sx, sy) {
    const g = ui.guides, de = doc.documentElement;
    g.innerHTML = '';
    if (sx) { const i = doc.createElement('i'); i.style.cssText = 'left:' + sx.at + 'px;top:0;width:1px;height:' + de.scrollHeight + 'px'; g.appendChild(i); }
    if (sy) { const j = doc.createElement('i'); j.style.cssText = 'top:' + sy.at + 'px;left:0;height:1px;width:' + de.scrollWidth + 'px'; g.appendChild(j); }
  }
  // 看落点中心落在哪个容器里（最小的那个），与拖动前所在容器比较 → 跨区域判定（demo 同款）
  function containerAt(px, py, self) {
    let best = null, area = Infinity;
    doc.querySelectorAll(containers).forEach(c => {
      if (c === self || self.contains(c)) return;
      const q = pageRect(c);
      if (px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h && q.w * q.h < area) { best = c; area = q.w * q.h; }
    });
    return best;
  }
  function crossed() { return containerAt(drag.r.x + drag.dx + drag.r.w / 2, drag.r.y + drag.dy + drag.r.h / 2, drag.el) !== (drag.cont || null); }
  function dragMove(e) {
    let dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return; // 3 像素起步，防手抖（demo 同款）
    drag.moved = true;
    const r = drag.r;
    const sx = e.altKey ? null : snap1([r.x + dx, r.x + r.w / 2 + dx, r.x + r.w + dx], drag.cands.x);
    const sy = e.altKey ? null : snap1([r.y + dy, r.y + r.h / 2 + dy, r.y + r.h + dy], drag.cands.y);
    if (sx) dx += sx.d;
    if (sy) dy += sy.d;
    drag.dx = Math.round(dx);
    drag.dy = Math.round(dy);
    drag.snap = { x: !!sx, y: !!sy };
    // 只改视觉层：独立 translate 通道，不碰 transform，不写源码
    drag.el.style.translate = (drag.base[0] + drag.dx) + 'px ' + (drag.base[1] + drag.dy) + 'px';
    drawGuides(sx, sy);
    const lb = ui.label, cross = crossed();
    lb.style.display = 'block';
    lb.style.background = cross ? '#d63031' : '#1f2430';
    lb.style.left = (r.x + drag.dx) + 'px';
    lb.style.top = (r.y + drag.dy + r.h + 6) + 'px';
    lb.textContent = (drag.dx >= 0 ? '→ ' : '← ') + Math.abs(drag.dx) + '  ' + (drag.dy >= 0 ? '↓ ' : '↑ ') + Math.abs(drag.dy) +
      (sx || sy ? '  · 已对齐' : '') + (cross ? '  · 跨出了所在区域，松手后将转为草图标记' : '');
  }
  function finishDrag() {
    if (!drag) return;
    const d = drag;
    const wasCrossed = crossOf(d); // 先把跨区域判定算出来（crossed() 依赖全局 drag 状态）
    drag = null;
    if (ui) { ui.guides.innerHTML = ''; ui.label.style.display = 'none'; }
    if (!d.moved) return;
    if (hooks.onDrop) {
      hooks.onDrop({
        loc: d.el.hasAttribute('data-loc') ? +d.el.getAttribute('data-loc') : null,
        selector: d.el.hasAttribute('data-loc') ? state.parsed.elements[+d.el.getAttribute('data-loc')].selector : domSelector(d.el),
        generated: !d.el.hasAttribute('data-loc'),
        dx: d.dx, dy: d.dy, crossed: wasCrossed,
        before: d.before, from: d.r, element: d.el,
        restore() { d.el.style.translate = d.inline0; } // 红灯时调用方用来恢复原状
      });
    }
    function crossOf(dd) { return containerAt(dd.r.x + dd.dx + dd.r.w / 2, dd.r.y + dd.dy + dd.r.h / 2, dd.el) !== (dd.cont || null); }
  }

  // ---------- 鼠标/键盘绑定（每次重渲染后重绑） ----------
  const bound = [];
  function listen(target, type, fn, opt) { target.addEventListener(type, fn, opt); bound.push([target, type, fn, opt]); }
  function bindAll() {
    listen(doc, 'mousemove', onMove);
    listen(doc, 'mousedown', onDown);
    listen(doc, 'mouseup', finishDrag);
    listen(doc, 'dblclick', e => {
      const el = pick(e.target);
      if (el && hooks.onDblClick) { e.preventDefault(); hooks.onDblClick(buildInfo(el)); }
    });
    listen(doc, 'click', e => { if (e.target.closest && e.target.closest('a')) e.preventDefault(); }); // 编辑态不跟链接跳
    listen(doc, 'mouseleave', () => { if (ui) ui.hover.style.display = 'none'; });
    listen(doc, 'keydown', e => { if (e.key === 'Escape') { doSelect(null); if (hooks.onSelect) hooks.onSelect(null); } });
    listen(parentWin, 'mouseup', finishDrag); // 拖出 iframe 边界松手也要收尾
  }

  // ---------- 选中框跟随循环（demo 同款 rAF） ----------
  function loop() {
    if (destroyed) return;
    try {
      if (ui) {
        if (state.selEl && state.selEl.isConnected) {
          ui.sel.style.display = 'block';
          place(ui.sel, pageRect(state.selEl), 2);
          const info = buildInfo(state.selEl);
          ui.selTag.textContent = info.generated
            ? '<' + info.tag + '> 无门牌号（程序生成）'
            : '<' + info.tag + '> ' + Math.round(info.rect.w) + '×' + Math.round(info.rect.h) + '（第 ' + info.line + ' 行）' + (info.transformAnim ? ' · 带动画' : '') + (info.jsDynamic ? ' · 疑似JS生成' : '');
        } else ui.sel.style.display = 'none';
      }
    } catch (e) {}
    rafId = (iframe.ownerDocument.defaultView || window).requestAnimationFrame(loop);
  }

  // ---------- 渲染 ----------
  function doRender() {
    return new Promise(resolve => {
      iframe.onload = () => {
        doc = iframe.contentDocument;
        win = iframe.contentWindow;
        injectUi();
        bindAll();
        // 重渲染后按 selector 恢复选中（行内改写后选择器不变，可稳态恢复）
        if (state.lastSelector) {
          const e = state.parsed.bySelector(state.lastSelector);
          state.selEl = e ? byLoc(e.loc) : null;
        }
        if (hooks.onRender) hooks.onRender(session);
        resolve(session);
      };
      iframe.srcdoc = instrument(state.source, state.parsed); // 门牌号只进预览，不进源码
    });
  }
  state.parsed = parse(state.source);
  const first = doRender();
  loop();

  // ---------- 会话 API ----------
  const session = {
    iframe,
    get source() { return state.source; },
    get parsed() { return state.parsed; },
    get document() { return doc; },
    get window() { return win; },

    // 改完源码后重渲染（<1s 刷新；门牌号随新源码重建）
    setSource(newSource) {
      while (bound.length) { const [t, type, fn, opt] = bound.pop(); t.removeEventListener(type, fn, opt); }
      state.source = String(newSource);
      state.parsed = parse(state.source);
      state.selEl = null;
      return doRender();
    },

    getSelection() { return buildInfo(state.selEl); },
    select(target) { // 数字 loc / selector 字符串 / DOM 元素 / null
      if (target == null) { doSelect(null); return; }
      if (typeof target === 'number') { doSelect(byLoc(target)); return; }
      if (typeof target === 'string') {
        const e = state.parsed.bySelector(target);
        doSelect(e ? byLoc(e.loc) : null);
        return;
      }
      doSelect(target);
    },
    clearSelection() { doSelect(null); },
    describe(target) { // 人话描述一个选中目标，判定面板可直接用
      const info = target && target.tagName ? buildInfo(target) : target;
      if (!info) return '';
      let s = '<' + info.tag + '>';
      if (info.generated) s += '（程序生成，源码里没有直接对应的一行）';
      else s += '（第 ' + info.line + (info.endLine > info.line ? '–' + info.endLine : '') + ' 行）';
      if (info.text) s += '「' + (info.text.length > 16 ? info.text.slice(0, 16) + '…' : info.text) + '」';
      return s;
    },

    // 几何快照：loc → {x,y,w,h,tag}，跳过动画在播的元素（移植 demo/core.js WB.snap）
    snapRects() {
      const out = {};
      if (!doc) return out;
      doc.querySelectorAll('[data-loc]').forEach(el => {
        if (running(el)) return;
        const r = pageRect(el);
        out[el.getAttribute('data-loc')] = { x: r.x, y: r.y, w: r.w, h: r.h, tag: el.tagName.toLowerCase() };
      });
      return out;
    },

    // 生成 writeback.applyEdit 用的同步度量回调：隐藏 iframe 先后渲染改动前/后源码，
    // 对比除目标及其祖先/子孙之外哪些元素被挤动（移植 demo/core.js WB.collateral + demo/edit.js 黄灯判定）
    makeMeasure() {
      let mframe = null, cache = { src: null, map: null };
      const ensure = () => {
        if (mframe && mframe.isConnected) return mframe;
        mframe = iframe.ownerDocument.createElement('iframe');
        mframe.setAttribute('aria-hidden', 'true');
        mframe.style.cssText = 'position:fixed;left:-99999px;top:0;height:1000px;border:0;visibility:hidden;';
        iframe.ownerDocument.body.appendChild(mframe);
        disposers.push(() => { if (mframe && mframe.isConnected) mframe.remove(); mframe = null; });
        return mframe;
      };
      const snapIn = (frame, html) => {
        const d = frame.contentDocument;
        d.open(); d.write(html); d.close(); // document.write 是同步的，写完即可量几何
        const out = {};
        d.querySelectorAll('[data-loc]').forEach(el => {
          try {
            if (el.getAnimations && el.getAnimations().some(a => a.playState === 'running')) return;
            const r = el.getBoundingClientRect();
            out[el.getAttribute('data-loc')] = { x: r.left, y: r.top, w: r.width, h: r.height, tag: el.tagName.toLowerCase() };
          } catch (e) {}
        });
        return out;
      };
      return function measure(ctx) {
        try {
          const f = ensure();
          f.style.width = (iframe.clientWidth || 1024) + 'px'; // 与编辑视口同宽，布局才一致
          // 改动前的快照按源缓存：连续多次小改不必每次都重渲染一遍"前"
          if (cache.src !== ctx.source) { cache = { src: ctx.source, map: snapIn(f, instrument(ctx.source)) }; }
          const parsedAfter = parse(ctx.newSource);
          const after = snapIn(f, instrument(ctx.newSource, parsedAfter));
          return collateral(cache.map, after, ctx.target.loc, parsedAfter);
        } catch (e) { return null; }
      };
    },

    // 色灯/波及展示：把 affected 里的元素用橙色框闪一下（移植 demo/core.js WB.flash）
    showAffected(markers, color) {
      if (!ui || !markers) return;
      ui.flash.innerHTML = '';
      markers.forEach(mk => {
        const el = mk.loc != null ? byLoc(mk.loc) : mk.selector ? doc.querySelector(mk.selector) : null;
        if (!el) return;
        const i = doc.createElement('i');
        place(i, pageRect(el), 1);
        if (color) i.style.borderColor = color;
        ui.flash.appendChild(i);
      });
      clearTimeout(session._ft);
      session._ft = setTimeout(() => { if (ui) ui.flash.innerHTML = ''; }, 2600);
    },

    // 纯视觉预览（键盘微调等场景）：只改显示层的 translate，不写源码
    previewTranslate(target, x, y) {
      const el = typeof target === 'number' ? byLoc(target)
        : typeof target === 'string' ? (state.parsed.bySelector(target) && byLoc(state.parsed.bySelector(target).loc))
        : target;
      if (el) el.style.translate = Math.round(x) + 'px ' + Math.round(y) + 'px';
      return el;
    },
    clearPreview(target) {
      const el = typeof target === 'number' ? byLoc(target)
        : typeof target === 'string' ? (state.parsed.bySelector(target) && byLoc(state.parsed.bySelector(target).loc))
        : target;
      if (el && el.style) el.style.translate = '';
    },

    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      while (bound.length) { const [t, type, fn, opt] = bound.pop(); t.removeEventListener(type, fn, opt); }
      disposers.forEach(fn => { try { fn(); } catch (e) {} });
      clearTimeout(session._ft);
    }
  };

  // 波及对比：before/after 为 snapRects 快照，排除目标自身与祖先/子孙；祖先后代都被挤时只留祖先
  function collateral(before, after, targetLoc, parsed) {
    const skip = new Set();
    if (targetLoc != null && parsed.elements[targetLoc]) {
      skip.add(targetLoc);
      for (let p = parsed.elements[targetLoc].parent; p != null; p = parsed.elements[p].parent) skip.add(p);
      parsed.elements.forEach(e => {
        for (let p = e.parent; p != null; p = parsed.elements[p].parent) {
          if (p === targetLoc) { skip.add(e.loc); break; }
        }
      });
    }
    const isAnc = (a, b) => { for (let p = parsed.elements[b] && parsed.elements[b].parent; p != null; p = parsed.elements[p].parent) if (p === a) return true; return false; };
    const moved = [];
    Object.keys(before).forEach(k => {
      const loc = +k, a = before[k], b = after[k];
      if (!b || skip.has(loc) || a.tag !== b.tag) return; // tag 变了说明行号错位，保守不计
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1 || Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1) {
        const e = parsed.elements[loc];
        moved.push({
          loc, selector: e ? e.selector : null, line: e ? e.line : null, tag: e ? e.tag : null,
          dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y), note: '被挤动（排版让位）'
        });
      }
    });
    return moved.filter(m => !moved.some(o => o !== m && isAnc(o.loc, m.loc)));
  }

  return first;
}

export default render;
