// 工作台外壳：顶栏（项目/页面/视图切换/保存状态/撤销/助手）、左侧栏+抽屉面板、右侧属性栏、状态栏
import { icon } from '../core/icons.js';
import { el, esc, showMenu, toast, confirmDlg, closeMenu, menuOpen, anyModalOpen, closeTopModal } from '../core/ui.js';
import { bindKey, showKeyHelp } from '../core/keys.js';

const VIEWS = [
  { id: 'overview', label: '总览', icon: 'overview', kbd: 'Alt+1' },
  { id: 'edit', label: '编辑', icon: 'edit', kbd: 'Alt+2' },
  { id: 'present', label: '放映', icon: 'play', kbd: 'F5' },
];

export function buildShell(app) {
  document.body.className = 'wb';
  const root = document.getElementById('app');
  root.innerHTML = `
    <header class="topbar">
      <div class="tb-left">
        <button class="tb-logo" id="tb-home" data-tip="回到首页 · 切换项目"><span class="brand-mark">百</span>CentDeck</button>
        <span class="tb-sep"></span>
        <span class="tb-proj" id="tb-proj"></span>
        <button class="tb-page" id="tb-page" hidden data-tip="切换页面"><span></span>${icon('chevDown', 14)}</button>
      </div>
      <div class="view-switch" id="view-switch"><i class="pill"></i>
        ${VIEWS.map((v) => `<button data-view="${v.id}" data-tip="${v.label}" data-kbd="${v.kbd}">${icon(v.icon, 16)}${v.label}</button>`).join('')}
      </div>
      <div class="tb-right">
        <span class="save-state" id="save-state"><i></i><span>已保存</span></span>
        <button class="icon-btn" id="tb-undo" data-tip="撤销" data-kbd="Ctrl+Z">${icon('undo')}</button>
        <button class="icon-btn" id="tb-redo" data-tip="重做" data-kbd="Ctrl+Shift+Z">${icon('redo')}</button>
        <span class="tb-sep"></span>
        <button class="tb-agent" id="tb-agent" data-tip="召唤助手" data-kbd="Ctrl+K">${icon('sparkle', 16)}助手</button>
        <button class="icon-btn" id="tb-more" data-tip="更多">${icon('more')}</button>
      </div>
    </header>
    <div class="work">
      <nav class="rail" id="rail"></nav>
      <aside class="drawer" id="drawer"><div class="drawer-inner">
        <div class="drawer-head"><span class="drawer-title" id="drawer-title"></span>
          <button class="icon-btn sm" id="drawer-close" data-tip="收起" data-kbd="Esc">${icon('close', 15)}</button></div>
        <div class="drawer-body" id="drawer-body"></div></div></aside>
      <main class="stage-wrap" id="stage-wrap"></main>
      <aside class="inspector" id="inspector"><div class="inspector-inner" id="inspector-body"></div></aside>
      <aside class="agent" id="agent"></aside>
    </div>
    <footer class="statusbar">
      <div class="crumbs" id="crumbs"></div>
      <div class="status-hint" id="status-hint"></div>
      <div class="status-right" id="status-right"></div>
    </footer>`;

  const $ = (s) => root.querySelector(s);
  const refs = {
    stageWrap: $('#stage-wrap'), inspector: $('#inspector'), inspectorBody: $('#inspector-body'),
    agent: $('#agent'), crumbs: $('#crumbs'), hint: $('#status-hint'), statusRight: $('#status-right'),
    drawer: $('#drawer'), drawerBody: $('#drawer-body'),
  };
  app.refs = refs;
  $('#tb-proj').textContent = app.project().name;
  $('#tb-home').onclick = () => app.goHome();
  $('#tb-undo').onclick = () => app.bus.undo();
  $('#tb-redo').onclick = () => app.bus.redo();
  $('#tb-agent').onclick = () => app.toggleAgent();
  $('#drawer-close').onclick = () => openPanel(null);
  $('#view-switch').querySelectorAll('button').forEach((b) => { b.onclick = () => app.setView(b.dataset.view); });
  $('#tb-more').onclick = (e) => showMenu([
    { label: '快捷键一览', icon: 'keyboard', kbd: '?', onClick: showKeyHelp },
    '-',
    { label: '一键还原到模板初始状态', icon: 'reset', danger: true, onClick: () => resetProject(app) },
  ], 0, 0, { anchor: e.currentTarget, align: 'right' });
  $('#tb-page').onclick = (e) => {
    const cur = app.state.page;
    showMenu([{ title: '切换页面' }, ...app.project().pages.map((p) => ({
      label: p.title, hint: p.file, checked: p.file === cur, onClick: () => app.openPage(p.file),
    }))], 0, 0, { anchor: e.currentTarget, minWidth: 230 });
  };

  // ---------- 保存状态 / 撤销状态 ----------
  const saveEl = $('#save-state');
  const saveText = { saved: '已保存', saving: '保存中…', dirty: '待保存…', error: '保存失败' };
  app.bus.on('savestate', (s) => { saveEl.className = 'save-state ' + s; saveEl.lastElementChild.textContent = saveText[s] || s; });
  const syncStack = () => {
    const u = $('#tb-undo'), r = $('#tb-redo');
    if (!u) return;
    u.disabled = !app.bus.canUndo;
    r.disabled = !app.bus.canRedo;
    const top = app.bus.peekUndo();
    u.setAttribute('data-tip', top ? '撤销：' + top.label : '撤销');
  };
  app.bus.on('stack', syncStack);
  syncStack();

  // ---------- 左侧栏与抽屉 ----------
  let activePanel = null;
  function renderRail() {
    const rail = $('#rail');
    if (!rail) return;
    const view = app.state.view;
    rail.innerHTML = '';
    app.bus.panels().filter((p) => !p.views || p.views.includes(view)).forEach((p) => {
      const b = el(`<button class="icon-btn ${activePanel === p.id ? 'on' : ''}" data-tip="${esc(p.title)}" data-tip-place="right" ${p.kbd ? `data-kbd="${p.kbd}"` : ''}>${icon(p.icon, 19)}</button>`);
      const n = p.badge ? p.badge(app) : 0;
      if (n) b.appendChild(el(`<span class="badge">${n}</span>`));
      b.onclick = () => openPanel(activePanel === p.id ? null : p.id);
      rail.appendChild(b);
    });
    rail.appendChild(el('<div class="grow"></div>'));
    const help = el(`<button class="icon-btn" data-tip="快捷键" data-tip-place="right" data-kbd="?">${icon('keyboard', 19)}</button>`);
    help.onclick = showKeyHelp;
    rail.appendChild(help);
  }
  function openPanel(id) {
    const old = app.bus.panels().find((p) => p.id === activePanel);
    if (old && old.onHide) { try { old.onHide(); } catch (e) { console.error(e); } }
    activePanel = id;
    const p = id && app.bus.panels().find((x) => x.id === id);
    refs.drawer.classList.toggle('open', !!p);
    if (p) {
      $('#drawer-title').textContent = p.title;
      refs.drawerBody.innerHTML = '';
      p.render(refs.drawerBody, app);
    }
    renderRail();
  }
  app.openPanel = openPanel;
  app.activePanel = () => activePanel;
  app.renderRail = renderRail;
  app.bus.on('panels', renderRail);
  app.bus.on('project', renderRail);

  // ---------- 视图切换条 ----------
  app.syncViewSwitch = () => {
    const sw = $('#view-switch');
    if (!sw) return;
    const btns = [...sw.querySelectorAll('button')];
    const on = btns.find((b) => b.dataset.view === app.state.view);
    btns.forEach((b) => b.classList.toggle('on', b === on));
    const pill = sw.querySelector('.pill');
    if (on) { pill.style.width = on.offsetWidth + 'px'; pill.style.transform = `translateX(${on.offsetLeft - 3}px)`; }
    const pageBtn = $('#tb-page');
    pageBtn.hidden = app.state.view !== 'edit';
    const pg = app.project().pages.find((p) => p.file === app.state.page);
    pageBtn.querySelector('span').textContent = pg ? pg.title : '';
    if (activePanel) {
      const p = app.bus.panels().find((x) => x.id === activePanel);
      if (p && p.views && !p.views.includes(app.state.view)) openPanel(null);
    }
    renderRail();
  };
  app.setHint = (html) => { refs.hint.innerHTML = html || ''; };
  app.setStatusRight = (html) => { refs.statusRight.innerHTML = html || ''; };
  app.setCrumbs = (node) => { refs.crumbs.innerHTML = ''; if (node) refs.crumbs.appendChild(node); };
}

