// 编辑视图：真实桌面视口里的页面 + 覆盖层交互。三个基础工具互不干扰：
//   交互（I）= 像真实浏览一样点按钮、开弹窗、填表单；选择（V）= 点选/拖动/缩放；文字（T）= 点哪改哪。
import { createStage } from '../core/stage.js';
import { getViewport, onViewportChange } from '../core/viewport.js';
import { createFrame } from '../engine/frame.js';
import { applyEdit } from '../engine/writeback.js';
import { createOverlay } from './overlay.js';
import { startMove, startResize, CONTAINERS } from './drag.js';
import { startTextEdit } from './text.js';
import { buildChrome, showVerdict, hideVerdict, openContextMenu, renderCrumbs } from './chrome.js';
import { renderInspector } from './inspector.js';
import { attachDoc, bindKey, isSpaceDown } from '../core/keys.js';
import { toast } from '../core/ui.js';

const BASE_TOOLS = [
  { id: 'interact', label: '交互', tip: '交互：像真实浏览一样点按钮、开弹窗、填表单', icon: 'hand', kbd: 'I', cls: 'passthru' },
  { id: 'select', label: '选择', tip: '选择：点选、拖动、拖手柄缩放', icon: 'select', kbd: 'V', cls: 't-select' },
  { id: 'text', label: '文字', tip: '文字：点文字直接改；点空白处新建文本框', icon: 'text', kbd: 'T', cls: 't-text' },
];

