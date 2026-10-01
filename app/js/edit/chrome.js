// 编辑视图周边：页面标签（含视口选择）、底部工具坞、缩放、三灯判定卡、右键菜单、路径条
import { icon } from '../core/icons.js';
import { el, esc, toast, showMenu, promptDlg } from '../core/ui.js';
import { PRESETS, MOBILE_PRESETS, getViewport, setViewport, autoSize } from '../core/viewport.js';
import { comboFor, onKeymapChange } from '../core/keys.js';

export function buildChrome(ed, wrap) {
  const app = ed.app;
  const label = el('<div class="frame-label"></div>');
  ed.host.appendChild(label);
  const dock = el('<div class="tool-dock"></div>');
  const zoom = el(`<div class="zoom-dock">
    <button class="icon-btn" data-z="out" data-tip="缩小" data-kbd="Ctrl+-">${icon('minus', 16)}</button>
    <button class="zoom-val" data-z="menu" data-tip="缩放比例"></button>
    <button class="icon-btn" data-z="in" data-tip="放大" data-kbd="Ctrl++">${icon('plus', 16)}</button>
    <button class="icon-btn" data-z="fit" data-tip="适应屏幕" data-kbd="Shift+1">${icon('fit', 16)}</button></div>`);
  wrap.append(dock, zoom);

  zoom.onclick = (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    const k = b.dataset.z;
    if (k === 'in') ed.stage.zoomIn();
    if (k === 'out') ed.stage.zoomOut();
    if (k === 'fit') ed.stage.fit(true);
    if (k === 'menu') showMenu([
      { label: '适应屏幕', kbd: 'Shift+1', checked: ed.stage.mode === 'fit', onClick: () => ed.stage.fit(true) },
      '-',
      ...[0.5, 0.75, 1, 1.5, 2].map((z) => ({ label: Math.round(z * 100) + '%', kbd: z === 1 ? 'Ctrl+0' : '', checked: ed.stage.mode !== 'fit' && Math.abs(ed.stage.zoom - z) < 0.01, onClick: () => ed.stage.setZoom(z, { animate: true }) })),
    ], 0, 0, { anchor: b, align: 'center', minWidth: 150 });
  };

  function viewportMenu(anchor) {
    const cur = getViewport();
    const a = autoSize();
    if (cur.device === 'mobile') {
      showMenu([{ title: '按哪种手机排版' }, ...MOBILE_PRESETS.map((p) => ({ label: `${p.label} · ${p.w} × ${p.h}`, checked: cur.id === p.id, onClick: () => setViewport(p.id) }))], 0, 0, { anchor, minWidth: 260 });
      return;
    }
    showMenu([
      { title: '按哪种电脑屏幕排版（真实比例，再等比缩放显示）' },
      ...PRESETS.map((p) => ({
        label: p.id === 'auto' ? `本机浏览器 · ${a.w} × ${a.h}` : `${p.label} · ${p.w} × ${p.h}`,
        hint: p.id === 'auto' ? '和你现在这台电脑最大化浏览器时一模一样' : '',
        checked: cur.id === p.id, onClick: () => setViewport(p.id),
      })),
      '-',
      { label: '自定义尺寸…', checked: cur.id === 'custom', onClick: async () => {
        const v = await promptDlg({ title: '自定义视口', label: '宽 × 高（像素），例如 1680x900', value: `${cur.w}x${cur.h}` });
        const m = v && /^(\d{3,4})\s*[x×*,\s]\s*(\d{3,4})$/.exec(v.trim());
        if (m) setViewport('custom', +m[1], +m[2]); else if (v) toast('格式像 1680x900', 'err');
      } },
    ], 0, 0, { anchor, minWidth: 300 });
  }

  const api = {
    syncLabel() {
      if (!ed.stage) return;
      const vp = getViewport();
      const pg = app.project().pages.find((p) => p.file === ed.page);
      const hr = ed.host.getBoundingClientRect(), dr = ed.stage.device.getBoundingClientRect();
      label.style.left = dr.left - hr.left + 'px';
      label.style.top = dr.top - hr.top - 26 + 'px';
      label.style.maxWidth = Math.max(260, dr.width) + 'px';
      label.innerHTML = `<b>${esc(pg ? pg.title : '')}</b><span class="fl-dim">${esc(ed.page || '')}</span>
        <button data-vp data-tip="换一种屏幕尺寸">${icon('monitor', 14)}${vp.w} × ${vp.h}${icon('chevDown', 12)}</button>
        ${app.pageLocked(ed.page) ? `<span class="chip yellow">${icon('lock', 12)}本页已锁定</span>` : ''}`;
      label.querySelector('[data-vp]').onclick = (e) => viewportMenu(e.currentTarget);
      zoom.querySelector('.zoom-val').textContent = Math.round(ed.stage.zoom * 100) + '%';
      app.setStatusRight(`视口 ${vp.w}×${vp.h} · ${Math.round(ed.stage.zoom * 100)}%${ed.stage.mode === 'fit' ? '（适应）' : ''}`);
    },
    renderDock() {
      dock.innerHTML = '';
      const add = (t) => {
        const b = el(`<button class="icon-btn" data-tool="${t.id}" data-tip="${esc(t.tip || t.label)}" data-kbd="${esc(comboFor('tool.' + t.id, t.kbd || ''))}" data-tip-place="top">${icon(t.icon, 19)}</button>`);
        b.onclick = () => ed.setTool(t.id);
        dock.appendChild(b);
      };
      const tools = [...ed.tools.values()];
      tools.filter((t) => !t.group).forEach(add);
      const sk = tools.filter((t) => t.group === 'sketch');
      if (sk.length) {
        dock.appendChild(el('<span class="dock-sep"></span>'));
        dock.appendChild(el('<span class="dock-label">草图</span>'));
        sk.forEach(add);
      }
      if (app.sketch && app.sketch.dockTail) { dock.appendChild(el('<span class="dock-sep"></span>')); dock.appendChild(app.sketch.dockTail(ed)); }
      api.syncDock();
    },
    syncDock() {
      dock.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === ed.tool));
      if (app.sketch && app.sketch.syncDock) app.sketch.syncDock(ed, dock);
    },
  };
  api.renderDock();
  const off = onKeymapChange(() => { if (dock.isConnected) api.renderDock(); else off(); });
  return api;
}

