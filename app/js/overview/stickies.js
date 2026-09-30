import { el, esc, uid, showMenu } from '../core/ui.js';
import { icon } from '../core/icons.js';
import {notePalette,COLORS} from '../core/note-colors.js';

export function createStickies(app, c) {
  let layer, cleanup = () => {};
  const notes = () => app.project().canvasNotes || (app.project().canvasNotes = []);
  const edit = (n, props, label) => {
    const before = Object.fromEntries(Object.keys(props).map(k => [k, n[k]]));
    return app.bus.doMeta({ label, apply: () => Object.assign(n, props), revert: () => Object.assign(n, before) }).then(paint);
  };
  function remove(n) {
    const list = notes(), i = list.indexOf(n);
    return app.bus.doMeta({ label: '删除画布便签', apply: () => { const at = list.indexOf(n); if (at >= 0) list.splice(at, 1); }, revert: () => list.splice(i, 0, n) }).then(()=>paint(true));
  }
  function paint(force=false) {
    if (!layer?.isConnected) return;
    // 输入过程中保留焦点和选区；离焦时再更新。
    if (!force && layer.contains(document.activeElement) && document.activeElement.matches('textarea')) return;
    layer.innerHTML = '';
    notes().forEach(n => {
      const node = el(`<section class="ov-sticky" data-id="${esc(n.id)}"><header><b>#${n.no}</b><span>便签</span><button aria-label="引用便签到助手" data-ref>${icon('at', 14)}</button><button aria-label="删除便签" data-del>${icon('close', 14)}</button></header><textarea aria-label="便签内容" placeholder="添加批注…" rows="4"></textarea>${notePalette(n.color)}</section>`);
      node.style.cssText = `left:${n.x}px;top:${n.y}px;--note-color:${n.color};`;
      const ta = node.querySelector('textarea'); ta.value = n.text;
      let original = n.text;
      ta.onfocus = () => { original = n.text; };
      ta.oninput = () => { n.text = ta.value; app.bus.saveMeta(); };
      ta.onblur = () => { if (original !== ta.value) { const next = ta.value; n.text = original; edit(n, {text: next}, '编辑画布便签'); } };
      node.querySelectorAll('button').forEach(b=>b.onpointerdown=e=>e.preventDefault());
      node.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{node.style.setProperty('--note-color',b.dataset.c);node.querySelectorAll('[data-c]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',x===b);});edit(n,{color:b.dataset.c},'便签换色');});
      node.querySelector('[data-del]').onclick = () => remove(n);
      node.querySelector('[data-ref]').onclick = () => app.agent.addRef({ kind: 'canvas-note', id: n.id, no: n.no, title: `便签 #${n.no}`, text: n.text, color: n.color });
      node.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); showMenu([{ label: '删除便签', icon: 'trash', onClick: () => remove(n) }], e.clientX, e.clientY); };
      node.querySelector('header').onpointerdown = e => {
        if (e.button || e.target.closest('button,input')) return;
        e.preventDefault(); e.stopPropagation(); const start = c.toWorld(e.clientX, e.clientY), old = { x: n.x, y: n.y }; let next = old;
        const move = ev => { const p = c.toWorld(ev.clientX, ev.clientY); next = { x: old.x + p.x - start.x, y: old.y + p.y - start.y }; node.style.left = next.x + 'px'; node.style.top = next.y + 'px'; };
        const up = () => { cleanup(); if (next !== old) edit(n, next, '移动画布便签'); };
        cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
        const cancel = () => { cleanup(); paint(); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
      };
      layer.appendChild(node);
    });
  }
  async function add(pt, color) {
    const p = app.project();
    p.nextCanvasNote = Math.max(p.nextCanvasNote || 1, ...notes().map(n => n.no + 1));
    const n = { id: uid('note'), no: p.nextCanvasNote++, text: '', x: pt.x, y: pt.y, color:COLORS.includes(color)?color:COLORS[0] };
    const list = notes();
    await app.bus.doMeta({ label: '添加画布便签', apply: () => list.push(n), revert: () => { const i = list.indexOf(n); if (i >= 0) list.splice(i, 1); } });
    paint();
    layer?.querySelector(`[data-id="${n.id}"] textarea`)?.focus();
  }
  return { mount() { layer = el('<div class="ov-stickies"></div>'); c.world.appendChild(layer); paint(); }, paint, add,
    erase(target) { const n = notes().find(n => n.id === target.closest('.ov-sticky')?.dataset.id); if (n) remove(n); return !!n; },
    unmount() { cleanup(); layer = null; } };
}
