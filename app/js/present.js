// present.js —— 内置插件：放映
// 全屏放映：iframe 指向 /preview/<id>/pages/<首页>.html，真实可点可滚可跳转（多页真跳，
// 顶部地址条显示当前页面名，可返回首页）；Esc 退出（回总览，由 main.js 处理）；
// "圈出问题"进入标注态：复用画笔/框选，松手保存为标记并退出标注态；
// 底部缩略条列出全部页面可点击直达。

import { el, esc, uid, toast } from './ui.js';

export function setup(ctx, apiOut) {
  const { bus } = ctx;
  let frame = null;         // 放映 iframe
  let currentFile = null;   // 当前页 file
  let annotating = false;   // 标注态
  let overlay = null, svgEl = null;
  let drawing = null;
  let hostEl = null;

  const SVGNS = 'http://www.w3.org/2000/svg';

  function previewUrl(file) {
    const proj = ctx.project();
    return `/preview/${encodeURIComponent(proj.id)}/${file}`;
  }

  function pageTitleOf(file) {
    const proj = ctx.project();
    const p = proj.pages.find((x) => x.file === file);
    return p ? p.title : file;
  }

  // ---------- 进场 / 离场 ----------
  function enter(stage) {
    const proj = ctx.project();
    const first = proj.pages[0];
    if (!first) { stage.innerHTML = '<div class="panel-empty">这个项目没有页面</div>'; return; }
    currentFile = null;
    stage.innerHTML = `
      <div class="present-wrap">
        <div class="present-top">
          <button class="btn small" id="pv-home-page" title="回到首页">⌂ 首页</button>
          <div class="present-addr" id="pv-addr"></div>
          <button class="btn small" id="pv-mark" title="圈出问题：画一笔或框一块，保存为标记">✏️ 圈出问题</button>
          <button class="btn small" id="pv-exit" title="退出放映（Esc）">退出放映</button>
        </div>
        <div class="present-stage" id="pv-stage">
          <iframe id="pv-frame" title="放映"></iframe>
        </div>
        <div class="present-strip" id="pv-strip"></div>
      </div>`;
    hostEl = stage.querySelector('.present-wrap');
    frame = stage.querySelector('#pv-frame');
    frame.addEventListener('load', onFrameLoad);
    stage.querySelector('#pv-exit').onclick = () => bus.runCommand('app.exitPresent', ctx);
    stage.querySelector('#pv-home-page').onclick = () => goto(proj.pages[0].file);
    stage.querySelector('#pv-mark').onclick = toggleAnnotate;
    buildStrip(stage.querySelector('#pv-strip'));
    goto(first.file);
  }

  function leave() {
    setAnnotate(false);
    frame = null;
    hostEl = null;
  }

  function goto(file) {
    if (!frame) return;
    currentFile = file;
    frame.src = previewUrl(file);
    updateAddr();
    updateStrip();
  }

  // iframe 每次加载（含站内跳转）后：从 URL 反推当前页
  function onFrameLoad() {
    try {
      const u = new URL(frame.contentWindow.location.href);
      const m = u.pathname.match(/^\/preview\/[^/]+\/(.+)$/);
      if (m) {
        const f = decodeURIComponent(m[1]);
        if (ctx.project().pages.some((p) => p.file === f)) {
          currentFile = f;
        }
      }
    } catch { /* 忽略 */ }
    updateAddr();
    updateStrip();
    if (annotating) sizeOverlay();
  }

  function updateAddr() {
    const addr = hostEl && hostEl.querySelector('#pv-addr');
    if (addr) addr.textContent = `${pageTitleOf(currentFile)} · ${currentFile}`;
  }

  // ---------- 底部缩略条 ----------
  function buildStrip(strip) {
    const proj = ctx.project();
    strip.innerHTML = '';
    proj.pages.forEach((p) => {
      const item = el(`<button class="pv-thumb" data-file="${esc(p.file)}">
        <span class="pv-thumb-frame"><iframe loading="lazy" title="${esc(p.title)}"></iframe></span>
        <span class="pv-thumb-title">${esc(p.title)}</span>
      </button>`);
      item.querySelector('iframe').src = previewUrl(p.file);
      item.onclick = () => goto(p.file);
      strip.appendChild(item);
    });
  }
  function updateStrip() {
    if (!hostEl) return;
    hostEl.querySelectorAll('.pv-thumb').forEach((t) => t.classList.toggle('on', t.dataset.file === currentFile));
  }

  // ---------- 标注态（圈出问题） ----------
  function toggleAnnotate() { setAnnotate(!annotating); }

  function setAnnotate(on) {
    annotating = on;
    const btn = hostEl && hostEl.querySelector('#pv-mark');
    if (btn) btn.classList.toggle('on', on);
    const stageEl = hostEl && hostEl.querySelector('#pv-stage');
    if (!stageEl) return;
    if (on) {
      if (!overlay) {
        overlay = el(`<div class="pv-annot">
          <svg class="pv-annot-svg"></svg>
          <div class="pv-annot-hint">标注态：按住画一笔或框一块，松手保存为标记；再点"圈出问题"或按 Esc 取消</div>
        </div>`);
        svgEl = overlay.querySelector('svg');
        stageEl.appendChild(overlay);
        overlay.addEventListener('mousedown', onDown);
        sizeOverlay();
      }
    } else {
      if (drawing && drawing.node) drawing.node.remove();
      drawing = null;
      if (overlay) { overlay.remove(); overlay = svgEl = null; }
    }
  }

  function sizeOverlay() {
    if (!overlay || !frame) return;
    const r = frame.getBoundingClientRect();
    const sr = overlay.parentElement.getBoundingClientRect();
    overlay.style.left = r.left - sr.left + 'px';
    overlay.style.top = r.top - sr.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  function toLocal(e) {
    const r = overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const p0 = toLocal(e);
    drawing = { start: p0, points: [[p0.x, p0.y]], node: document.createElementNS(SVGNS, 'path') };
    drawing.node.setAttribute('class', 'pv-draw');
    svgEl.appendChild(drawing.node);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  }
  function onMove(e) {
    if (!drawing) return;
    const p = toLocal(e);
    drawing.points.push([p.x, p.y]);
    drawing.node.setAttribute('d', drawing.points.map(([x, y], i) => (i ? 'L' : 'M') + Math.round(x) + ' ' + Math.round(y)).join(' '));
  }
  async function onUp() {
    window.removeEventListener('mousemove', onMove);
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (d.points.length < 3) { d.node.remove(); return; }
    // 松手：框选（用笔画的外接矩形）保存为标记，退出标注态
    const xs = d.points.map((p) => p[0]), ys = d.points.map((p) => p[1]);
    const rect = {
      x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)),
      w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)),
    };
    d.node.remove();
    const proj = ctx.project();
    if (!Array.isArray(proj.marks)) proj.marks = [];
    const mark = {
      id: uid('mk'), page: currentFile, type: 'rect',
      selector: null, offset: null, text: '', done: false, auto: true,
      meta: `放映圈出的问题（${pageTitleOf(currentFile)} · 区域内 ${rect.w}×${rect.h}px）`,
      data: rect,
      // 放映里没有门牌号锚点：记录最后位置，编辑视图里会标"可能漂移"
      _last: rect,
    };
    await bus.doMeta({
      label: '放映圈出问题',
      apply: () => { proj.marks.push(mark); },
      revert: () => { const i = proj.marks.indexOf(mark); if (i >= 0) proj.marks.splice(i, 1); },
    });
    setAnnotate(false);
    toast('已保存为标记（编辑视图 → 标记面板里补一句要求，导出任务单交给 AI）', 'ok', 5000);
  }

  apiOut.enter = enter;
  apiOut.leave = leave;

  // Esc 退出标注态（Esc 退出放映由 main.js 全局处理）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && annotating) {
      e.stopPropagation();
      setAnnotate(false);
    }
  }, true);
}