// ---------- 三灯判定 ----------
export function hideVerdict(ed) {
  const v = ed.host && ed.host.parentElement && ed.host.parentElement.querySelector('.verdict');
  if (v) v.remove();
}
export function showVerdict(ed, res, extra = {}) {
  if (!res || !ed.host) return;
  hideVerdict(ed);
  if (res.light === 'green') {
    toast(`已写回代码 · 只改了第 ${res.line} 行${res.note ? '。' + res.note : ''}`, 'ok', 2200);
    return;
  }
  const wrap = ed.host.parentElement;
  const yellow = res.light === 'yellow';
  const aff = (res.affected || []).filter((a) => a.tag);
  const card = el(`<div class="verdict ${res.light}">
    <div class="verdict-head"><i class="dot"></i><span class="grow">${yellow ? '已写回，但有连带影响' : '没有写回，页面保持原样'}</span>
      <button class="icon-btn sm" data-a="x">${icon('close', 14)}</button></div>
    <div class="verdict-body">${yellow
      ? `${aff.length ? `会让 ${aff.length} 个元素挪位（页面上橙色闪框）：<ul>${aff.slice(0, 6).map((a) => `<li>&lt;${esc(a.tag)}&gt; 第 ${a.line} 行 · ${esc(a.note || '被挤动')}</li>`).join('')}</ul>` : ''}${res.note ? esc(res.note) : ''}`
      : esc(res.reason || '这次修改不适合直接写回。')}</div>
    <div class="verdict-acts"></div></div>`);
  const acts = card.querySelector('.verdict-acts');
  const btn = (label, kind, fn) => { const b = el(`<button class="btn small ${kind}">${label}</button>`); b.onclick = () => { card.remove(); fn && fn(); }; acts.appendChild(b); };
  if (yellow) {
    btn('保留', 'primary');
    btn('撤销这次修改', '', () => ed.app.bus.undo());
    btn('再转成草图标记', '', () => ed.app.sketch && ed.app.sketch.markFromVerdict(res, extra));
  } else {
    if (!extra.auto) btn('记成草图标记交给 AI', 'primary', () => ed.app.sketch && ed.app.sketch.markFromVerdict(res, extra));
    btn('知道了', extra.auto ? 'primary' : '');
  }
  card.querySelector('[data-a=x]').onclick = () => card.remove();
  wrap.appendChild(card);
  if (aff.length && ed.frame) {
    const rects = aff.map((a) => ed.frame.elByLoc(a.loc)).filter(Boolean).map((n) => ed.pageRect(n));
    ed.ov.flashRects(rects);
  }
  if (yellow) setTimeout(() => { if (card.isConnected && !card.matches(':hover')) card.remove(); }, 9000);
}

