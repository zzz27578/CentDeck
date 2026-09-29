// overview.js —— 总览画布（内置插件）：项目所有页面以等比缩小 iframe（srcdoc 渲染真实页面）
// 摆在无限画布上；可拖摆位置（存 project.json.layout，随 PUT project 保存）、滚轮缩放、
// 空白处拖平移；页面在总览里是锁的（遮罩拦截 pointer-events，点不进页面内部）。
// 自动连线：解析各页源码里的 <a href="x.html"> 生成页面间有向连线（SVG + 箭头）；
// 默认只高亮选中页的来路/去路，"显示全部连线"开关；双击页面进入编辑视图。

import { api } from './api.js';
import { el, esc, clamp } from './ui.js';

const PAGE_W = 1280; // 画布上每个页面按电脑宽度渲染
const GRID_GAP_X = 120;
const GRID_GAP_Y = 80;
const GRID_COLS = 3;

export function setup(ctx, apiOut) {
  const { bus } = ctx;
  let host = null;          // 舞台容器
  let viewport = null;      // 缩放平移层
  let svg = null;           // 连线层
  let nodesBox = null;      // 页面节点层
  let camera = { x: 60, y: 60, z: 0.28 }; // 平移 + 缩放
  let pages = [];           // [{ file, title, x, y, w, h, src }]
  let selected = null;      // 选中页 file
  let showAllLinks = true; // 默认全开：未选中任何页面时也看到整张关系图
  let built = false;

  // ---------- 布局读取/保存（project.json.layout） ----------
  function layoutOf() {
    const p = ctx.project();
    if (!p) return {};
    if (!p.layout || typeof p.layout !== 'object') p.layout = {};
    return p.layout;
  }
  function saveLayout() { bus.saveMeta(); }

  // ---------- 计算页面节点 ----------
  async function loadPages() {
    const proj = ctx.project();
    if (!proj) return;
    const layout = layoutOf();
    pages = [];
    for (let i = 0; i < proj.pages.length; i++) {
      const pg = proj.pages[i];
      let src = '';
      try { src = await api.readFile(proj.id, pg.file); } catch { src = '<!doctype html><title>读取失败</title>'; }
      const saved = layout[pg.file];
      pages.push({
        file: pg.file,
        title: pg.title || pg.file,
        x: saved && typeof saved.x === 'number' ? saved.x : 80 + (i % GRID_COLS) * (PAGE_W + GRID_GAP_X),
        y: saved && typeof saved.y === 'number' ? saved.y : 80 + Math.floor(i / GRID_COLS) * (900 + GRID_GAP_Y),
        w: PAGE_W,
        h: 900, // 等 iframe 加载后按真实内容高度更新
        src,
        modals: scanModals(src),
      });
    }
  }

  // ---------- 扫描页面里的弹窗（class 含 modal 的块级元素 + 邻近标题） ----------
  function scanModals(src) {
    const out = [];
    const re = /<(?:div|section|dialog)(?=[^>]*class="[^"]*\bmodal\b)[^>]*>/gi;
    let m;
    while ((m = re.exec(src))) {
      const idM = /id="([^"]+)"/.exec(m[0]);
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 1200);
      const tM = /<h[234][^>]*>([\s\S]*?)<\/h[234]>/.exec(after);
      const title = tM ? tM[1].replace(/<[^>]+>/g, '').trim().slice(0, 24) : (idM ? idM[1] : '弹窗');
      out.push({ id: idM ? idM[1] : null, title });
    }
    return out;
  }

  // ---------- 解析跳转连线：<a href="x.html"> ----------
  function computeLinks() {
    const fileOf = new Map(pages.map((p) => [p.file, p]));
    const baseOf = new Map(pages.map((p) => [p.file.split('/').pop(), p]));
    const links = [];
    pages.forEach((p) => {
      const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(p.src))) {
        const href = m[1].trim();
        if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href) || href.startsWith('//')) continue;
        const clean = href.split('#')[0].split('?')[0];
        if (!clean) continue;
        const target = fileOf.get(clean) || fileOf.get('pages/' + clean) || baseOf.get(clean.split('/').pop());
        if (target && target !== p) links.push({ from: p.file, to: target.file });
      }
    });
    // 去重
    const seen = new Set();
    return links.filter((l) => {
      const k = l.from + '→' + l.to;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ---------- 渲染 ----------
  function applyCamera() {
    viewport.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`;
  }

  function drawLinks() {
    const links = computeLinks();
    const nodeOf = new Map(pages.map((p) => [p.file, p]));
    svg.innerHTML = `<defs><marker id="ov-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8a919e"/></marker></defs>`;
    links.forEach((l) => {
      const a = nodeOf.get(l.from), b = nodeOf.get(l.to);
      if (!a || !b) return;
      const x1 = a.x + a.w, y1 = a.y + Math.min(a.h, 400) / 2;
      const x2 = b.x, y2 = b.y + Math.min(b.h, 400) / 2;
      const dx = Math.max(60, Math.abs(x2 - x1) / 2);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', 'ov-link');
      path.setAttribute('marker-end', 'url(#ov-arrow)');
      const hot = showAllLinks || l.from === selected || l.to === selected;
      path.classList.toggle('dim', !hot);
      path.classList.toggle('hot', !!selected && (l.from === selected || l.to === selected));
      svg.appendChild(path);
    });
  }

  function renderNodes() {
    nodesBox.innerHTML = '';
    pages.forEach((p) => {
      const node = el(`<div class="ov-node" style="left:${p.x}px;top:${p.y}px;width:${p.w}px">
        <div class="ov-node-head"><span class="ov-title">${esc(p.title)}</span><span class="ov-file">${esc(p.file)}</span>${p.modals && p.modals.length ? ` <button class="ov-badge" title="本页包含的弹窗/小页面（平时折叠不出现在画布；编辑视图里点对应按钮出现）">▣ 弹窗 ×${p.modals.length}</button>` : ''}</div>
        <div class="ov-body"><iframe title="${esc(p.title)}" loading="lazy"></iframe><div class="ov-mask" title="总览里页面是锁定的；双击进入编辑"></div></div>
      </div>`);
      const body = node.querySelector('.ov-body');
      const iframe = node.querySelector('iframe');
      iframe.srcdoc = p.src;
      iframe.onload = () => {
        try {
          const h = clamp(iframe.contentDocument.documentElement.scrollHeight || 900, 320, 6000);
          p.h = h;
          body.style.height = h + 'px';
          drawLinks();
        } catch { /* 跨域不会发生（srcdoc 同源），兜底忽略 */ }
      };
      body.style.height = p.h + 'px';
      // 拖摆位置（拖标题栏）
      const head = node.querySelector('.ov-node-head');
      // 弹窗角标：点击列出本页弹窗/小页面（层次关系的最小落地：名字 + 从哪个按钮进）
      const badge = node.querySelector('.ov-badge');
      if (badge) {
        badge.addEventListener('mousedown', (e) => e.stopPropagation());
        badge.addEventListener('dblclick', (e) => e.stopPropagation());
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.ov-badge-pop').forEach((n) => n.remove());
          const pop = el(`<div class="ov-badge-pop"><div class="ovb-title">本页的弹窗 / 小页面 ×${p.modals.length}</div>${p.modals.map((mm) => `<div class="ovb-item">· ${esc(mm.title)}</div>`).join('')}<div class="ovb-item ovb-src">平时折叠不出现在画布；编辑视图里点对应按钮（如「新建订单」）出现。后续版本会支持单独摆出+虚线连到所属按钮。</div></div>`);
          pop.addEventListener('mousedown', (ev) => ev.stopPropagation());
          node.appendChild(pop);
          const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', close); } };
          document.addEventListener('mousedown', close);
        });
      }
      head.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const sx = e.clientX, sy = e.clientY, ox = p.x, oy = p.y;
        let moved = false;
        const onMove = (ev) => {
          const dx = (ev.clientX - sx) / camera.z, dy = (ev.clientY - sy) / camera.z;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
          moved = true;
          p.x = Math.round(ox + dx);
          p.y = Math.round(oy + dy);
          node.style.left = p.x + 'px';
          node.style.top = p.y + 'px';
          drawLinks();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          if (moved) {
            layoutOf()[p.file] = { x: p.x, y: p.y };
            saveLayout();
          }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      // 单击选中（高亮来路/去路）
      node.addEventListener('click', () => {
        selected = selected === p.file ? null : p.file;
        nodesBox.querySelectorAll('.ov-node').forEach((n) => n.classList.remove('on'));
        if (selected) node.classList.add('on');
        drawLinks();
      });
      // 双击进入编辑
      node.addEventListener('dblclick', () => {
        bus.runCommand('app.openPageInEdit', ctx, p.file, p.title);
      });
      nodesBox.appendChild(node);
    });
  }

  // ---------- 进场 / 离场 ----------
  async function enter(stage) {
    built = false;
    stage.innerHTML = `
      <div class="ov-wrap">
        <div class="ov-toolbar">
          <label class="ov-toggle"><input type="checkbox" id="ov-all-links" checked> 显示全部连线</label>
          <span class="ov-hint">滚轮缩放 · 空白处拖动平移 · 拖标题栏摆位置 · 双击页面进入编辑</span>
        </div>
        <div class="ov-canvas" id="ov-canvas">
          <div class="ov-viewport" id="ov-viewport">
            <svg class="ov-svg" id="ov-svg"></svg>
            <div class="ov-nodes" id="ov-nodes"></div>
          </div>
        </div>
      </div>`;
    host = stage.querySelector('.ov-canvas');
    viewport = stage.querySelector('#ov-viewport');
    svg = stage.querySelector('#ov-svg');
    nodesBox = stage.querySelector('#ov-nodes');
    camera = { x: 60, y: 60, z: 0.28 };
    selected = null;
    applyCamera();

    await loadPages();
    renderNodes();
    drawLinks();
    built = true;

    stage.querySelector('#ov-all-links').onchange = (e) => {
      showAllLinks = e.target.checked;
      drawLinks();
    };

    // 滚轮缩放（以指针为中心）
    host.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const oldZ = camera.z;
      const z = clamp(oldZ * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.08, 1.2);
      // 保持指针下的画布点不动
      camera.x = px - ((px - camera.x) / oldZ) * z;
      camera.y = py - ((py - camera.y) / oldZ) * z;
      camera.z = z;
      applyCamera();
    }, { passive: false });

    // 空白处拖平移
    host.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.ov-node')) return; // 节点上由节点自己处理
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = camera.x, oy = camera.y;
      const onMove = (ev) => {
        camera.x = ox + (ev.clientX - sx);
        camera.y = oy + (ev.clientY - sy);
        applyCamera();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  function leave() {
    host = null;
    viewport = null;
    built = false;
  }

  async function refresh() {
    if (!built || !host) return;
    await loadPages();
    renderNodes();
    drawLinks();
  }

  apiOut.enter = enter;
  apiOut.leave = leave;
  apiOut.refresh = refresh;

  // 供总览双击进编辑的命令（内核注册的 app 级命令）
  bus.registerCommand('app.openPageInEdit', (c, file, title) => {
    c.__openPageInEdit(file, title);
  });
}
