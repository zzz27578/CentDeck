// 放映：像真实访客一样浏览（真跳转、真滚动、真动画），画面按本机浏览器比例等比缩放；
// ← → 翻页 · Esc 退出 · "圈问题"框一块，自动变成草图标记
import { icon } from '../core/icons.js';
import { el, esc, toast } from '../core/ui.js';
import { createStage } from '../core/stage.js';
import { getViewport } from '../core/viewport.js';
import { attachDoc, bindKey } from '../core/keys.js';

export function createPresent(app) {
  let host = null, stage = null, frame = null, cur = null, back = 'overview', annot = null, hideT = 0;
  const url = (f) => `/preview/${encodeURIComponent(app.project().id)}/${f}`;
  const pages = () => app.project().pages;
  const titleOf = (f) => (pages().find((p) => p.file === f) || {}).title || f;

  function go(file) { if (!frame || !file) return; cur = file; frame.src = url(file); sync(); }
  function step(d) { const L = pages(); const i = L.findIndex((p) => p.file === cur); go(L[(i + d + L.length) % L.length].file); }
  function sync() {
    if (!host) return;
    host.querySelector('.pv-title').innerHTML = `<b>${esc(titleOf(cur))}</b><span>${esc(cur)}</span>`;
    host.querySelector('.pv-count').textContent = `${pages().findIndex((p) => p.file === cur) + 1} / ${pages().length}`;
  }
  function onLoad() {
    try {
      const u = new URL(frame.contentWindow.location.href);
      const pre = `/preview/${encodeURIComponent(app.project().id)}/`;
      if (u.pathname.startsWith(pre)) { const f = decodeURIComponent(u.pathname.slice(pre.length)); if (pages().some((p) => p.file === f)) cur = f; }
      attachDoc(frame.contentDocument);
      frame.contentDocument.addEventListener('mousemove', poke);
    } catch { /* 外部链接跨域：忽略 */ }
    sync();
  }
  function poke() { host.classList.remove('idle'); clearTimeout(hideT); hideT = setTimeout(() => host && !annot && host.classList.add('idle'), 2200); }

  function domSelector(n) {
    const seg = [];
    for (let e = n; e && e.tagName !== 'BODY' && e.nodeType === 1; e = e.parentElement) {
      let k = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) k++;
      seg.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + k + ')');
    }
    return 'body > ' + seg.join(' > ');
  }
  function setAnnot(on) {
    const btn = host.querySelector('[data-a=mark]');
    btn.classList.toggle('on', on);
    if (!on) { if (annot) annot.remove(); annot = null; return; }
    annot = el('<div class="pv-annot"><div class="pv-annot-tip">按住拖出一个框，圈住有问题的地方 · Esc 取消</div><div class="pv-box"></div></div>');
    stage.device.appendChild(annot);
    const box = annot.querySelector('.pv-box');
    annot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const a = stage.toDevice(e.clientX, e.clientY);
      let b = a;
      const mv = (ev) => { b = stage.toDevice(ev.clientX, ev.clientY); Object.assign(box.style, { display: 'block', left: Math.min(a.x, b.x) + 'px', top: Math.min(a.y, b.y) + 'px', width: Math.abs(b.x - a.x) + 'px', height: Math.abs(b.y - a.y) + 'px' }); };
      const up = async () => {
        window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true);
        if (Math.abs(b.x - a.x) < 8 || Math.abs(b.y - a.y) < 8) { box.style.display = 'none'; return; }
        const w = frame.contentWindow, d = frame.contentDocument;
        const sx = w.scrollX, sy = w.scrollY;
        const n = d.elementFromPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const r = n && n.getBoundingClientRect();
        await app.sketch.addRaw({ type: 'rect', page: cur, color: '#e5484d', width: 3, pts: [[Math.min(a.x, b.x) + sx, Math.min(a.y, b.y) + sy], [Math.max(a.x, b.x) + sx, Math.max(a.y, b.y) + sy]],
          anchor: n && n.tagName !== 'BODY' ? { selector: domSelector(n), x0: r.left + sx, y0: r.top + sy, tag: n.tagName.toLowerCase() } : null,
          text: '', done: false, auto: true, meta: `放映时圈出的问题 · ${titleOf(cur)}` });
        toast('已记成草图标记：回到编辑后在"草图标记"面板里补一句要求', 'ok', 4000);
        setAnnot(false);
      };
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', up, true);
    });
  }

  async function enter(wrap) {
    const vp = getViewport();
    back = app.state.lastView && app.state.lastView !== 'present' ? app.state.lastView : 'overview';
    host = el(`<div class="present-host">
      <div class="pv-top"><div class="pv-title"></div><span class="grow"></span><span class="pv-count"></span></div>
      <div class="pv-stage"></div>
      <div class="pv-capsule">
        <button class="icon-btn" data-a="prev" data-tip="上一页" data-kbd="←" data-tip-place="top">${icon('chevRight', 18, 'flip')}</button>
        <button class="icon-btn" data-a="next" data-tip="下一页" data-kbd="→" data-tip-place="top">${icon('chevRight', 18)}</button>
        <span class="dock-sep"></span>
        <button class="icon-btn" data-a="home" data-tip="回到首页" data-tip-place="top">${icon('home', 18)}</button>
        <button class="icon-btn" data-a="mark" data-tip="圈问题：框一块，自动记成草图标记" data-tip-place="top">${icon('rect', 18)}</button>
        <button class="icon-btn" data-a="fit" data-tip="适应 / 实际大小" data-tip-place="top">${icon('fit', 18)}</button>
        <span class="dock-sep"></span>
        <button class="icon-btn" data-a="exit" data-tip="退出放映" data-kbd="Esc" data-tip-place="top">${icon('close', 18)}</button>
      </div></div>`);
    wrap.appendChild(host);
    stage = createStage(host.querySelector('.pv-stage'), { pad: 14, labelHeight: 0 });
    stage.setSize(vp.w, vp.h);
    frame = el('<iframe class="pv-frame" title="放映"></iframe>');
    stage.device.appendChild(frame);
    frame.addEventListener('load', onLoad);
    host.addEventListener('mousemove', poke);
    host.querySelector('.pv-capsule').onclick = (e) => {
      const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').dataset.a;
      if (a === 'prev') step(-1); if (a === 'next') step(1); if (a === 'home') go(pages()[0].file);
      if (a === 'mark') setAnnot(!annot); if (a === 'exit') exit();
      if (a === 'fit') { if (stage.mode === 'fit') stage.actual(); else stage.fit(true); }
    };
    app.setHint('← → 翻页 · 页面里的按钮、链接都能真的点 · Esc 退出放映');
    app.setStatusRight(`放映 · 视口 ${vp.w}×${vp.h}`);
    go(app.state.presentFrom || pages()[0].file);
    poke();
  }
  function leave() { setAnnot(false); if (stage) stage.destroy(); host = stage = frame = null; }
  function exit() { app.setView(back); }
  app.bus.on('view', (v) => { if (v !== 'present') app.state.lastView = v; });

  const inPv = () => app.state.view === 'present' && !!host;
  bindKey('Esc', { hidden: true, when: inPv, run: () => { if (annot) setAnnot(false); else exit(); } });
  bindKey(['→', 'PageDown'], { label: '下一页', group: '放映', when: inPv, run: () => step(1) });
  bindKey(['←', 'PageUp'], { label: '上一页', group: '放映', when: inPv, run: () => step(-1) });
  return { enter, leave };
}