// ---------- 右键菜单 ----------
export function openContextMenu(ed, x, y, onElement) {
  const app = ed.app, info = ed.selection;
  if (!onElement || !info) {
    showMenu([
      { label: '在这里新建文本框', icon: 'text', onClick: () => ed.addTextBoxAt(x, y) },
      { label: '切到交互（像真实浏览）', icon: 'hand', kbd: comboFor('tool.interact', 'E'), onClick: () => ed.setTool('interact') },
      '-',
      { label: '适应屏幕', icon: 'fit', kbd: 'Shift+1', onClick: () => ed.stage.fit(true) },
      { label: '实际大小 100%', icon: 'zoomIn', kbd: 'Ctrl+0', onClick: () => ed.stage.actual() },
    ], x, y);
    return;
  }
  const locked = !info.generated && app.elementLocked(ed.page, info.selector);
  showMenu([
    { title: ed.describe(info) },
    info.hasText && !info.generated ? { label: '改文字', icon: 'text', kbd: 'Enter', onClick: () => ed.editTextOf(info.element, null) } : null,
    { label: '选择外面一层', icon: 'parent', kbd: 'Shift+Enter', onClick: () => ed.selectParent() },
    '-',
    { label: '@ 引用到助手', icon: 'at', hint: '让 AI 准确知道你说的是这一块', onClick: () => app.agent.addRef({ kind: 'element', page: ed.page, selector: info.selector, line: info.line, title: `${(app.project().pages.find((p) => p.file === ed.page) || {}).title || ed.page} · ${ed.describe(info)}` }) },
    { label: '添加元素长期规则…', icon: 'sticky', onClick: () => app.notes && app.notes.addFor(info) },
    { label: '记成草图标记…', icon: 'marks', onClick: () => app.sketch && app.sketch.markElement(info) },
    !info.generated ? { label: `在源码里看（第 ${info.line} 行）`, icon: 'code', onClick: () => app.openPanel('codeview') } : null,
    '-',
    !info.generated ? { label: locked ? '解锁' : '锁定（手和 AI 都改不了）', icon: locked ? 'unlock' : 'lock', kbd: 'Ctrl+Shift+L', onClick: () => app.setElementLock(ed.page, info.selector, !locked) } : null,
    { label: '删除', icon: 'trash', kbd: 'Del', danger: true, onClick: () => ed.deleteSelection() },
  ], x, y, { minWidth: 230 });
}

// ---------- 路径条（状态栏左侧） ----------
export function renderCrumbs(ed) {
  const app = ed.app;
  if (!ed.frame || !ed.sel || !ed.sel.isConnected) {
    const t = el('<span class="crumb" style="color:var(--dim)">没有选中元素 · 点页面里的内容选中它</span>');
    app.setCrumbs(t);
    return;
  }
  const chain = [];
  for (let n = ed.sel; n && n.tagName !== 'HTML'; n = n.parentElement) if (n === ed.sel || n.hasAttribute('data-cd-loc') || n.tagName === 'BODY') chain.unshift(n);
  const box = el('<div class="crumbs"></div>');
  chain.forEach((n, i) => {
    const cls = n.classList && n.classList[0] ? '.' + n.classList[0] : '';
    const b = el(`<button class="crumb ${n === ed.sel ? 'on' : ''}">${esc(n.tagName.toLowerCase() + cls)}</button>`);
    b.onclick = () => { if (n.tagName === 'BODY') ed.clearSelection(); else ed.select(n); };
    box.appendChild(b);
    if (i < chain.length - 1) box.appendChild(el('<span class="crumb-sep">›</span>'));
  });
  app.setCrumbs(box);
}
