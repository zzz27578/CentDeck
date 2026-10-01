/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 总览：所有页面按真实桌面视口摊在无限画布上。连线从"具体的按钮/链接"连到目标页；
// 弹窗等子页面画成挂在主页面下方的小卡片（虚线连到打开它的按钮）；长页面可展开成一格格的屏幕分镜。
import { icon } from '../core/icons.js';
import { el, esc, clamp, toast, showMenu, promptDlg, confirmDlg } from '../core/ui.js';
import { bindKey, isSpaceDown } from '../core/keys.js';
import { getViewport } from '../core/viewport.js';
import { instrument, parse } from '../engine/parse.js';
import { withBase } from '../engine/frame.js';
import { scanPage } from './scan.js';
import { createCanvasTools } from './canvas-tools.js';
import { onViewportChange } from '../core/viewport.js';
import { renderPageStructure } from '../panels/layers.js';
import { createStyleCard } from './design-boards.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const SUB = 0.42;                 // 子页面卡片相对主页面的比例

export function createOverview(app) {
  const { bus } = app;
  let host = null, world = null, svg = null, cam = { x: 0, y: 0, z: 0.2 }, pages = [], selected = null, raf = 0;
  let linkMode = localStorage.getItem('cd.ovLinks') || 'main', showSubs = localStorage.getItem('cd.ovSubs') !== '0';
  let VW = 1920, VH = 969;
  const byFile = (f) => pages.find((p) => p.file === f);
  let offVp = null, generation = 0, flight = 0;
  const tctx = {
    host: null, world: null, cam: () => cam, sampleColor, select: (f) => select(f), redraw: () => { drawLinks(); styleCard.drawLinks(); tools.syncNotes(); },
    toWorld: (x, y) => { const r = host.getBoundingClientRect(); return { x: (x - r.left - cam.x) / cam.z, y: (y - r.top - cam.y) / cam.z }; },
    cards: () => pages.flatMap((p) => [{ file: p.file, title: p.title, x: p.x, y: p.y, w: VW, h: cardH(p), scale: 1 },
      ...subs(p).map((pop, i) => { const sp = subPos(p, i); return { file: p.file, title: p.title, popup: pop.title, x: sp.x, y: sp.y, w: VW * SUB, h: VH * SUB, scale: SUB }; })]),
  };
  function sampleColor(x, y) {
    const pt = tctx.toWorld(x, y);
    const p = pages.find(p => pt.x >= p.x && pt.x <= p.x + VW && pt.y >= p.y && pt.y <= p.y + cardH(p));
    if (!p) return null;
    const f = p.body.querySelector('iframe');
    try {
      const d = f.contentDocument, w = f.contentWindow;
      let n = d.elementFromPoint(pt.x - p.x, (pt.y - p.y) % VH);
      let value = n && n.childNodes.length && [...n.childNodes].some(x => x.nodeType === 3 && x.textContent.trim()) ? w.getComputedStyle(n).color : null;
      while (!value && n) { const bg = w.getComputedStyle(n).backgroundColor; if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') value = bg; n = n.parentElement; }
      const parts = (value || 'rgb(255,255,255)').match(/[\d.]+/g);
      return '#' + parts.slice(0,3).map(v => Math.round(+v).toString(16).padStart(2,'0')).join('');
    } catch { return null; }
  }
  const tools = createCanvasTools(app, tctx);
  const styleCard = createStyleCard(app, tctx);
  // 弹窗子卡片的位置：默认排在所属页面下方，拖动后记住偏移
  const subKey = (pop) => pop.id || pop.title;
  function subPos(p, i) {
    const pop = p.scan.popups[i];
    const o = ((layout()[p.file] || {}).subs || {})[subKey(pop)] || { dx: 0, dy: 0 };
    return { x: p.x + i * (VW * SUB + 60) + o.dx, y: p.y + cardH(p) + 150 + o.dy };
  }
  const base = (file) => `/preview/${encodeURIComponent(app.project().id)}/${file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''}`;
  const layout = () => { const p = app.project(); if (!p.canvas || typeof p.canvas !== 'object') p.canvas = {}; return p.canvas; };

  // ---------- 相机 ----------
  function applyCam() {
    if (!world) return;
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    host.style.setProperty('--inv', 1 / cam.z);
    const zv = host.parentElement && host.parentElement.querySelector('.zoom-val');
    if (zv) zv.textContent = Math.round(cam.z * 100) + '%';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { drawLinks(); styleCard.drawLinks(); });
  }
  function flyTo(target, ms = 320) {
    const from = { ...cam }, t0 = performance.now(), myFlight = ++flight;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { cam = target; applyCam(); return; }
    const step = (t) => {
      if (!host || myFlight !== flight) return;
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      cam = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, z: from.z + (target.z - from.z) * e };
      applyCam();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function fitRect(r, pad = 70, maxZ = 1) {
    const W = host.clientWidth, H = host.clientHeight;
    const z = clamp(Math.min((W - pad * 2) / r.w, (H - pad * 2) / r.h), 0.03, maxZ);
    return { z, x: W / 2 - (r.x + r.w / 2) * z, y: H / 2 - (r.y + r.h / 2) * z };
  }
  function bounds(list = pages) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    list.forEach((p) => { const b = blockRect(p); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y - 60); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); });
    styleCard.bounds().forEach(b=>{x1=Math.min(x1,b.x);y1=Math.min(y1,b.y);x2=Math.max(x2,b.x+b.w);y2=Math.max(y2,b.y+b.h);});
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  const cardH = (p) => (p.expanded ? Math.max(VH, p.docH || VH) : VH);
  const subs = (p) => (showSubs ? p.scan.popups : []);
  function blockRect(p) {
    const n = subs(p).length;
    const w = Math.max(VW, n * (VW * SUB + 60) - 60);
    return { x: p.x, y: p.y, w, h: cardH(p) + (n ? VH * SUB + 160 : 0) };
  }

  // ---------- 自动排版：按跳转关系从首页往外一列一列摆 ----------
  function autoLayout(force) {
    const L = layout();
    const depth = new Map();
    const first = pages[0];
    if (first) {
      depth.set(first.file, 0);
      const q = [first.file];
      while (q.length) {
        const f = q.shift(), p = byFile(f);
        const outs = [...new Set([...p.scan.links.filter((l) => !l.self && !l.nav).map((l) => l.to), ...p.scan.links.filter((l) => !l.self).map((l) => l.to), ...p.scan.redirects.map((r) => r.to)])];
        outs.forEach((t) => { if (!depth.has(t)) { depth.set(t, depth.get(f) + 1); q.push(t); } });
      }
    }
    let maxD = Math.max(0, ...depth.values());
    pages.forEach((p) => { if (!depth.has(p.file)) depth.set(p.file, ++maxD); });
    const colY = new Map();
    pages.forEach((p) => {
      const d = depth.get(p.file);
      const saved = L[p.file];
      if (!force && saved && typeof saved.x === 'number') { p.x = saved.x; p.y = saved.y; return; }
      const y = colY.get(d) || 0;
      p.x = d * (VW * 1.42);
      p.y = y;
      colY.set(d, y + blockRect(p).h + VH * 0.35);
    });
  }

  // ---------- 卡片 ----------
  function tileSrc(p, scrollY, openLoc) {
    const s = withBase(instrument(p.src, p.parsed), base(p.file), '<style>html{scroll-behavior:auto!important}</style>');
    const open = openLoc == null ? '' : `var e=document.querySelector('[data-cd-loc="${openLoc}"]');if(e){e.hidden=false;e.removeAttribute('hidden');if(e.tagName==='DIALOG'&&!e.open){try{e.showModal()}catch(x){e.setAttribute('open','')}}['open','show','active','is-open','is-active','visible'].forEach(function(c){e.classList.add(c)});if(getComputedStyle(e).display==='none')e.style.display='flex';e.style.visibility='visible';e.style.opacity='1';}`;
    return s + `<script>addEventListener('load',function(){try{${open}scrollTo(0,${Math.round(scrollY)})}catch(x){}});<\/script>`;
  }
  function makeTile(p, y, openLoc, onload) {
    const f = document.createElement('iframe');
    f.className = 'ov-tile';
    f.tabIndex = -1;
    f.style.cssText = `width:${VW}px;height:${VH}px;top:${y}px`;
    f.srcdoc = tileSrc(p, y, openLoc);
    if (onload) f.onload = () => onload(f);
    return f;
  }
  function buildCard(p) {
    const card = el(i18nTpl`<div class="ov-card" data-file="${esc(p.file)}">
      <div class="ov-title"><b>${esc(p.title)}</b><span class="ov-file">${esc(p.file)}</span>
        ${p.scan.popups.length ? i18nTpl`<span class="chip blue">${icon('popup', 11)}${p.scan.popups.length} 个弹窗</span>` : ''}
        <span class="chip">${p.scan.sections.length} 个版块</span>
        <button data-a="expand" class="ov-tbtn" data-tip="${p.expanded ? i18nText('收起到首屏') : i18nText('展开全长（一格一屏）')}">${icon(p.expanded ? 'collapse' : 'expand', 13)}${p.expanded ? i18nText('收起') : i18nText('展开全长')}</button>
        <button data-a="choose" class="ov-tbtn" data-tip="加入或移出选定页面">${icon('check',13)}选用</button><button data-a="edit" class="ov-tbtn" data-tip="进入编辑（双击卡片也行）">${icon('edit', 13)}编辑</button></div>
      <div class="ov-body"></div><div class="ov-mask"></div><div class="ov-marks"></div></div>`);
    const body = card.querySelector('.ov-body');
    body.appendChild(makeTile(p, 0, null, (f) => onFirstTile(p, f)));
    p.card = card;
    p.body = body;
    placeCard(p);
    world.insertBefore(card, svg);
    card.querySelector('[data-a=expand]').onclick = (e) => { e.stopPropagation(); toggleExpand(p); };
    card.querySelector('[data-a=edit]').onclick = (e) => { e.stopPropagation(); openEdit(p); };
    card.querySelector('[data-a=choose]').onclick = async e=>{e.stopPropagation();const proj=app.project(),old=proj.selectedPages||[],next=old.includes(p.file)?old.filter(f=>f!==p.file):[...old,p.file];await bus.doMeta({label:i18nText('挑选方案页面'),apply:()=>proj.selectedPages=next,revert:()=>proj.selectedPages=old});styleCard.refresh();};
    const title = card.querySelector('.ov-title');
    title.addEventListener('pointerdown', (e) => dragCard(e, p));
    card.addEventListener('pointerdown', (e) => { if (!e.target.closest('.ov-title')) dragCard(e,p); });
    card.addEventListener('dblclick', (e) => { if (tools.tool === 'pointer' && !e.target.closest('button')) openEdit(p); });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); select(p.file); cardMenu(p, e.clientX, e.clientY); });
    buildSubs(p);
  }
  function placeCard(p) {
    const c = p.card;
    c.style.left = p.x + 'px';
    c.style.top = p.y + 'px';
    c.style.width = VW + 'px';
    c.style.height = cardH(p) + 'px';
    c.classList.toggle('on', selected === p.file);
    c.querySelector('[data-a=choose]')?.classList.toggle('on',!!app.project().selectedPages?.includes(p.file));
    (p.subCards || []).forEach((s, i) => { const sp = subPos(p, i); s.style.left = sp.x + 'px'; s.style.top = sp.y + 'px'; });
  }
  function buildSubs(p) {
    (p.subCards || []).forEach((s) => s.remove());
    p.subCards = [];
    if (!showSubs) return;
    p.scan.popups.forEach((pop) => {
      const s = el(i18nTpl`<div class="ov-sub" style="width:${VW * SUB}px;height:${VH * SUB}px">
        <div class="ov-title sub">${icon('popup', 12)}<b>${esc(pop.title)}</b><span class="ov-file">弹窗 · ${esc(p.title)}</span></div>
        <div class="ov-body"></div><div class="ov-mask"></div></div>`);
      const t = makeTile(p, 0, pop.loc);
      t.style.transform = `scale(${SUB})`;
      t.style.transformOrigin = '0 0';
      s.querySelector('.ov-body').appendChild(t);
      s.addEventListener('pointerdown', (e) => dragSub(e, p, pop, s));
      s.addEventListener('dblclick', () => openEdit(p));
      s.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); select(p.file); showMenu([{ title: pop.title }, { label: i18nText('@ 引用这个弹窗到助手'), icon: 'at', onClick: () => refPage(p, pop.title) }, { label: i18nText('进入编辑'), icon: 'edit', onClick: () => openEdit(p) }], e.clientX, e.clientY); });
      world.insertBefore(s, svg);
      p.subCards.push(s);
    });
    placeCard(p);
  }
  function onFirstTile(p, f) {
    try {
      const d = f.contentDocument, w = f.contentWindow;
      p.docH = clamp(d.documentElement.scrollHeight, VH, 40000);
      p.rects = {};
      const want = new Set([...p.scan.links.map((l) => l.loc), ...p.scan.anchors.flatMap((a) => [a.loc, a.to]), ...p.scan.popups.flatMap((x) => [x.loc, ...x.triggers.map((t) => t.loc)]), ...p.scan.sections.map((s) => s.loc)]);
      want.forEach((loc) => {
        const n = d.querySelector(`[data-cd-loc="${loc}"]`);
        if (!n) return;
        const r = n.getBoundingClientRect();
        if (r.width || r.height) p.rects[loc] = { x: r.left + w.scrollX, y: r.top + w.scrollY, w: r.width, h: r.height };
      });
      if (p.expanded) buildTiles(p);
      if (p.scan.popups.some((x) => !x.triggers.length)) probe(p);
    } catch (e) { console.warn(e); }
    placeCard(p);
    drawLinks();
  }
  // 探测：在看不见的副本里逐个点按钮，看哪个弹窗出现了
  function probe(p) {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:-30000px;top:0;width:${VW}px;height:${VH}px;visibility:hidden`;
    f.srcdoc = tileSrc(p, 0, null);
    f.onload = () => {
      try {
        const d = f.contentDocument, w = f.contentWindow;
        w.alert = w.confirm = w.prompt = () => true;
        const pops = p.scan.popups.map((x) => ({ x, el: d.querySelector(`[data-cd-loc="${x.loc}"]`) })).filter((o) => o.el);
        const shown = (e) => { const cs = w.getComputedStyle(e); return !e.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().width > 0; };
        const snap = () => pops.map((o) => ({ o, hidden: o.el.hidden, cls: o.el.className, style: o.el.getAttribute('style') }));
        const clickables = [...d.querySelectorAll('button[data-cd-loc], a[data-cd-loc][href^="#"], [role=button][data-cd-loc], [onclick][data-cd-loc], input[type=button][data-cd-loc]')]
          .filter((c) => !pops.some((o) => o.el.contains(c))).slice(0, 60);
        const start = w.location.href;
        for (const c of clickables) {
          const before = snap();
          const was = pops.map((o) => shown(o.el));
          try { c.click(); } catch { /* 忽略 */ }
          if (w.location.href !== start) break;
          pops.forEach((o, i) => {
            if (!was[i] && shown(o.el) && !o.x.triggers.some((t) => t.loc === +c.getAttribute('data-cd-loc'))) o.x.triggers.push({ loc: +c.getAttribute('data-cd-loc'), text: (c.textContent || '').trim().slice(0, 30) });
          });
          before.forEach((s) => { s.o.el.hidden = s.hidden; s.o.el.className = s.cls; if (s.style == null) s.o.el.removeAttribute('style'); else s.o.el.setAttribute('style', s.style); });
        }
      } catch (e) { console.warn(e); }
      f.remove();
      const card = p.card && p.card.querySelector('.ov-body iframe');
      if (card) onFirstTile(p, card);
    };
    document.body.appendChild(f);
  }
  function buildTiles(p) {
    [...p.body.querySelectorAll('.ov-tile')].slice(1).forEach((t) => t.remove());
    if (!p.expanded) return;
    for (let y = VH; y < p.docH; y += VH) p.body.appendChild(makeTile(p, Math.min(y, p.docH - VH)));
  }
  function toggleExpand(p) {
    p.expanded = !p.expanded;
    const L = layout();
    L[p.file] = { ...(L[p.file] || { x: p.x, y: p.y }), expanded: p.expanded };
    bus.saveMeta();
    buildTiles(p);
    const b = p.card.querySelector('[data-a=expand]');
    b.innerHTML = icon(p.expanded ? 'collapse' : 'expand', 13) + (p.expanded ? i18nText('收起') : i18nText('展开全长'));
    placeCard(p);
    drawLinks();
  }
  function select(file) {
    selected = file;
    pages.forEach((q) => q.card && q.card.classList.toggle('on', q.file === file));
    drawLinks();
    bus.emit('ov-select', file);
  }
  function openEdit(p) {
    const r = { x: p.x, y: p.y, w: VW, h: VH };
    flyTo(fitRect(r, 20, 3), 260);
    setTimeout(() => app.openPage(p.file), 240);
  }
  function cardMenu(p, x, y) {
    showMenu([
      { title: p.title },
      { label: i18nText('@ 引用到助手'), icon: 'at', hint: i18nText('让 AI 知道你说的是这一页'), onClick: () => refPage(p) },
      { label: i18nText('进入编辑'), icon: 'edit', kbd: 'Enter', onClick: () => openEdit(p) },
      { label: i18nText('从这页开始放映'), icon: 'play', onClick: () => app.present(p.file) },
      '-',
      { label: p.expanded ? i18nText('收起到首屏') : i18nText('展开全长'), icon: p.expanded ? 'collapse' : 'expand', onClick: () => toggleExpand(p) },
      { label: i18nText('镜头对准这页'), icon: 'target', kbd: 'Shift+2', onClick: () => flyTo(fitRect(blockRect(p))) },
      '-',
      { label: app.pageLocked(p.file) ? i18nText('解锁这页') : i18nText('锁定这页'), icon: app.pageLocked(p.file) ? 'unlock' : 'lock', onClick: () => app.setPageLock(p.file, !app.pageLocked(p.file)) },
      { label: i18nText('删除这页…'), icon: 'trash', danger: true, onClick: () => removePage(p) },
    ], x, y);
  }
  function dragCard(e, p) {
    if (e.button !== 0 || tools.tool !== 'pointer' || isSpaceDown() || e.target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    select(p.file);
    const sx = e.clientX, sy = e.clientY, ox = p.x, oy = p.y;
    let moved = false;
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / cam.z, dy = (ev.clientY - sy) / cam.z;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      p.x = Math.round(ox + dx); p.y = Math.round(oy + dy);
      placeCard(p);
      drawLinks();
      styleCard.drawLinks();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      if (!moved) return;
      const L = layout(), old = L[p.file] ? { ...L[p.file] } : null, now = { ...(L[p.file] || {}), x: p.x, y: p.y };
      bus.doMeta({ label: i18nTpl`摆放页面「${p.title}」`, apply: () => { L[p.file] = now; }, revert: () => { if (old) L[p.file] = old; else delete L[p.file]; const q = byFile(p.file); if (q) { autoLayout(false); if (old) { q.x = old.x; q.y = old.y; } placeCard(q); drawLinks(); } } });
    };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
  }

  // ---------- 连线 ----------
  function trig(p, loc) {
    const r = p.rects && p.rects[loc];
    if (!r) return null;
    const h = cardH(p);
    return { x: p.x + r.x, y: p.y + Math.min(r.y, h - r.h - 4), w: r.w, h: r.h, clipped: r.y > h };
  }
  function curve(a, b, dir) {
    const dx = Math.max(160, Math.abs(b.x - a.x) * 0.45);
    return `M${a.x} ${a.y} C${a.x + dx * dir} ${a.y}, ${b.x - dx * dir} ${b.y}, ${b.x} ${b.y}`;
  }
  function addPath(d, cls, label, at) {
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'ov-link ' + cls);
    svg.appendChild(path);
    if (label && at && cam.z >= 0.35) {
      const g = el(`<div class="ov-label ${cls}" style="left:${at.x}px;top:${at.y}px">${label}</div>`);
      world.appendChild(g);
    }
    return path;
  }
  function arrow(b, dir, cls) {
    const s = 12 / cam.z;
    const d = `M${b.x} ${b.y} L${b.x - s * dir} ${b.y - s * 0.55} L${b.x - s * dir} ${b.y + s * 0.55} Z`;
    const n = document.createElementNS(SVGNS, 'path');
    n.setAttribute('d', d);
    n.setAttribute('class', 'ov-head ' + cls);
    svg.appendChild(n);
  }
  function dot(pt, cls) {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('r', 4.5 / cam.z);
    c.setAttribute('class', 'ov-dot ' + cls);
    svg.appendChild(c);
  }
  function drawLinks() {
    tools.syncNotes();
    if (!svg) return;
    svg.innerHTML = '';
    world.querySelectorAll('.ov-label').forEach((n) => n.remove());
    world.querySelectorAll('.ov-trig').forEach((n) => n.remove());
    pages.forEach((p) => {
      if (!p.rects) return;
      const groups = new Map();
      p.scan.links.filter((l) => !l.self && !l.inPopup).forEach((l) => { if (!groups.has(l.to)) groups.set(l.to, []); groups.get(l.to).push(l); });
      groups.forEach((ls, to) => {
        const T = byFile(to);
        if (!T) return;
        const hot = selected && (selected === p.file || selected === to);
        const dim = selected && !hot;
        const all = linkMode === 'all' || (selected === p.file && cam.z >= 0.35);
        const body = ls.filter((l) => !l.nav);
        const use = all ? ls : [(body[0] || ls[0])];
        use.forEach((l) => {
          const t = trig(p, l.loc);
          if (!t) return;
          const fwd = T.x >= p.x + VW * 0.6 || (T.x > p.x - 10 && T.y !== p.y);
          const a = fwd ? { x: t.x + t.w + 4, y: t.y + t.h / 2 } : { x: t.x - 4, y: t.y + t.h / 2 };
          const b = fwd ? { x: T.x - 6, y: T.y + 60 } : { x: T.x + VW + 6, y: T.y + 60 };
          const dir = fwd ? 1 : -1;
          const cls = `${hot ? 'hot' : ''} ${dim ? 'dim' : ''} ${l.nav && !body.length ? 'nav' : ''}`;
          addPath(curve(a, b, dir), cls, hot ? `「${esc(l.text || i18nText('链接'))}」→ ${esc(T.title)}` : null, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          arrow(b, dir, cls);
          dot(a, cls);
        });
      });
      p.scan.redirects.forEach((r) => {
        const T = byFile(r.to);
        if (!T || T === p) return;
        const a = { x: p.x + VW / 2, y: p.y + cardH(p) + 10 }, b = { x: T.x - 6, y: T.y + 110 };
        const hot = selected && (selected === p.file || selected === r.to);
        const cls = `redirect ${hot ? 'hot' : ''} ${selected && !hot ? 'dim' : ''}`;
        addPath(`M${a.x} ${a.y} C${a.x} ${a.y + 300}, ${b.x - 400} ${b.y}, ${b.x} ${b.y}`, cls, `${icon('clock', 12)} ${r.kind === 'timer' ? i18nTpl`${Math.round(r.delay / 1000)} 秒后自动跳转` : r.kind === 'submit' ? i18nText('提交后跳转') : i18nText('脚本跳转')}`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 120 });
        arrow(b, 1, cls);
      });
      // 弹窗：按钮 → 子页面卡片
      subs(p).forEach((pop, i) => {
        const s = p.subCards && p.subCards[i];
        if (!s) return;
        const sp = subPos(p, i), sx = sp.x + (VW * SUB) / 2, sy = sp.y;
        const cls = `pop ${selected && selected !== p.file ? 'dim' : ''}`;
        const maxLines = selected === p.file && cam.z >= 0.35 ? 99 : 1;
        pop.triggers.forEach((tr, k) => {
          const t = trig(p, tr.loc);
          if (!t) return;
          if (cam.z >= 0.35) world.appendChild(el(i18nTpl`<div class="ov-trig" style="left:${t.x + t.w}px;top:${t.y}px" data-tip="打开弹窗：${esc(pop.title)}">${icon('popup', 11)}</div>`));
          if (k >= maxLines) return;
          const a = { x: t.x + t.w / 2, y: t.y + t.h };
          const label = selected === p.file && k < 3 ? i18nTpl`点「${esc(tr.text || i18nText('按钮'))}」打开` : null;
          addPath(`M${a.x} ${a.y} C${a.x} ${a.y + 260}, ${sx} ${sy - 260}, ${sx} ${sy - 4}`, cls, label, { x: (a.x + sx) / 2, y: (a.y + sy) / 2 });
          dot(a, cls);
        });
        if (!pop.triggers.length) addPath(`M${p.x + VW / 2} ${p.y + cardH(p)} L${sx} ${sy - 4}`, cls + ' weak');
      });
      // 页内锚点：只在选中该页时画
      if (selected === p.file) p.scan.anchors.forEach((an) => {
        const t = trig(p, an.loc), r = p.rects[an.to];
        if (!t || !r) return;
        const h = cardH(p), clipped = r.y > h - 20;
        const a = { x: p.x + VW - 30, y: t.y + t.h / 2 }, b = { x: p.x + VW - 30, y: p.y + (clipped ? h - 12 : r.y + 20) };
        addPath(`M${t.x + t.w} ${a.y} C${p.x + VW + 220} ${a.y}, ${p.x + VW + 220} ${b.y}, ${b.x} ${b.y}`, 'anchor hot', `${icon('anchor', 11)} ${clipped ? i18nText('往下跳到') : i18nText('跳到')}「${esc((p.scan.sections.find((s) => s.loc === an.to) || {}).title || an.target)}」`, { x: p.x + VW + 120, y: (a.y + b.y) / 2 });
        arrow(b, -1, 'anchor hot');
      });
    });
  }

  // ---------- 画布手势 ----------
  function bindCanvas() {
    host.addEventListener('wheel', (e) => {
      e.preventDefault();
      const mouse = !e.ctrlKey && e.deltaMode === 0 && e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
      if (e.ctrlKey || e.metaKey || mouse || e.deltaMode === 1) {
        const r = host.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        const nz = clamp(cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), 0.03, 2);
        cam.x = px - ((px - cam.x) / cam.z) * nz; cam.y = py - ((py - cam.y) / cam.z) * nz; cam.z = nz;
      } else { cam.x -= e.deltaX; cam.y -= e.deltaY; }
      applyCam();
    }, { passive: false });
    host.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ov-tools')) return;
      if (tools.tool !== 'hand' && !isSpaceDown() && e.button !== 1 && e.target.closest('.ov-sticky, .ov-note-pin, .ov-note-editor, .ov-style-card') && tools.tool !== 'eraser') return;
      if (!isSpaceDown() && tools.down(e)) return;
      const onCard = e.target.closest('.ov-card, .ov-sub');
      if (e.button === 0 && tools.tool === 'pointer' && !isSpaceDown()) { if (!onCard) select(null); return; }
      if (!(e.button === 1 || (e.button === 0 && (isSpaceDown() || tools.tool === 'hand')))) return;
      e.preventDefault();
      e.stopPropagation();
      if (!onCard && e.button === 0 && tools.tool === 'pointer') select(null);
      const sx = e.clientX, sy = e.clientY, ox = cam.x, oy = cam.y;
      host.classList.add('panning');
      const mv = (ev) => { cam.x = ox + ev.clientX - sx; cam.y = oy + ev.clientY - sy; applyCam(); };
      const up = () => { host.classList.remove('panning'); window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); };
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', up, true);
    }, true);
    host.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.ov-card, .ov-sub')) return;
      if (tools.context(e)) return;
      e.preventDefault();
      showMenu([
        { label: i18nText('新建页面…'), icon: 'plus', onClick: addPage },
        { label: i18nText('看全部页面'), icon: 'fit', kbd: 'Shift+1', onClick: fitAll },
        { label: i18nText('自动重新排版'), icon: 'grid', onClick: relayout },
        '-',
        { label: showSubs ? i18nText('隐藏弹窗子页面') : i18nText('显示弹窗子页面'), icon: 'popup', onClick: toggleSubs },
        { label: i18nText('清除画布批注'), icon: 'eraser', onClick: () => tools.clearInk() },
      ], e.clientX, e.clientY);
    });
  }
  // 右键 @：把这一页（或它的弹窗）作为参考放进助手输入框
  function refPage(p, popup) {
    app.agent.addRef({ kind: 'page', page: p.file, popup: popup || null, title: popup ? `${p.title} · ${popup}` : p.title });
    app.toggleAgent(true);
  }
  async function addPage() {
    const title = await promptDlg({ title: i18nText('新建页面'), label: i18nText('页面名字'), value: i18nText('新页面'), okLabel: i18nText('创建') });
    if (!title) return;
    try {
      const proj = await app.api.addPage(app.project().id, { title });
      app.state.project.pages = proj.pages;
      app.setView('overview', { force: true });
    } catch { /* 已提示 */ }
  }
  async function removePage(p) {
    const ok = await confirmDlg({ title: i18nText('删除页面'), danger: true, okLabel: i18nText('删除'), body: i18nTpl`删除「<b>${esc(p.title)}</b>」（${esc(p.file)}）？文件会先备份进版本历史。` });
    if (!ok) return;
    try {
      const proj = await app.api.removePage(app.project().id, p.file);
      app.state.project.pages = proj.pages;
      app.bus.clearStacks();
      app.setView('overview', { force: true });
    } catch { /* 已提示 */ }
  }
  function dragSub(e, p, pop, node) {
    if (e.button !== 0 || tools.tool !== 'pointer' || isSpaceDown()) return;
    e.preventDefault();
    e.stopPropagation();
    select(p.file);
    const L = layout(), key = subKey(pop);
    const entry = L[p.file] || (L[p.file] = { x: p.x, y: p.y });
    entry.subs = entry.subs || {};
    const o0 = entry.subs[key] ? { ...entry.subs[key] } : { dx: 0, dy: 0 };
    const sx = e.clientX, sy = e.clientY;
    let moved = false, now = o0;
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      now = { dx: Math.round(o0.dx + (ev.clientX - sx) / cam.z), dy: Math.round(o0.dy + (ev.clientY - sy) / cam.z) };
      entry.subs[key] = now;
      placeCard(p);
      drawLinks();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      if (!moved) return;
      entry.subs[key] = o0;
      app.bus.doMeta({ label: i18nTpl`摆放弹窗「${pop.title}」`, apply: () => { entry.subs[key] = now; }, revert: () => { entry.subs[key] = o0; const q = byFile(p.file); if (q) { placeCard(q); drawLinks(); } } });
    };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
    node.style.cursor = 'grabbing';
    window.addEventListener('pointerup', () => { node.style.cursor = ''; }, { once: true });
  }
  const fitAll = () => pages.length && flyTo(fitRect(bounds()));
  function relayout() {
    const L = layout(), old = JSON.parse(JSON.stringify(L));
    bus.doMeta({ label: i18nText('自动重新排版'), apply: () => { Object.keys(L).forEach((k) => { if (L[k]) { delete L[k].x; delete L[k].y; } }); }, revert: () => { Object.keys(L).forEach((k) => delete L[k]); Object.assign(L, old); rebuild(); } });
    autoLayout(true);
    pages.forEach(placeCard);
    drawLinks();
    fitAll();
  }
  function toggleSubs() {
    showSubs = !showSubs;
    localStorage.setItem('cd.ovSubs', showSubs ? '1' : '0');
    pages.forEach(buildSubs);
    drawLinks();
    syncToolbar();
  }
  function rebuild() { if (!world) return; autoLayout(false); pages.forEach(placeCard); drawLinks(); styleCard.drawLinks(); }
  let toolbar = null;
  function syncToolbar() {
    if (!toolbar) return;
    toolbar.querySelector('[data-a=subs]').classList.toggle('on', showSubs);
    toolbar.querySelectorAll('[data-lm]').forEach((b) => b.classList.toggle('on', b.dataset.lm === linkMode));
  }

  // ---------- 进出视图 ----------
  async function enter(wrap) {
    const currentGeneration = ++generation;
    const vp = getViewport();
    VW = vp.w; VH = vp.h;
    host = el('<div class="stage-host ov-host"></div>');
    world = el('<div class="ov-world"></div>');
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ov-svg');
    world.appendChild(svg);
    host.appendChild(world);
    wrap.appendChild(host);
    toolbar = el(i18nTpl`<div class="ov-toolbar">
      <button class="dock-toggle" data-a="fit" data-tip="看全部页面" data-kbd="Shift+1">${icon('fit', 15)}全部</button>
      <span class="dock-sep"></span>
      <div class="seg"><button data-lm="main" data-tip="每两页之间只画一条主线">主要连线</button><button data-lm="all" data-tip="每个按钮 / 链接都画出来">全部连线</button></div>
      <button class="dock-toggle" data-a="subs" data-tip="弹窗等子页面挂在主页面下方">${icon('popup', 15)}子页面</button>
      <button class="dock-toggle" data-a="layout" data-tip="按跳转关系重新摆放">${icon('grid', 15)}整理</button>
      <span class="dock-sep"></span>
      <button class="dock-toggle" data-a="add" data-tip="新建一个空白页面">${icon('plus', 15)}新页面</button>
      </div>`);
    wrap.appendChild(toolbar);
    const zoom = el(i18nTpl`<div class="zoom-dock"><button class="icon-btn" data-z="out">${icon('minus', 16)}</button><button class="zoom-val" data-z="fit" data-tip="看全部">20%</button><button class="icon-btn" data-z="in">${icon('plus', 16)}</button></div>`);
    wrap.appendChild(zoom);
    zoom.onclick = (e) => {
      const k = e.target.closest('[data-z]') && e.target.closest('[data-z]').dataset.z;
      const W = host.clientWidth / 2, H = host.clientHeight / 2;
      const zz = (f) => { const nz = clamp(cam.z * f, 0.03, 2); flyTo({ z: nz, x: W - ((W - cam.x) / cam.z) * nz, y: H - ((H - cam.y) / cam.z) * nz }, 180); };
      if (k === 'in') zz(1.35); if (k === 'out') zz(1 / 1.35); if (k === 'fit') fitAll();
    };
    toolbar.querySelector('[data-a=fit]').onclick = fitAll;
    toolbar.querySelector('[data-a=subs]').onclick = toggleSubs;
    toolbar.querySelector('[data-a=layout]').onclick = relayout;
    toolbar.querySelector('[data-a=add]').onclick = addPage;
    app.designBoards = { add: styleCard.show };
    tctx.host = host;
    tctx.world = world;
    tools.mount(wrap);
    offVp = onViewportChange(() => app.setView('overview', { force: true }));
    toolbar.querySelectorAll('[data-lm]').forEach((b) => { b.onclick = () => { linkMode = b.dataset.lm; localStorage.setItem('cd.ovLinks', linkMode); syncToolbar(); drawLinks(); }; });
    syncToolbar();
    bindCanvas();
    app.setHint(i18nText('滚轮缩放 · 空格平移 · 拖动页面 · 双击编辑'));
    app.setStatusRight(`${vp.device === 'mobile' ? i18nText('手机') : i18nText('电脑')} ${VW}×${VH}`);
    if (!app.project().pages.length) { cam = {x: 100, y: 120, z: 1}; applyCam(); app.toggleAgent(true); return; }
    const proj = app.project();
    const set = new Set(proj.pages.map((p) => p.file));
    const L = layout();
    pages = [];
    for (const pg of proj.pages) {
      let src = '';
      try { src = await app.api.readFile(proj.id, pg.file); } catch { src = i18nText('<title>读取失败</title>'); }
      if (!host || currentGeneration !== generation) return;
      pages.push({ file: pg.file, title: pg.title, src, parsed: parse(src), scan: scanPage(pg.file, src, set), expanded: !!(L[pg.file] && L[pg.file].expanded) });
    }
    autoLayout(false);
    pages.forEach(buildCard);
    styleCard.mount();
    const b = fitRect(bounds());
    cam = { ...b, z: b.z * 0.9, x: b.x + host.clientWidth * 0.05, y: b.y + host.clientHeight * 0.05 };
    applyCam();
    flyTo(b, 420);
    if (app.activePanel() === 'structure') app.openPanel('structure');
  }
  function leave() {
    generation++; flight++;
    if (offVp) { offVp(); offVp = null; }
    cancelAnimationFrame(raf);
    tools.unmount(); styleCard.unmount();
    host = world = svg = toolbar = null;
    pages = [];
    selected = null;
  }

  // ---------- 左侧"结构"面板 ----------
  bus.registerPanel({
    id: 'structure', title: i18nText('网页结构'), icon: 'overview', views: ['overview', 'edit'],
    render(box) {
      if (app.view() === 'edit') { this._layerOff = renderPageStructure(app, box); return; }
      const paint = () => {
        box.innerHTML = '';
        if (!pages.length) { box.appendChild(el(i18nText('<div class="empty">还没有页面</div>'))); return; }
        pages.forEach((p) => {
          const outs = [...new Set(p.scan.links.filter((l) => !l.self).map((l) => l.to))];
          const row = el(i18nTpl`<div class="tree-page ${selected === p.file ? 'on' : ''}">
            <div class="tree-head">${icon('file', 15)}<b>${esc(p.title)}</b><span class="grow"></span>
              <button class="icon-btn sm" data-a="edit" data-tip="进入编辑">${icon('edit', 14)}</button></div>
            ${p.scan.popups.map((x) => i18nTpl`<div class="tree-item" data-pop="${x.loc}">${icon('popup', 13)}弹窗：${esc(x.title)}${x.triggers.length ? i18nTpl`<small>由「${esc(x.triggers[0].text || i18nText('按钮'))}」打开</small>` : ''}</div>`).join('')}
            ${p.scan.sections.slice(0, 12).map((s) => `<div class="tree-item" data-sec="${s.loc}">${icon('anchor', 13)}${esc(s.title)}</div>`).join('')}
            ${outs.map((t) => i18nTpl`<div class="tree-item link" data-to="${esc(t)}">${icon('link', 13)}跳到 ${esc((byFile(t) || {}).title || t)}</div>`).join('')}
            ${p.scan.redirects.map((r) => i18nTpl`<div class="tree-item link" data-to="${esc(r.to)}">${icon('clock', 13)}${r.kind === 'submit' ? i18nText('提交后') : i18nText('自动')}跳到 ${esc((byFile(r.to) || {}).title || r.to)}</div>`).join('')}</div>`);
          row.querySelector('.tree-head').onclick = (e) => { if (e.target.closest('[data-a=edit]')) { openEdit(p); return; } select(p.file); flyTo(fitRect(blockRect(p))); };
          row.querySelectorAll('[data-sec]').forEach((n) => { n.onclick = () => { const r = p.rects && p.rects[n.dataset.sec]; select(p.file); if (r && r.y > VH && !p.expanded) toggleExpand(p); flyTo(fitRect({ x: p.x, y: p.y + (r ? r.y : 0), w: VW, h: VH }, 60, 2)); }; });
          row.querySelectorAll('[data-pop]').forEach((n, i) => { n.onclick = () => { select(p.file); if (!showSubs) toggleSubs(); const s = p.subCards[i]; if (s) flyTo(fitRect({ x: parseFloat(s.style.left), y: parseFloat(s.style.top), w: VW * SUB, h: VH * SUB }, 60, 2)); }; });
          row.querySelectorAll('[data-to]').forEach((n) => { n.onclick = () => { const T = byFile(n.dataset.to); if (T) { select(T.file); flyTo(fitRect(blockRect(T))); } }; });
          box.appendChild(row);
        });
      };
      paint();
      this._o1 = bus.on('ov-select', () => box.isConnected && paint());
      this._o2 = bus.on('ov-ready', () => box.isConnected && paint());
      setTimeout(paint, 900);
    },
    onHide() { if (this._layerOff) { this._layerOff(); this._layerOff = null; } if (this._o1) this._o1(); if (this._o2) this._o2(); },
  });

  const inOv = () => app.state.view === 'overview' && !!host;
  bindKey('Shift+1', { id: 'ov.fit', label: i18nText('看全部页面'), group: i18nText('总览'), when: inOv, run: fitAll });
  bindKey('Shift+2', { id: 'ov.focus', label: i18nText('镜头对准选中页'), group: i18nText('总览'), when: () => inOv() && !!selected, run: () => flyTo(fitRect(blockRect(byFile(selected)))) });
  bindKey('Enter', { label: i18nText('进入编辑选中页'), group: i18nText('总览'), when: () => inOv() && !!selected, run: () => openEdit(byFile(selected)) });
  bindKey('Esc', { hidden: true, when: () => inOv() && !!selected, run: () => select(null) });
  bus.on('source', () => { /* 编辑写回后回到总览会重新读取 */ });
  bus.on('stack', () => { if (inOv()) { rebuild(); tools.repaint(); styleCard.refresh(); } });

  return { enter, leave, refresh: rebuild };
}