export function createEditor(app) {
  const { bus, api } = app;
  const ed = {
    app, stage: null, frame: null, ov: null, host: null, page: null,
    tool: 'select', tools: new Map(BASE_TOOLS.map((t) => [t.id, t])),
    sel: null, selSelector: null, hoverEl: null, dragging: false, textEditing: false, measure: null,
  };
  let raf = 0, offVp = null, nudge = null;

  // ---------- 几何与命中 ----------
  ed.pageRect = (e) => {
    const r = e.getBoundingClientRect(), w = ed.frame.win;
    return { x: r.left + w.scrollX, y: r.top + w.scrollY, w: r.width, h: r.height };
  };
  ed.toPage = (cx, cy) => {
    const d = ed.stage.toDevice(cx, cy), w = ed.frame.win;
    return { x: d.x + (w ? w.scrollX : 0), y: d.y + (w ? w.scrollY : 0) };
  };
  ed.pickAt = (cx, cy) => {
    const d = ed.stage.toDevice(cx, cy), doc = ed.frame.doc;
    if (!doc) return null;
    const n = doc.elementFromPoint(d.x, d.y);
    return n && n.tagName !== 'HTML' && n.tagName !== 'BODY' ? n : null;
  };
  ed.textOwnerAt = (cx, cy) => {
    const d = ed.stage.toDevice(cx, cy), doc = ed.frame.doc;
    const r = doc && doc.caretRangeFromPoint ? doc.caretRangeFromPoint(d.x, d.y) : null;
    const n = r && r.startContainer;
    if (!n || n.nodeType !== 3 || !n.data.trim()) return null;
    return { owner: ed.frame.owner(n.parentElement), pt: d };
  };
  ed.selectorOf = (e) => { const loc = ed.frame.locOf(e); const p = loc != null && ed.frame.parsed.byLoc(loc); return p ? p.selector : null; };
  // 行内文字（em、a、span…）按浏览器规定不能单独挪动或缩放：拖它就拖它所在的整块
  const REPLACED = /^(img|svg|video|canvas|iframe|input|select|textarea|button|object|embed)$/i;
  ed.isInlineText = (e) => !REPLACED.test(e.tagName) && /^(inline|contents)$/.test(ed.frame.win.getComputedStyle(e).display);
  ed.movableOf = (e) => {
    let n = e;
    while (n && n.tagName !== 'BODY' && (!n.hasAttribute('data-cd-loc') || ed.isInlineText(n))) n = n.parentElement;
    return n && n.tagName !== 'BODY' ? n : e;
  };
  ed.isLocked = (info) => app.isLocked(info);

  ed.infoOf = (e) => {
    if (!e) return null;
    const loc = ed.frame.locOf(e);
    const p = loc != null ? ed.frame.parsed.byLoc(loc) : null;
    const text = (e.textContent || '').trim();
    if (!p) return { generated: true, loc: null, selector: null, tag: e.tagName.toLowerCase(), text: text.slice(0, 80), element: e };
    return {
      generated: false, loc, selector: p.selector, tag: p.tag, type: p.type, line: p.line, endLine: p.endLine,
      textOnly: p.textOnly, text: text.slice(0, 200), hasText: !!text, style: p.style, classes: p.classes,
      sharedClass: p.sharedClass, transformAnim: p.transformAnim, jsDynamic: p.jsDynamic, element: e,
    };
  };
  ed.describe = (info) => {
    if (!info) return '';
    const t = info.text ? `「${info.text.length > 14 ? info.text.slice(0, 14) + '…' : info.text}」` : '';
    return `<${info.tag}>${t}` + (info.generated ? '（程序生成）' : `（第 ${info.line} 行）`);
  };

  // ---------- 选中 ----------
  ed.select = (target) => {
    let e = target;
    if (typeof target === 'number') e = ed.frame.elByLoc(target);
    else if (typeof target === 'string') { const p = ed.frame.parsed.bySelector(target); e = p ? ed.frame.elByLoc(p.loc) : null; }
    ed.sel = e || null;
    ed.selSelector = e ? ed.selectorOf(e) : null;
    const info = ed.selection;
    renderInspector(ed, info);
    renderCrumbs(ed);
    bus.emit('select', info);
  };
  Object.defineProperty(ed, 'selection', { get: () => (ed.sel && ed.sel.isConnected ? ed.infoOf(ed.sel) : null) });
  ed.clearSelection = () => ed.select(null);
  ed.selectParent = () => {
    if (!ed.sel) return;
    let p = ed.sel.parentElement;
    while (p && p.tagName !== 'BODY' && !p.hasAttribute('data-cd-loc')) p = p.parentElement;
    if (p && p.tagName !== 'BODY') ed.select(p);
  };
  ed.selectSibling = (dir) => {
    if (!ed.sel) return;
    const sibs = [...ed.sel.parentElement.children].filter((c) => c.hasAttribute('data-cd-loc') || c === ed.sel);
    const i = sibs.indexOf(ed.sel);
    const n = sibs[(i + dir + sibs.length) % sibs.length];
    if (n) ed.select(n);
  };
  ed.selectChild = () => {
    const c = ed.sel && [...ed.sel.children].find((x) => x.hasAttribute('data-cd-loc'));
    if (c) ed.select(c);
  };

  // ---------- 工具 ----------
  ed.registerTool = (t) => { ed.tools.set(t.id, t); if (ed.chrome) ed.chrome.renderDock(); };
  ed.setTool = (id) => {
    if (!ed.tools.has(id)) return;
    if (ed.textEditing && ed.commitTextEdit) ed.commitTextEdit();
    const prev = ed.tools.get(ed.tool);
    if (prev && prev.deactivate) prev.deactivate(ed);
    ed.tool = id;
    const t = ed.tools.get(id);
    if (ed.ov) {
      ed.ov.setTool(t.cls || 't-draw');
      ed.ov.hide(ed.ov.hover);
    }
    if (t.activate) t.activate(ed);
    if (ed.chrome) ed.chrome.syncDock();
    ed.setHint(id === 'interact' ? '交互模式：页面和真实浏览一样可以点、可以滚、能打开弹窗 · 按 <b>V</b> 回到选择' : '');
  };
  ed.setHint = (h) => app.setHint(h);

  // ---------- 渲染与页面 ----------
  ed.rerender = () => ed.frame && ed.frame.render(ed.frame.source);
  function projectFileOf(href) {
    try {
      const u = new URL(href, location.href);
      const pre = `/preview/${encodeURIComponent(app.project().id)}/`;
      if (u.origin !== location.origin || !u.pathname.startsWith(pre)) return null;
      const f = decodeURIComponent(u.pathname.slice(pre.length));
      return app.project().pages.some((p) => p.file === f) ? { file: f, hash: u.hash } : null;
    } catch { return null; }
  }
  function onRendered() {
    const doc = ed.frame.doc, win = ed.frame.win;
    attachDoc(doc);
    doc.addEventListener('click', (e) => {
      if (ed.tool !== 'interact') return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (/^javascript:/i.test(href)) return;
      e.preventDefault();
      if (href.startsWith('#')) {
        const t = href.length > 1 && doc.getElementById(decodeURIComponent(href.slice(1)));
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); else win.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const hit = projectFileOf(new URL(href, doc.baseURI).href);
      if (hit) { if (hit.file !== ed.page) app.openPage(hit.file); return; }
      toast('这是外部链接或不在项目里的页面：' + href + '（放映时可以真实打开）', '', 3600);
    }, true);
    win.addEventListener('submit', (e) => { if (!e.defaultPrevented) { e.preventDefault(); toast('表单已提交（编辑时不会真的跳转）'); } });
    if (ed.selSelector) {
      const p = ed.frame.parsed.bySelector(ed.selSelector);
      ed.sel = p ? ed.frame.elByLoc(p.loc) : null;
    } else ed.sel = null;
    renderInspector(ed, ed.selection);
    renderCrumbs(ed);
    bus.emit('rendered');
  }

  ed.openPage = async (file) => {
    if (!ed.stage) return;
    const proj = app.project();
    let src;
    try { src = await api.readFile(proj.id, file); } catch { return; }
    if (ed.page !== file) { ed.sel = null; ed.selSelector = null; }
    ed.page = file;
    app.state.page = file;
    if (ed.frame) ed.frame.destroy();
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    ed.frame = createFrame(ed.stage.device, {
      baseHref: `/preview/${encodeURIComponent(proj.id)}/${dir}`,
      onReady: onRendered,
      onNavigate: (href) => {
        const hit = projectFileOf(href);
        if (hit && hit.file !== ed.page) app.openPage(hit.file);
        else { ed.rerender(); if (!hit) toast('页面尝试跳转到项目外的地址，已留在当前页'); }
      },
    });
    ed.stage.device.appendChild(ed.ov.root);
    ed.measure = ed.frame.makeMeasure(() => ed.stage.size);
    hideVerdict(ed);
    await ed.frame.render(src, { keepScroll: false });
    ed.chrome.syncLabel();
    app.syncViewSwitch();
    bus.emit('page', file);
  };

  // ---------- 写回命令（全部走命令总线，可撤销） ----------
  ed.doSource = async ({ label, build, silent }) => {
    const page = ed.page, before = ed.frame.source, pid = app.project().id;
    let res;
    try { res = build(before); } catch (e) { console.error(e); toast('这次修改没能生成', 'err'); return { ok: false }; }
    if (!res || res.light === 'red') { if (res && !res.unchanged) showVerdict(ed, res, { label }); return { ok: false, red: true, result: res }; }
    const after = res.newSource;
    const scroll = { x: ed.frame.win.scrollX, y: ed.frame.win.scrollY };
    const sync = async (src) => {
      await api.writeFile(pid, page, src);
      if (ed.frame && ed.page === page) await ed.frame.render(src, { scroll });
      bus.emit('source', page);
    };
    try {
      await bus.do({ label, page, apply: () => sync(after), revert: () => sync(before) });
    } catch { return { ok: false }; }
    if (!silent) showVerdict(ed, res, { label });
    return { ok: true, result: res };
  };
  const targetOf = (info) => (info.generated ? { generated: true, selector: info.selector, text: info.text } : info.loc);
  const DUP_REASON = '浏览器在这里自动修正了原代码里交叉嵌套的标签（复制出了一份元素），这一块和代码对不上号，没法直接写回。可以记成草图标记交给 AI，顺便请它把这里的标签理顺。';
  const dupRes = () => ({ light: 'red', reason: DUP_REASON });
  ed.runEdit = (label, edit) => ed.doSource({ label, build: (src) => (typeof edit.target === 'number' && ed.frame.isDup(edit.target) ? dupRes() : applyEdit(src, edit, { measure: ed.measure })) });
  ed.commitMove = async (info, dx, dy, restore) => {
    const r = await ed.runEdit(`移动 <${info.tag}>（${dx}, ${dy}）`, { kind: 'move', target: targetOf(info), dx, dy, crossed: false });
    if (!r.ok) restore();
  };
  ed.onMoveCrossed = (info, dx, dy) => {
    const res = applyEdit(ed.frame.source, { kind: 'move', target: targetOf(info), dx, dy, crossed: true });
    if (app.sketch) app.sketch.addMoveArrow(info, dx, dy);
    showVerdict(ed, { ...res, reason: (res.reason || '') + ' 你想挪到哪里，已经画成一条箭头草图标记。' }, { label: '移动', auto: true });
  };
  ed.commitStyle = async (info, props, label, restore) => {
    const r = await ed.runEdit(label, { kind: 'style', target: targetOf(info), props });
    if (!r.ok && restore) restore();
    return r;
  };
  ed.applyStyle = (props, label) => { const info = ed.selection; if (!info) return; if (ed.isLocked(info)) { toast('这个元素已锁定', 'err'); return; } return ed.commitStyle(info, props, label); };
  ed.commitText = (changes) => ed.doSource({
    label: changes.length === 1 ? `改字：「${changes[0].oldText.trim().slice(0, 8)}」→「${changes[0].newText.trim().slice(0, 8)}」` : `改字（${changes.length} 处）`,
    build: (src) => {
      if (changes.some((c) => ed.frame.isDup(c.loc))) return dupRes();
      let cur = src, last = null;
      for (let i = changes.length - 1; i >= 0; i--) {
        const c = changes[i];
        const r = applyEdit(cur, { kind: 'textNode', target: c.loc, index: c.index, oldText: c.oldText, newText: c.newText });
        if (r.light === 'red') return r;
        cur = r.newSource;
        last = r;
      }
      let affected = null;
      try { affected = ed.measure({ source: src, newSource: cur, target: { loc: changes[0].loc } }); } catch { /* 忽略 */ }
      return { ...last, newSource: cur, light: affected && affected.length ? 'yellow' : 'green', affected: affected && affected.length ? affected : undefined };
    },
  });
  ed.editTextOf = (e, pt) => {
    const info = ed.infoOf(e);
    if (!info) return;
    if (info.generated) { showVerdict(ed, applyEdit(ed.frame.source, { kind: 'text', target: { generated: true, text: info.text }, newText: 'x' }), { label: '改字' }); return; }
    if (ed.frame.isDup(info.loc)) { ed.select(e); showVerdict(ed, dupRes(), { label: '改字' }); return; }
    if (ed.isLocked(info)) { toast('这个元素已锁定，先解锁再改', 'err'); return; }
    if (!info.hasText) { toast('这里没有可以改的文字', 'err'); return; }
    ed.select(e);
    startTextEdit(ed, e, pt);
  };
  ed.deleteSelection = () => {
    const info = ed.selection;
    if (!info) return;
    if (info.generated) { showVerdict(ed, { light: 'red', reason: '这块内容由程序生成，代码里没有它自己的一段，没法直接删。可以记成草图标记交给 AI。' }, { label: '删除' }); return; }
    if (ed.isLocked(info)) { toast('这个元素已锁定', 'err'); return; }
    const p = ed.frame.parsed.byLoc(info.loc);
    ed.sel = null; ed.selSelector = null;
    ed.doSource({
      label: `删除 <${p.tag}>（第 ${p.line} 行）`, silent: true,
      build: (src) => {
        let s = p.openStart, e = p.closeEnd;
        const ls = src.lastIndexOf('\n', s - 1) + 1;
        let le = src.indexOf('\n', e); if (le < 0) le = src.length;
        if (!/\S/.test(src.slice(ls, s)) && !/\S/.test(src.slice(e, le))) { s = ls; e = Math.min(le + 1, src.length); }
        return { light: 'green', newSource: src.slice(0, s) + src.slice(e), line: p.line };
      },
    }).then((r) => { if (r.ok) toast(`已删除 <${p.tag}>，下面的内容会自动补位 · Ctrl+Z 可撤销`, 'ok', 3200); renderInspector(ed, null); renderCrumbs(ed); });
  };
  ed.addTextBoxAt = (cx, cy) => {
    const hitEl = ed.pickAt(cx, cy);
    const cont = hitEl && (hitEl.closest(CONTAINERS) || hitEl.closest('div[data-cd-loc]'));
    if (!cont || !cont.hasAttribute('data-cd-loc')) { toast('请点在页面的某个区域里面', 'err'); return; }
    if (app.pageLocked(ed.page)) { toast('本页已锁定', 'err'); return; }
    const win = ed.frame.win;
    let ref = cont;
    while (ref && ref.tagName !== 'BODY' && win.getComputedStyle(ref).position === 'static') ref = ref.parentElement;
    const rr = ref ? ed.pageRect(ref) : { x: 0, y: 0 };
    const p = ed.toPage(cx, cy);
    const x = Math.round(p.x - rr.x - (ref ? ref.clientLeft : 0)), y = Math.round(p.y - rr.y - (ref ? ref.clientTop : 0));
    const ci = ed.frame.parsed.byLoc(ed.frame.locOf(cont));
    ed.doSource({
      label: '新建文本框',
      build: (src) => {
        let ls = src.lastIndexOf('\n', ci.closeStart - 1) + 1;
        let indent = src.slice(ls, ci.closeStart);
        if (/\S/.test(indent)) { ls = ci.closeStart; indent = ''; }
        const html = `<p style="position: absolute; left: ${x}px; top: ${y}px; margin: 0; z-index: 5;">双击这里改字</p>`;
        return { light: 'yellow', newSource: src.slice(0, ls) + indent + '  ' + html + '\n' + src.slice(ls), line: ci.line, note: '新文本框浮在区域上方（不挤动别人），可能盖住下面的内容；换成手机宽度时位置可能要再调。', affected: [] };
      },
    }).then((r) => {
      if (!r.ok) return;
      const ps = [...ed.frame.doc.querySelectorAll('p[data-cd-loc]')].filter((n) => n.textContent === '双击这里改字');
      const n = ps[ps.length - 1];
      if (n) { ed.select(n); ed.setTool('select'); setTimeout(() => startTextEdit(ed, n, null), 60); }
    });
  };

  // ---------- 键盘微调（连续按合并成一步撤销） ----------
  ed.nudge = (dx, dy) => {
    let info = ed.selection;
    if (!info) return;
    const blk = ed.movableOf(info.element);
    if (blk !== info.element) { ed.select(blk); info = ed.selection; toast(`行内文字不能单独挪动，改为挪动它所在的 <${info.tag}>`, '', 2600); }
    if (ed.isLocked(info)) { toast('这个元素已锁定', 'err'); return; }
    const e = info.element;
    if (!nudge || nudge.el !== e) { if (nudge) flushNudge(); nudge = { el: e, info, dx: 0, dy: 0, inline0: e.style.translate, t0: String(e.style.translate || '0 0').split(/\s+/).map(parseFloat) }; }
    nudge.dx += dx; nudge.dy += dy;
    e.style.translate = `${(nudge.t0[0] || 0) + nudge.dx}px ${(nudge.t0[1] || 0) + nudge.dy}px`;
    clearTimeout(nudge.timer);
    nudge.timer = setTimeout(flushNudge, 420);
    ed.setHint(`微调 → ${nudge.dx}　↓ ${nudge.dy}（松开方向键后写回）`);
  };
  function flushNudge() {
    const n = nudge; nudge = null;
    if (!n) return;
    clearTimeout(n.timer);
    ed.setHint('');
    if (!n.dx && !n.dy) return;
    ed.commitMove(n.info, n.dx, n.dy, () => { n.el.style.translate = n.inline0; });
  }

  // ---------- 覆盖层事件 ----------
  function onDown(e) {
    if (e.target.closest('.sk-card')) return;   // 标记卡片里的输入框保持原生行为
    const act = document.activeElement;
    if (act && act !== document.body && !ed.textEditing) act.blur();   // 输入框、iframe 交还焦点，快捷键才作用在页面上
    if (e.button !== 0 || isSpaceDown() || ed.textEditing) return;
    const tool = ed.tools.get(ed.tool);
    if (tool.down) { e.preventDefault(); tool.down(e, ed); return; }
    const hd = e.target.closest('.hd');
    if (hd && ed.sel) { e.preventDefault(); e.stopPropagation(); startResize(ed, ed.selection, hd.dataset.hd, e); return; }
    if (e.target.closest('[data-act=parent]')) { e.preventDefault(); ed.selectParent(); return; }
    if (app.sketch && app.sketch.hitSelect(e, ed)) { e.preventDefault(); return; }
    e.preventDefault();
    if (ed.tool === 'text') {
      const t = ed.textOwnerAt(e.clientX, e.clientY);
      if (t && t.owner) ed.editTextOf(t.owner, t.pt);
      else ed.addTextBoxAt(e.clientX, e.clientY);
      return;
    }
    const hit = ed.pickAt(e.clientX, e.clientY);
    if (!hit) { ed.clearSelection(); return; }
    // 已选中一个外层块时，按住它里面任意处都能拖动整块；没拖动就当作点选里面那一层
    if (ed.sel && ed.sel !== hit && ed.sel.contains(hit)) { startMove(ed, ed.selection, e, () => ed.select(hit)); return; }
    if (hit !== ed.sel) ed.select(hit);
    startMove(ed, ed.selection, e);
  }
  function onDbl(e) {
    if (ed.tool !== 'select') return;
    const t = ed.textOwnerAt(e.clientX, e.clientY);
    if (t && t.owner) { ed.editTextOf(t.owner, t.pt); return; }
    const hit = ed.pickAt(e.clientX, e.clientY);
    if (hit) ed.editTextOf(ed.frame.owner(hit) || hit, null);
  }
  function onHover(e) {
    if (ed.dragging || ed.textEditing || ed.tool === 'interact' || !ed.frame) return;
    const t = ed.tools.get(ed.tool);
    if (t.down) { ed.hoverEl = null; return; }
    ed.hoverEl = ed.pickAt(e.clientX, e.clientY);
  }
  let smooth = null;
  function onWheel(e) {
    if (e.ctrlKey || e.metaKey || !ed.frame || !ed.frame.win) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    const hit = ed.pickAt(e.clientX, e.clientY);
    const win = ed.frame.win;
    for (let n = hit; n && n.nodeType === 1 && n.tagName !== 'BODY' && n.tagName !== 'HTML'; n = n.parentElement) {
      const cs = win.getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) {
        const before = n.scrollTop + n.scrollLeft;
        n.scrollBy({ left: dx, top: dy, behavior: 'instant' });
        if (n.scrollTop + n.scrollLeft !== before) return;
      }
    }
    if (!smooth) smooth = { x: win.scrollX, y: win.scrollY };
    const maxY = ed.frame.doc.documentElement.scrollHeight - win.innerHeight;
    const maxX = ed.frame.doc.documentElement.scrollWidth - win.innerWidth;
    smooth.x = Math.max(0, Math.min(maxX, smooth.x + dx));
    smooth.y = Math.max(0, Math.min(maxY, smooth.y + dy));
    if (!smooth.run) {
      smooth.run = true;
      const step = () => {
        const w = ed.frame && ed.frame.win;
        if (!w || !smooth) return;
        const nx = w.scrollX + (smooth.x - w.scrollX) * 0.32, ny = w.scrollY + (smooth.y - w.scrollY) * 0.32;
        w.scrollTo({ left: Math.abs(smooth.x - nx) < 0.6 ? smooth.x : nx, top: Math.abs(smooth.y - ny) < 0.6 ? smooth.y : ny, behavior: 'instant' });
        if (Math.abs(w.scrollY - smooth.y) > 0.6 || Math.abs(w.scrollX - smooth.x) > 0.6) requestAnimationFrame(step);
        else smooth = null;
      };
      requestAnimationFrame(step);
    }
  }
  function onContext(e) {
    e.preventDefault();
    if (ed.tool === 'interact' || ed.textEditing) return;
    if (app.sketch && app.sketch.hitContext(e, ed)) return;
    const hit = ed.pickAt(e.clientX, e.clientY);
    if (hit && hit !== ed.sel) ed.select(hit);
    openContextMenu(ed, e.clientX, e.clientY, !!hit);
  }

  // ---------- 每帧：覆盖层跟随页面滚动、动画 ----------
  function loop() {
    raf = requestAnimationFrame(loop);
    const f = ed.frame, ov = ed.ov;
    if (!f || !f.win || !ov) return;
    ov.setScroll(f.win.scrollX, f.win.scrollY);
    const s = ed.sel;
    if (s && s.isConnected && ed.tool !== 'interact') {
      const r = ed.pageRect(s);
      ov.place(ov.sel, r);
      const gen = !s.hasAttribute('data-cd-loc');
      const info = gen ? null : f.parsed.byLoc(f.locOf(s));
      const locked = app.isLocked(gen ? null : { generated: false, selector: info && info.selector });
      ov.sel.classList.toggle('gen', gen);
      ov.sel.classList.toggle('locked', !!locked);
      ov.sel.classList.toggle('inline', ed.isInlineText(s));
      const label = gen ? `<${s.tagName.toLowerCase()}> 程序生成` : `<${info.tag}> · 第 ${info.line} 行${locked ? ' · 已锁定' : ''}`;
      if (ov.tag.textContent !== label) ov.tag.textContent = label;
      const size = `${Math.round(r.w)} × ${Math.round(r.h)}`;
      if (ov.size.textContent !== size) ov.size.textContent = size;
    } else ov.hide(ov.sel);
    const h = ed.hoverEl;
    if (h && h.isConnected && h !== s && !ed.dragging && ed.tool !== 'interact') {
      ov.place(ov.hover, ed.pageRect(h));
      ov.hover.classList.toggle('gen', !h.hasAttribute('data-cd-loc'));
    } else ov.hide(ov.hover);
    if (app.sketch) app.sketch.tick(ed);
  }

  // ---------- 进出视图 ----------
  ed.enter = async (wrap) => {
    ed.host = document.createElement('div');
    ed.host.className = 'stage-host';
    wrap.appendChild(ed.host);
    const vp = getViewport();
    ed.stage = createStage(ed.host, { onChange: () => ed.chrome && ed.chrome.syncLabel() });
    ed.stage.setSize(vp.w, vp.h);
    ed.ov = createOverlay(ed.stage.device);
    ed.ov.root.addEventListener('pointerdown', onDown);
    ed.ov.root.addEventListener('pointermove', onHover);
    ed.ov.root.addEventListener('pointerleave', () => { ed.hoverEl = null; });
    ed.ov.root.addEventListener('dblclick', onDbl);
    ed.ov.root.addEventListener('contextmenu', onContext);
    ed.ov.root.addEventListener('wheel', onWheel, { passive: false });
    ed.chrome = buildChrome(ed, wrap);
    offVp = onViewportChange((v) => { ed.stage.setSize(v.w, v.h); ed.stage.fit(true); ed.chrome.syncLabel(); });
    ed.setTool(ed.tools.has(ed.tool) ? ed.tool : 'select');
    loop();
    const file = app.state.page && app.project().pages.some((p) => p.file === app.state.page) ? app.state.page : (app.project().pages[0] || {}).file;
    if (file) await ed.openPage(file);
  };
  ed.leave = () => {
    if (nudge) flushNudge();
    if (ed.textEditing && ed.commitTextEdit) ed.commitTextEdit();
    cancelAnimationFrame(raf);
    if (offVp) offVp();
    if (ed.frame) ed.frame.destroy();
    if (ed.stage) ed.stage.destroy();
    ed.frame = ed.stage = ed.ov = ed.chrome = ed.host = null;
    ed.sel = null; ed.hoverEl = null;
    renderInspector(ed, null, true);
  };

  // ---------- 快捷键 ----------
  const inEdit = () => app.state.view === 'edit' && !!ed.frame && !ed.textEditing;
  const G = '编辑';
  BASE_TOOLS.forEach((t) => bindKey(t.kbd, { label: t.label + '工具', group: '工具', when: inEdit, run: () => ed.setTool(t.id) }));
  bindKey('Esc', { hidden: true, when: inEdit, run: () => {
    if (ed.sel) { ed.clearSelection(); return; }
    if (ed.tool !== 'select') { ed.setTool('select'); return; }
    return false;
  } });
  bindKey(['Delete', 'Backspace'], { label: '删除选中元素', group: G, when: () => inEdit() && !!ed.sel, run: () => ed.deleteSelection() });
  bindKey('Enter', { label: '改选中元素的文字', group: G, when: () => inEdit() && !!ed.sel, run: () => ed.editTextOf(ed.sel, null) });
  bindKey('Shift+Enter', { label: '选择外面一层（父级）', group: G, when: () => inEdit() && !!ed.sel, run: () => ed.selectParent() });
  bindKey('Tab', { label: '选下一个同级元素', group: G, when: () => inEdit() && !!ed.sel, run: () => ed.selectSibling(1) });
  bindKey('Shift+Tab', { label: '选上一个同级元素', group: G, when: () => inEdit() && !!ed.sel, run: () => ed.selectSibling(-1) });
  [['↑', 0, -1], ['↓', 0, 1], ['←', -1, 0], ['→', 1, 0]].forEach(([k, x, y]) => {
    bindKey(k, { label: '微调 1 像素', group: G, hidden: k !== '↑', when: () => inEdit() && !!ed.sel, run: () => ed.nudge(x, y) });
    bindKey('Shift+' + k, { label: '微调 10 像素', group: G, hidden: k !== '↑', when: () => inEdit() && !!ed.sel, run: () => ed.nudge(x * 10, y * 10) });
  });
  bindKey('Ctrl+Shift+L', { label: '锁定 / 解锁选中元素', group: G, when: () => inEdit() && !!ed.sel, run: () => { const i = ed.selection; if (i && !i.generated) app.setElementLock(ed.page, i.selector, !app.elementLocked(ed.page, i.selector)).then(() => renderInspector(ed, ed.selection)); } });
  bindKey('Shift+1', { label: '适应屏幕', group: '视图', when: () => app.state.view === 'edit', run: () => ed.stage.fit(true) });
  bindKey(['Ctrl+0', 'Shift+0'], { label: '实际大小 100%', group: '视图', when: () => app.state.view === 'edit', run: () => ed.stage.actual() });
  bindKey(['Ctrl++', 'Ctrl+Shift++'], { label: '放大', group: '视图', when: () => app.state.view === 'edit', run: () => ed.stage.zoomIn() });
  bindKey('Ctrl+-', { label: '缩小', group: '视图', when: () => app.state.view === 'edit', run: () => ed.stage.zoomOut() });

  return ed;
}