async function resetProject(app) {
  const ok = await confirmDlg({
    title: '一键还原', danger: true, okLabel: '全部还原',
    body: '把<b>所有页面</b>恢复到刚创建时的样子，并清空全部修改、历史版本、草图标记、便签和锁定。<br><b>此操作不能撤销。</b>',
  });
  if (!ok) return;
  try {
    const proj = await app.api.resetProject(app.project().id);
    app.state.project = proj;
    app.bus.clearStacks();
    app.bus.emit('project', proj);
    await app.reloadView();
    toast('已还原到初始状态', 'ok');
  } catch { /* api 已提示 */ }
}

// 全局快捷键（只在工作台里生效）
export function bindShellKeys(app) {
  const inWb = () => !!app.state.project;
  bindKey('Esc', { hidden: true, field: true, priority: 100, run: () => {
    if (menuOpen()) { closeMenu(); return; }
    if (anyModalOpen()) { closeTopModal(); return; }
    return false;
  } });
  bindKey(['Ctrl+Z'], { label: '撤销', group: '通用', when: inWb, run: () => { app.bus.undo(); } });
  bindKey(['Ctrl+Shift+Z', 'Ctrl+Y'], { label: '重做', group: '通用', when: inWb, run: () => { app.bus.redo(); } });
  bindKey('Ctrl+S', { label: '保存（改动会自动保存）', group: '通用', field: true, when: inWb, run: () => { app.bus.flushMeta(); toast('所有改动都已自动保存', 'ok', 1600); } });
  bindKey('Ctrl+K', { label: '召唤 / 收起助手', group: '通用', field: true, when: inWb, run: () => { app.toggleAgent(); } });
  bindKey('?', { label: '快捷键一览', group: '通用', run: () => { showKeyHelp(); } });
  bindKey('Alt+1', { label: '总览', group: '视图', when: inWb, run: () => { app.setView('overview'); } });
  bindKey('Alt+2', { label: '编辑', group: '视图', when: inWb, run: () => { app.setView('edit'); } });
  bindKey(['F5', 'Alt+3'], { label: '放映（从首页）', group: '视图', field: true, when: inWb, run: () => { app.present(null); } });
  bindKey('Shift+F5', { label: '放映（从当前页）', group: '视图', field: true, when: inWb, run: () => { app.present(app.state.page); } });
}
