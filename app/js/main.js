// main.js —— 入口与壳：首页（模板库/我的项目）、顶部栏、视图切换（总览/编辑/放映）、
// 编辑视图（engine 编排：选中/改字/样式/微调/缩放/新增/删除/拖动 + 三灯判定 + 锁定）。
//
// 模块边界：本文件只管"壳"和"编辑视图编排"；具体功能（草图/便签/素材/规范/图层/历史）
// 都以内置插件形式注册进 bus（见各文件末尾的 setup）。engine/ 只被本文件直接调用。

import { api } from './api.js';
import { createBus } from './bus.js';
import { esc, el, toast, toastError, openModal, closeTopModal, anyModalOpen, confirmDlg, promptDlg, uid } from './ui.js';
import { render } from './engine/render.js';
import { applyEdit, getStyleProp } from './engine/writeback.js';
import { setup as setupOverview } from './overview.js';
import { setup as setupPresent } from './present.js';
import { setup as setupSketch } from './sketch.js';
import { setup as setupNotes } from './notes.js';
import { setup as setupAssets } from './assets.js';
import { setup as setupTokens } from './tokens.js';
import { setup as setupLayers } from './layers.js';
import { setup as setupHistory } from './history.js';

// ---------- 全局骨架 ----------
const $ = (sel) => document.querySelector(sel);
const appRoot = $('#app');

const bus = createBus({
  api,
  onError: toastError,
  onSaveState: renderSaveState,
});

// 全局状态（内核持有，插件通过 ctx 访问）
const state = {
  project: null,       // 当前项目（project.json + tokens）
  view: 'overview',    // overview | edit | present
  activePanel: null,   // 当前打开的左侧面板 id
  templates: [],
};

// ---------- 编辑器（编辑视图核心编排） ----------
const editor = {
  session: null,       // engine render 会话
  page: null,          // 当前页 file 路径
  pageTitle: '',
  selection: null,     // 当前选中信息（engine buildInfo 结构）
  measure: null,       // session.makeMeasure() 生成的波及度量回调
  editingText: false,  // 正在双击改字
  lastResult: null,    // 最近一次三灯判定结果（判定面板显示用）
  addingText: false,   // "新增文本框"等待点选位置
};

// 外部（插件）可调的编辑器接口（越界防护：插件不直接碰 engine）
const editorApi = {
  get session() { return editor.session; },
  get selection() { return editor.selection; },
  get page() { return editor.page; },
  get addingText() { return editor.addingText; },
  selectByLoc(loc) { if (editor.session) editor.session.select(loc); },
  clearSelection() { if (editor.session) editor.session.clearSelection(); },
  describe(info) { return editor.session ? editor.session.describe(info) : ''; },
  iframeRect() { const f = $('#stage-frame'); return f ? f.getBoundingClientRect() : null; },
  scroll() {
    const w = editor.session && editor.session.window;
    return w ? { x: w.scrollX, y: w.scrollY } : { x: 0, y: 0 };
  },
  setScroll(x, y) { const w = editor.session && editor.session.window; if (w) w.scrollTo(x, y); },
  // 重新加载当前页（历史恢复 / 一键还原 / 规范应用后）
  async reloadCurrentPage() {
    if (!state.project) return;
    if (state.view === 'edit' && editor.page) await openPage(editor.page, editor.pageTitle, { keepView: true });
    if (state.view === 'overview') await overviewApi.refresh();
  },
};

// ---------- 上下文对象（传给每个插件 setup） ----------
const ctx = {
  bus,
  project: () => state.project,
  view: () => state.view,
  editor: editorApi,
  openProject,
  reloadCurrentPage: () => editorApi.reloadCurrentPage(),
  refreshProject: async () => {
    if (!state.project) return;
    state.project = await api.getProject(state.project.id);
    bus.emit('project', state.project);
  },
  // 选中元素是否被锁（元素锁或整页锁）
  isLocked: (info) => isLocked(info),
  // 总览双击进编辑（内核动作，借命令总线让插件调用）
  __openPageInEdit(file, title) {
    setView('edit');
    openPage(file, title, { keepView: true });
  },
  // 供草图/便签锚定用：把当前页某 selector 元素的屏幕矩形（相对工作台视口）算出来
  rectOfSelector(sel) {
    const s = editor.session;
    if (!s || !s.document) return null;
    const e = s.parsed.bySelector(sel);
    if (!e) return null;
    const dom = s.document.querySelector(`[data-loc="${e.loc}"]`);
    if (!dom) return null;
    const fr = editorApi.iframeRect();
    if (!fr) return null;
    const r = dom.getBoundingClientRect();
    return { x: fr.left + r.left, y: fr.top + r.top, w: r.width, h: r.height };
  },
};

// ---------- 锁定（内核把关：插件与 AI 都绕不过 bus 这一层） ----------
function locks() {
  const p = state.project;
  if (!p) return { pages: [], elements: [] };
  if (!p.locks) p.locks = { pages: [], elements: [] };
  if (!Array.isArray(p.locks.pages)) p.locks.pages = [];
  if (!Array.isArray(p.locks.elements)) p.locks.elements = [];
  return p.locks;
}
function pageLocked(page) { return locks().pages.includes(page); }
function elementLocked(page, selector) {
  return locks().elements.some((x) => x.page === page && x.selector === selector);
}
function isLocked(info) {
  if (!state.project || !editor.page) return false;
  if (pageLocked(editor.page)) return true;
  if (!info) return false;
  if (info.generated) return false;
  return elementLocked(editor.page, info.selector);
}
function setElementLock(page, selector, on) {
  const L = locks();
  const i = L.elements.findIndex((x) => x.page === page && x.selector === selector);
  if (on && i < 0) L.elements.push({ page, selector });
  if (!on && i >= 0) L.elements.splice(i, 1);
}
function setPageLock(page, on) {
  const L = locks();
  const i = L.pages.indexOf(page);
  if (on && i < 0) L.pages.push(page);
  if (!on && i >= 0) L.pages.splice(i, 1);
}

// ---------- 保存状态指示 ----------
function renderSaveState(s) {
  const elx = $('#save-state');
  if (!elx) return;
  const map = { saved: '已保存', saving: '保存中…', dirty: '待保存…', error: '保存失败' };
  elx.textContent = map[s] || s;
  elx.className = 'save-state ' + s;
}

// ============================================================
// 首页：模板库 + 我的项目
// ============================================================
async function renderHome() {
  state.project = null;
  bus.clearStacks();
  destroyEditor();
  document.body.className = 'home';
  appRoot.innerHTML = `
    <div class="home-wrap">
      <header class="home-head">
        <h1>CentDeck <span>百映</span></h1>
        <p>给不会写代码的人用的网页工作台：看全貌、点着改、说不清就画下来交给 AI。</p>
      </header>
      <section>
        <h2>我的项目</h2>
        <div class="card-grid" id="home-projects"><div class="panel-empty">读取中…</div></div>
      </section>
      <section>
        <h2>从模板新建</h2>
        <div class="card-grid" id="home-templates"><div class="panel-empty">读取中…</div></div>
      </section>
    </div>`;
  try {
    const [projects, templates] = await Promise.all([api.listProjects(), api.listTemplates()]);
    state.templates = templates;
    const pbox = $('#home-projects');
    if (!projects.length) {
      pbox.innerHTML = '<div class="panel-empty">还没有项目，从下面挑一个模板开始吧。</div>';
    } else {
      pbox.innerHTML = '';
      projects.forEach((p) => {
        const card = el(`<div class="card project-card">
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-desc">${esc(p.template ? '模板：' + p.template : '')} · ${p.pages.length} 页</div>
          <div class="card-foot"><button class="btn primary">打开</button></div>
        </div>`);
        card.querySelector('button').onclick = () => openProject(p.id);
        card.onclick = (e) => { if (e.target.tagName !== 'BUTTON') openProject(p.id); };
        pbox.appendChild(card);
      });
    }
    const tbox = $('#home-templates');
    tbox.innerHTML = '';
    templates.forEach((t) => {
      const card = el(`<div class="card tpl-card">
        <div class="card-name">${esc(t.name)}</div>
        <div class="card-desc">${esc(t.description || '')}</div>
        <div class="card-foot"><span class="card-pages">${t.pages.length} 个页面</span>
          <button class="btn">用此模板创建</button></div>
      </div>`);
      card.querySelector('button').onclick = async () => {
        const name = await promptDlg({
          title: `用「${t.name}」创建项目`,
          label: '给项目起个名字',
          placeholder: '例如：我的小店',
          value: t.name,
          okLabel: '创建',
        });
        if (name == null) return;
        try {
          const proj = await api.createProject(t.id, name);
          toast(`项目「${proj.name}」已创建`, 'ok');
          openProject(proj.id);
        } catch { /* api 已提示 */ }
      };
      tbox.appendChild(card);
    });
  } catch { /* api 已提示 */ }
}

// ============================================================
// 打开项目 → 工作台壳
// ============================================================
async function openProject(id) {
  let proj;
  try {
    proj = await api.getProject(id);
  } catch { return; }
  state.project = proj;
  bus.clearStacks();
  bus.bindProject(() => state.project, () => {});
  buildShell();
  state.view = null; // 强制 setView 重新进场
  setView('overview');
  bus.emit('project', proj);
}

function buildShell() {
  document.body.className = 'workbench';
  appRoot.innerHTML = `
    <header id="topbar">
      <div class="tb-left">
        <button id="btn-home" class="tb-btn" title="返回首页 / 切换项目">⌂ 项目</button>
        <span id="proj-name" class="proj-name"></span>
      </div>
      <div class="tb-center">
        <div class="view-tabs" role="tablist">
          <button data-view="overview" class="view-tab" title="所有页面摊在画布上">总览</button>
          <button data-view="edit" class="view-tab" title="双击总览里的页面也会进来">编辑</button>
          <button data-view="present" class="view-tab" title="像真实用户一样放映">放映</button>
        </div>
      </div>
      <div class="tb-right">
        <button id="btn-undo" class="tb-btn" title="撤销（Ctrl+Z）">↩ 撤销</button>
        <button id="btn-redo" class="tb-btn" title="重做（Ctrl+Y）">↪ 重做</button>
        <span id="save-state" class="save-state saved">已保存</span>
        <span id="tb-plugins"></span>
        <button id="btn-reset" class="tb-btn danger" title="恢复到刚创建时的样子">一键还原</button>
      </div>
    </header>
    <div id="pagebar" hidden></div>
    <div id="workarea">
      <aside id="panel-rail"></aside>
      <aside id="panel-box" hidden><div id="panel-head"><span id="panel-title"></span><button id="panel-close" title="关闭面板">×</button></div><div id="panel-host"></div></aside>
      <main id="stage"></main>
      <aside id="props" hidden></aside>
    </div>
    <div id="statusbar">
      <div id="crumbs" class="crumbs"></div>
      <div id="verdict-slot"></div>
    </div>`;

  $('#proj-name').textContent = state.project.name;
  $('#btn-home').onclick = () => { destroyEditor(); renderHome(); };
  $('#btn-undo').onclick = () => bus.undo();
  $('#btn-redo').onclick = () => bus.redo();
  $('#btn-reset').onclick = onReset;
  document.querySelectorAll('.view-tab').forEach((b) => {
    b.onclick = () => setView(b.dataset.view);
  });
  $('#panel-close').onclick = () => togglePanel(null);
  renderPanelRail();
  renderToolbarPlugins();
  renderUndoRedo();
  bus.on('stack', renderUndoRedo);
  bus.on('panels', renderPanelRail);
  bus.on('toolbar', renderToolbarPlugins);
}

function renderUndoRedo() {
  const u = $('#btn-undo'), r = $('#btn-redo');
  if (!u) return;
  u.disabled = !bus.canUndo;
  r.disabled = !bus.canRedo;
  const top = bus.peekUndo();
  u.title = top ? `撤销：${top.label}（Ctrl+Z）` : '撤销（Ctrl+Z）';
}

// ---------- 面板（插件注册的左侧面板） ----------
function renderPanelRail() {
  const rail = $('#panel-rail');
  if (!rail) return;
  rail.innerHTML = '';
  bus.panels().filter((p) => p.side !== 'right').forEach((p) => {
    const b = el(`<button class="rail-btn" title="${esc(p.title)}"><span class="rail-ico">${esc(p.icon || '▦')}</span><span class="rail-txt">${esc(p.title)}</span></button>`);
    b.dataset.panel = p.id;
    if (state.activePanel === p.id) b.classList.add('on');
    b.onclick = () => togglePanel(state.activePanel === p.id ? null : p.id);
    rail.appendChild(b);
  });
}

function togglePanel(id) {
  const box = $('#panel-box'), host = $('#panel-host');
  if (!box) return;
  // 卸载旧面板
  const old = bus.panels().find((p) => p.id === state.activePanel);
  if (old && old.onHide) { try { old.onHide(); } catch (e) { console.error(e); } }
  state.activePanel = id;
  if (!id) {
    box.hidden = true;
    renderPanelRail();
    return;
  }
  const p = bus.panels().find((x) => x.id === id);
  if (!p) return;
  $('#panel-title').textContent = p.title;
  host.innerHTML = '';
  box.hidden = false;
  p.render(host, ctx);
  if (p.onShow) p.onShow(ctx);
  renderPanelRail();
}

// ---------- 工具栏插件按钮 ----------
function renderToolbarPlugins() {
  const box = $('#tb-plugins');
  if (!box) return;
  box.innerHTML = '';
  bus.toolbarActions().forEach((a) => {
    if (a.when && !a.when(ctx)) return;
    const b = el(`<button class="tb-btn" title="${esc(a.title)}">${esc(a.icon || '')} ${esc(a.title)}</button>`);
    b.onclick = () => a.onClick(ctx);
    box.appendChild(b);
  });
}

// ---------- 一键还原 ----------
async function onReset() {
  const ok = await confirmDlg({
    title: '一键还原',
    danger: true,
    okLabel: '全部还原',
    body: `这将把<b>所有页面</b>恢复到刚创建时的样子，并清空：<br>
      · 你对页面做过的全部修改与历史版本<br>
      · 全部草图标记、便签、锁定<br>
      <b>此操作不可撤销。</b>确定继续吗？`,
  });
  if (!ok) return;
  try {
    state.project = await api.resetProject(state.project.id);
    bus.clearStacks();
    toast('已还原到初始状态', 'ok');
    bus.emit('project', state.project);
    if (state.view === 'edit' && editor.page) await openPage(editor.page, editor.pageTitle, { keepView: true });
    else await overviewApi.refresh();
  } catch { /* api 已提示 */ }
}

// ============================================================
// 视图切换
// ============================================================
const overviewApi = { refresh: async () => {}, enter: () => {}, leave: () => {} };
const presentApi = { enter: () => {}, leave: () => {} };

function setView(view) {
  if (!state.project) return;
  const prev = state.view;
  const stageEl = $('#stage');
  if (prev === view && stageEl && stageEl.childElementCount) return; // 已在该视图且舞台有内容
  // 离开旧视图
  if (prev === 'edit') leaveEdit();
  if (prev === 'overview') overviewApi.leave();
  if (prev === 'present') presentApi.leave();
  state.view = view;
  document.body.dataset.view = view;
  document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $('#pagebar').hidden = view !== 'edit';
  $('#props').hidden = view !== 'edit';
  const stage = $('#stage');
  stage.innerHTML = '';
  stage.className = 'stage-' + view;
  if (view === 'overview') overviewApi.enter(stage);
  if (view === 'edit') enterEdit(stage);
  if (view === 'present') presentApi.enter(stage);
  bus.emit('view', view);
}

// ============================================================
// 编辑视图
// ============================================================
function enterEdit(stage) {
  stage.innerHTML = '<iframe id="stage-frame" title="页面编辑"></iframe>';
  renderPagebar();
  renderPropsEmpty();
  renderCrumbs();
  renderVerdict(null);
  const first = state.project.pages[0];
  if (first) openPage(first.file, first.title, { keepView: true });
}

function leaveEdit() {
  destroyEditor();
  editor.page = null;
  editor.selection = null;
}

function destroyEditor() {
  if (editor.session) {
    try { editor.session.destroy(); } catch (e) { /* 忽略 */ }
    editor.session = null;
  }
  editor.measure = null;
  editor.editingText = false;
  editor.addingText = false;
}

function renderPagebar() {
  const bar = $('#pagebar');
  bar.innerHTML = '';
  state.project.pages.forEach((p) => {
    const b = el(`<button class="page-tab">${esc(p.title)}</button>`);
    if (p.file === editor.page) b.classList.add('on');
    b.onclick = () => openPage(p.file, p.title, { keepView: true });
    bar.appendChild(b);
  });
  // 页签右侧：整页锁
  const lockBtn = el(`<button class="page-lock" title="锁住后整页只读，防止误改"></button>`);
  const syncLock = () => {
    const on = pageLocked(editor.page);
    lockBtn.textContent = on ? '🔒 本页已锁' : '🔓 锁本页';
    lockBtn.classList.toggle('on', on);
  };
  lockBtn.onclick = async () => {
    const on = !pageLocked(editor.page);
    await bus.doMeta({
      label: on ? `锁定页面「${editor.pageTitle}」` : `解锁页面「${editor.pageTitle}」`,
      apply: (proj) => setPageLock(editor.page, on),
      revert: (proj) => setPageLock(editor.page, !on),
    });
    syncLock();
    updatePropsLockUI();
  };
  bar.appendChild(lockBtn);
  bar._syncLock = syncLock;
  syncLock();
}

// 打开一页并建立 engine 会话
let openPageToken = 0; // 竞态防护：总览双击进编辑等场景下两次 openPage 只认最后一次
async function openPage(file, title, opts = {}) {
  const proj = state.project;
  if (!proj) return;
  let source;
  try {
    source = await api.readFile(proj.id, file);
  } catch { return; }
  destroyEditor();
  editor.page = file;
  editor.pageTitle = title || file;
  editor.selection = null;
  renderPagebar();
  renderCrumbs();
  renderPropsEmpty();
  renderVerdict(null);
  const iframe = $('#stage-frame');
  if (!iframe) return;
  const myToken = ++openPageToken;
  try {
    const session = await render(iframe, source, {
      onSelect: onEngineSelect,
      onDrop: onEngineDrop,
      onDblClick: onEngineDblClick,
      onRender: onEngineRender,
    });
    if (myToken !== openPageToken) { try { session.destroy(); } catch (e2) { /* 忽略 */ } return; } // 已被更新的 openPage 取代
    editor.session = session;
    editor.measure = session.makeMeasure();
    bindIframeKeys(session);
    bus.emit('rendered');
  } catch (e) {
    console.error(e);
    toastError(new Error('页面渲染失败：' + (e.message || e)));
  }
}

// engine 重渲染后：恢复滚动位置由 doSourceCommand 负责；这里同步选中态与插件
function onEngineRender() {
  if (editor.session) bindIframeKeys(editor.session);
  bus.emit('rendered');
}

// 在 iframe 文档里补挂编辑快捷键（engine 自身只处理 Esc 取消选中）：
// 方向键微调、Delete 删除、Ctrl+Z/Y 撤销重做在 iframe 获得焦点时也要生效。
function bindIframeKeys(session) {
  const doc = session.document;
  if (!doc || doc.__cdKeysBound) return;
  Object.defineProperty(doc, '__cdKeysBound', { value: true, configurable: true });
  doc.addEventListener('keydown', (e) => {
    if (editor.editingText) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey)) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); bus.undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); bus.redo(); return; }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selection) {
      e.preventDefault();
      deleteSelection();
      return;
    }
    const st = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (d && editor.selection) {
      e.preventDefault();
      nudgeSelection(d[0], d[1]);
    }
  });
}

// 重渲染（撤销/重做/命令应用）后：engine 按 selector 恢复了选中，界面层跟着刷新面板与路径条
bus.on('rendered', () => {
  if (state.view !== 'edit' || !editor.session) return;
  const info = editor.session.getSelection();
  editor.selection = info;
  if (info) renderProps(info); else renderPropsEmpty();
  renderCrumbs();
});

// ---------- 选中 ----------
function onEngineSelect(info) {
  if (editor.addingText) return; // 点选位置模式下不改选中
  editor.selection = info;
  renderCrumbs();
  renderProps(info);
  bus.emit('select', info);
}

// ---------- 三灯判定面板 ----------
function renderVerdict(result, extra = {}) {
  const slot = $('#verdict-slot');
  if (!slot) return;
  editor.lastResult = result;
  if (!result) { slot.innerHTML = ''; return; }
  const { light } = result;
  const box = el(`<div class="verdict ${light}"></div>`);
  let head = '', body = '';
  if (light === 'green') {
    head = '✅ 绿灯 · 已写回';
    body = `只动了第 ${result.line} 行。${result.note ? esc(result.note) : ''}`;
  } else if (light === 'yellow') {
    head = '🟡 黄灯 · 已写回，但有连带影响';
    const list = (result.affected || []).slice(0, 6).map((a) =>
      `<li>&lt;${esc(a.tag || '?')}&gt; 第 ${a.line != null ? a.line : '?'} 行 — ${esc(a.note || '被挤动')}</li>`).join('');
    body = `改动已保存，但可能影响 ${result.affected.length} 个元素（页面上橙色框闪烁的就是它们）：<ul>${list}</ul>${result.note ? esc(result.note) : ''}`;
  } else {
    head = '🔴 红灯 · 没有写回，已恢复原样';
    body = esc(result.reason || '这次修改不适合直接写回。');
  }
  box.innerHTML = `<div class="verdict-head">${head}</div><div class="verdict-body">${body}</div><div class="verdict-actions"></div>`;
  const acts = box.querySelector('.verdict-actions');
  if (light === 'yellow') {
    const keep = el('<button class="btn small primary">保留</button>');
    keep.onclick = () => renderVerdict(null);
    const undoB = el('<button class="btn small">撤销这次修改</button>');
    undoB.onclick = () => { renderVerdict(null); bus.undo(); };
    const toMark = el('<button class="btn small">转为草图标记</button>');
    toMark.onclick = () => { bus.runCommand('sketch.markFromVerdict', ctx, result, extra); renderVerdict(null); };
    acts.append(keep, undoB, toMark);
  } else if (light === 'red') {
    const toMark = el('<button class="btn small primary">转为草图标记</button>');
    toMark.onclick = () => { bus.runCommand('sketch.markFromVerdict', ctx, result, extra); renderVerdict(null); };
    const okB = el('<button class="btn small">知道了</button>');
    okB.onclick = () => renderVerdict(null);
    acts.append(toMark, okB);
  } else {
    const okB = el('<button class="btn small">好</button>');
    okB.onclick = () => renderVerdict(null);
    acts.append(okB);
  }
  slot.innerHTML = '';
  slot.appendChild(box);
}

// ---------- 页面源码命令（text/style/move/insert/delete 共用通道） ----------
// 走 bus.do：apply = PUT 保存 + 重渲染（保持滚动位置）；revert = 恢复 beforeSource。
// 判定（三灯）只在正向 apply 时执行；黄灯波及用 session.showAffected 橙框闪烁。
async function doSourceCommand({ label, makeEdit, buildSource, onResult, forceVerdict }) {
  const session = editor.session;
  if (!session) return null;
  const page = editor.page;
  const beforeSource = session.source;
  const scroll = editorApi.scroll();

  async function run(source, { judge }) {
    let result = null;
    let newSource = null;
    if (buildSource) {
      // insert/delete 等：由调用方直接给出新源码与判定结果
      const out = buildSource(source);
      newSource = out.newSource;
      result = out.result;
    } else {
      const edit = makeEdit(source);
      if (!edit) return null;
      result = applyEdit(source, edit, { measure: editor.measure || undefined });
      if (result.light === 'red') return { result, newSource: null };
      newSource = result.newSource;
    }
    if (judge) {
      // 黄灯：波及元素橙框闪烁
      if (result && result.light === 'yellow' && result.affected && editor.session) {
        editor.session.showAffected(result.affected);
      }
      renderVerdict(result, { label });
      if (onResult) onResult(result);
    }
    await api.writeFile(state.project.id, page, newSource);
    await editor.session.setSource(newSource);
    editorApi.setScroll(scroll.x, scroll.y);
    return { result, newSource };
  }

  const cmd = {
    label,
    page,
    beforeSource,
    afterSource: null,
    apply: async () => {
      const r = await run(cmd.beforeSource, { judge: true });
      if (!r) throw new Error('命令构造失败');
      if (r.newSource == null) {
        // 红灯：不落入撤销栈（没有实际改动）
        const err = new Error('红灯未写回');
        err.redLight = true;
        err.result = r.result;
        throw err;
      }
      cmd.afterSource = r.newSource;
    },
    revert: async () => {
      await api.writeFile(state.project.id, page, cmd.beforeSource);
      await editor.session.setSource(cmd.beforeSource);
      editorApi.setScroll(scroll.x, scroll.y);
      renderVerdict(null);
    },
  };
  try {
    await bus.do(cmd);
    return cmd.afterSource ? { ok: true } : null;
  } catch (e) {
    if (e.redLight) {
      // 红灯：展示判定面板（渲染层已由调用方 restore/未动）
      renderVerdict(e.result, { label });
      if (onResult) onResult(e.result);
      return { ok: false, red: true, result: e.result };
    }
    return { ok: false };
  }
}

// ---------- 双击改字 ----------
function onEngineDblClick(info) {
  if (!info) return;
  if (isLocked(info)) { toast('该元素已锁定，先解锁再改', 'err'); return; }
  if (info.generated) {
    // 程序生成：直接给出红灯判定并引导转标记
    const result = applyEdit(editor.session.source, {
      kind: 'text', target: { generated: true, selector: info.selector, text: info.text || '' }, newText: ' ',
    });
    renderVerdict(result, { label: '改字' });
    return;
  }
  if (!info.textOnly) {
    toast('它不是一行纯文字，请双击里面具体的那段文字', 'err');
    return;
  }
  const dom = info.element;
  if (!dom) return;
  editor.editingText = true;
  const oldText = dom.textContent;
  dom.contentEditable = 'true';
  dom.focus();
  // 全选文字
  const range = editor.session.document.createRange();
  range.selectNodeContents(dom);
  const selObj = editor.session.window.getSelection();
  selObj.removeAllRanges();
  selObj.addRange(range);

  let done = false;
  const commit = async (cancel) => {
    if (done) return;
    done = true;
    dom.contentEditable = 'false';
    editor.editingText = false;
    const nt = dom.textContent;
    if (cancel || nt === oldText) {
      dom.textContent = oldText; // 无改动或取消：原样放回（只改视觉层，没碰源码）
      return;
    }
    // 铁律：保存到服务端的必须是原始 source（session.source 无 instrument）
    await doSourceCommand({
      label: `改字：「${(oldText || '').trim().slice(0, 10)}」→「${nt.trim().slice(0, 10)}」`,
      makeEdit: () => ({ kind: 'text', target: info.loc, newText: nt }),
    });
  };
  dom.addEventListener('blur', () => commit(false), { once: true });
  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(false); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(true); }
  });
}

// ---------- 拖动松手 ----------
async function onEngineDrop(drop) {
  const info = editor.session ? editor.session.getSelection() : null;
  const targetInfo = drop.generated ? { generated: true, selector: drop.selector } : (info && info.loc === drop.loc ? info : { loc: drop.loc, selector: drop.selector });
  if (!drop.generated && isLocked({ ...targetInfo, loc: drop.loc })) {
    drop.restore();
    toast('该元素已锁定，已恢复原位', 'err');
    return;
  }
  // 铁律：松手后调 applyEdit(kind:'move')，drop 给的 crossed 原样传入
  const r = await doSourceCommand({
    label: `移动 <${drop.generated ? '?' : (editor.session.parsed.byLoc(drop.loc) || {}).tag || '?'}>（${drop.dx}, ${drop.dy}）`,
    makeEdit: () => drop.generated
      ? { kind: 'move', target: { generated: true, selector: drop.selector }, dx: drop.dx, dy: drop.dy, crossed: drop.crossed }
      : { kind: 'move', target: drop.loc, dx: drop.dx, dy: drop.dy, crossed: drop.crossed },
  });
  if (r && r.red) {
    // 铁律：红灯调 drop.restore() 恢复原样
    drop.restore();
  }
}

// ---------- 样式修改（属性面板入口） ----------
async function applyStyleToSelection(props, label) {
  const info = editor.selection;
  if (!info) return;
  if (isLocked(info)) { toast('该元素已锁定', 'err'); return; }
  const target = info.generated ? { generated: true, selector: info.selector, text: info.text } : info.loc;
  await doSourceCommand({
    label,
    makeEdit: () => ({ kind: 'style', target, props }),
  });
}

// ---------- 键盘微调（方向键 1px / Shift 10px，走 move 通道） ----------
async function nudgeSelection(dx, dy) {
  const info = editor.selection;
  if (!info || info.generated) return;
  if (isLocked(info)) { toast('该元素已锁定', 'err'); return; }
  await doSourceCommand({
    label: `微调（${dx}, ${dy}）`,
    makeEdit: () => ({ kind: 'move', target: info.loc, dx, dy, crossed: false }),
  });
}

// ---------- 删除选中元素 ----------
async function deleteSelection() {
  const info = editor.selection;
  if (!info || !editor.session) return;
  if (isLocked(info)) { toast('该元素已锁定，先解锁再删', 'err'); return; }
  if (info.generated) {
    const result = applyEdit(editor.session.source, {
      kind: 'text', target: { generated: true, selector: info.selector, text: info.text || '' }, newText: ' ',
    });
    renderVerdict({ ...result, reason: '这块内容由程序生成，源码里没有它自己的一行，没法直接删。' }, { label: '删除' });
    return;
  }
  const ok = await confirmDlg({
    title: '删除元素',
    danger: true,
    okLabel: '删除',
    body: `确定删除 ${esc(editor.session.describe(info))} 吗？<br>可以撤销（Ctrl+Z），历史版本里也有备份。`,
  });
  if (!ok) return;
  const session = editor.session;
  const elInfo = session.parsed.byLoc(info.loc);
  const beforeRects = session.snapRects();
  await doSourceCommand({
    label: `删除 <${elInfo.tag}>（第 ${elInfo.line} 行）`,
    buildSource: (source) => {
      // 删除整段源码（含独占一行的缩进与换行）
      let s = elInfo.openStart, e2 = elInfo.closeEnd;
      const ls = source.lastIndexOf('\n', s - 1) + 1;
      let le = source.indexOf('\n', e2);
      if (le < 0) le = source.length;
      if (!/\S/.test(source.slice(ls, s)) && !/\S/.test(source.slice(e2, le))) { s = ls; e2 = Math.min(le + 1, source.length); }
      const newSource = source.slice(0, s) + source.slice(e2);
      return { newSource, result: null }; // 判定在重渲染后做（需要新几何）
    },
    onResult: () => {},
  }).then(async (r) => {
    if (!r || !r.ok) return;
    // 删除后的波及检测：对比删前快照与当前几何
    const afterRects = editor.session.snapRects();
    const parsedAfter = editor.session.parsed;
    const moved = [];
    Object.keys(beforeRects).forEach((k) => {
      const a = beforeRects[k], b = afterRects[k];
      if (!b) return; // 被删掉的元素本身
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) {
        const e = parsedAfter.byLoc(+k);
        if (e) moved.push({ loc: +k, selector: e.selector, line: e.line, tag: e.tag, note: '被挤动（补位）' });
      }
    });
    if (moved.length) {
      editor.session.showAffected(moved);
      renderVerdict({ light: 'yellow', affected: moved, line: elInfo.line, selector: elInfo.selector }, { label: '删除' });
    } else {
      renderVerdict({ light: 'green', line: elInfo.line, selector: elInfo.selector, note: '已删除，没有影响别的元素。' }, { label: '删除' });
    }
    editor.selection = null;
    renderPropsEmpty();
    renderCrumbs();
  });
}

// ---------- 新增文本框 ----------
function startAddText() {
  if (!editor.session) return;
  if (pageLocked(editor.page)) { toast('本页已锁定，先解锁', 'err'); return; }
  editor.addingText = !editor.addingText;
  const btn = $('#prop-addtext');
  if (btn) btn.classList.toggle('on', editor.addingText);
  if (editor.addingText) {
    toast('点一下页面上想放文本框的位置（会放在你点中的那个区域里）', '', 5000);
    const doc = editor.session.document;
    const onClick = (e) => {
      if (!editor.addingText) return;
      e.preventDefault();
      e.stopPropagation();
      editor.addingText = false;
      if (btn) btn.classList.remove('on');
      doc.removeEventListener('mousedown', onClick, true);
      addTextBoxAt(e);
    };
    doc.addEventListener('mousedown', onClick, true);
  }
}

async function addTextBoxAt(e) {
  const session = editor.session;
  const doc = session.document;
  // 找点中的容器（最近的 section/header/footer/nav/main/article 且带门牌号）
  let t = e.target;
  const cont = t && t.closest ? t.closest('section, header, footer, nav, main, article, aside') : null;
  if (!cont || !cont.hasAttribute('data-loc')) {
    toast('请点在页面的某个区域里（比如某个版块内部）', 'err');
    return;
  }
  const contInfo = session.parsed.byLoc(+cont.getAttribute('data-loc'));
  const cr = cont.getBoundingClientRect();
  const cs = session.window.getComputedStyle(cont);
  const x = Math.round(e.clientX - cr.left - (parseFloat(cs.borderLeftWidth) || 0));
  const y = Math.round(e.clientY - cr.top - (parseFloat(cs.borderTopWidth) || 0));
  const beforeRects = session.snapRects();
  await doSourceCommand({
    label: '新增浮动文本框',
    buildSource: (source) => {
      // 在容器闭合标签前插入一行（保持原缩进）
      let ls = source.lastIndexOf('\n', contInfo.closeStart - 1) + 1;
      let indent = source.slice(ls, contInfo.closeStart);
      if (/\S/.test(indent)) { ls = contInfo.closeStart; indent = ''; }
      const html = `<p style="position: absolute; left: ${x}px; top: ${y}px; margin: 0; font-size: 18px; color: #e17055;">新文本框，双击改字</p>`;
      const newSource = source.slice(0, ls) + indent + '  ' + html + '\n' + source.slice(ls);
      return { newSource, result: null };
    },
  }).then((r) => {
    if (!r || !r.ok) return;
    // 新增的是绝对定位（不参与排队），但可能盖住别人 → 一律黄灯提示
    const afterRects = editor.session.snapRects();
    const moved = [];
    Object.keys(beforeRects).forEach((k) => {
      const a = beforeRects[k], b = afterRects[k];
      if (!b) return;
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) {
        const e2 = editor.session.parsed.byLoc(+k);
        if (e2) moved.push({ loc: +k, selector: e2.selector, line: e2.line, tag: e2.tag, note: '位置有变化' });
      }
    });
    if (moved.length) editor.session.showAffected(moved);
    renderVerdict({
      light: 'yellow',
      affected: moved.length ? moved : [{ loc: null, selector: null, line: null, tag: null, note: '文本框浮在区域上方，可能盖住别的内容；换手机宽度后位置也可能要调。' }],
      line: null, selector: null,
      note: '已新增一行（浮动文本框）。双击它就能改字。',
    }, { label: '新增文本框' });
  });
}

// ============================================================
// 属性面板（右侧）
// ============================================================
const SYSTEM_FONTS = [
  ['系统默认', ''],
  ['微软雅黑', '"Microsoft YaHei", sans-serif'],
  ['苹方', '"PingFang SC", sans-serif'],
  ['思源黑体', '"Source Han Sans SC", "Noto Sans SC", sans-serif'],
  ['宋体', 'SimSun, serif'],
  ['黑体', 'SimHei, sans-serif'],
  ['楷体', 'KaiTi, serif'],
  ['Arial', 'Arial, sans-serif'],
  ['等宽', 'ui-monospace, Consolas, monospace'],
];

function renderPropsEmpty() {
  const box = $('#props');
  if (!box) return;
  box.innerHTML = '<div class="panel-empty">点选页面里的元素<br>这里会出现它的属性<br><br><small>按住 Ctrl 再点：逐层向外选<br>双击文字：直接改字<br>方向键：微调位置</small></div>';
}

function renderProps(info) {
  const box = $('#props');
  if (!box) return;
  if (!info) { renderPropsEmpty(); return; }
  const session = editor.session;
  const win = session.window;
  const dom = info.element;
  const cs = dom ? win.getComputedStyle(dom) : null;
  const locked = isLocked(info);
  const pl = pageLocked(editor.page);

  const desc = session.describe(info);
  const elLocked = !info.generated && elementLocked(editor.page, info.selector);

  box.innerHTML = `
    <div class="props-head">
      <div class="props-target">${esc(desc)}</div>
      ${info.generated ? '<div class="props-warn">程序生成的内容：源码里没有它自己的一行，只能转草图标记交给 AI。</div>' : ''}
      ${locked ? `<div class="props-locked">🔒 已锁定${pl ? '（整页锁定）' : ''}，所有修改入口已禁用</div>` : ''}
    </div>
    <div class="props-body ${locked ? 'disabled' : ''}">
      <div class="prop-group">
        <div class="prop-title">文字</div>
        <div class="prop-row">
          <label>字号</label>
          <input type="number" id="p-fs" min="8" max="120" step="1">
          <input type="range" id="p-fs-range" min="8" max="72" step="1">
        </div>
        <div class="prop-row">
          <label>字体</label><select id="p-ff"></select>
        </div>
        <div class="prop-row">
          <label>颜色</label>
          <div class="swatches" id="p-colors"></div>
          <input type="color" id="p-color" title="自定义颜色">
        </div>
        <div class="prop-row">
          <label>粗细</label>
          <button class="btn small" id="p-bold">加粗</button>
          <label style="margin-left:8px">对齐</label>
          <div class="seg" id="p-align">
            <button data-v="left" title="左对齐">⇤</button>
            <button data-v="center" title="居中">⇹</button>
            <button data-v="right" title="右对齐">⇥</button>
          </div>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-title">位置与大小</div>
        <div class="prop-row">
          <label>偏移</label>
          <input type="number" id="p-x" step="1" title="水平偏移 px">
          <input type="number" id="p-y" step="1" title="垂直偏移 px">
        </div>
        <div class="prop-row">
          <label>缩放</label>
          <input type="range" id="p-scale" min="20" max="300" step="5">
          <span id="p-scale-val"></span>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-title">操作</div>
        <div class="prop-row btn-row">
          <button class="btn small" id="prop-addtext">＋ 文本框</button>
          <button class="btn small" id="p-note">📌 加便签</button>
        </div>
        <div class="prop-row btn-row">
          <button class="btn small" id="p-lock">${elLocked ? '🔓 解锁' : '🔒 锁定'}</button>
          <button class="btn small danger" id="p-del">删除</button>
        </div>
      </div>
    </div>`;

  if (!cs) return;
  // —— 填充当前值 ——
  const fs = Math.round(parseFloat(cs.fontSize));
  $('#p-fs').value = fs;
  $('#p-fs-range').value = Math.min(72, Math.max(8, fs));
  // 字体下拉：系统字体 + 已导入字体（assets 插件注册的 window.__cdFonts）
  const ffSel = $('#p-ff');
  const imported = (window.__cdFonts || []).map((f) => [f.name, `"${f.name}"`]);
  [...SYSTEM_FONTS, ...imported].forEach(([label, val]) => {
    const o = document.createElement('option');
    o.textContent = label;
    o.value = val;
    ffSel.appendChild(o);
  });
  const inlineFF = !info.generated && getStyleProp(info, 'font-family');
  ffSel.value = inlineFF || '';
  // 颜色色板：设计规范色 + 自定义
  const colorsBox = $('#p-colors');
  const tokenColors = state.project.tokens && state.project.tokens.colors ? Object.values(state.project.tokens.colors) : [];
  const curColor = rgbToHex(cs.color);
  tokenColors.forEach((c) => {
    const s = el(`<button class="swatch" title="${esc(c)}" style="background:${esc(c)}"></button>`);
    if (c.toLowerCase() === curColor) s.classList.add('on');
    s.onclick = () => applyStyleToSelection({ color: c }, `颜色改为 ${c}`);
    colorsBox.appendChild(s);
  });
  $('#p-color').value = /^#[0-9a-f]{6}$/i.test(curColor) ? curColor : '#000000';
  const bold = parseInt(cs.fontWeight, 10) >= 600;
  $('#p-bold').classList.toggle('on', bold);
  const align = cs.textAlign;
  document.querySelectorAll('#p-align button').forEach((b) => b.classList.toggle('on', b.dataset.v === align));
  // 偏移与缩放（从源码行内样式读，与写回通道一致）
  const tr = !info.generated ? (getStyleProp(info, 'translate') || '0 0').split(/\s+/).map(parseFloat) : [0, 0];
  $('#p-x').value = Math.round(tr[0] || 0);
  $('#p-y').value = Math.round(tr[1] || 0);
  const sc = !info.generated ? getStyleProp(info, 'scale') : null;
  const scVal = sc ? Math.round(parseFloat(sc) * 100) : 100;
  $('#p-scale').value = scVal;
  $('#p-scale-val').textContent = scVal + '%';

  if (locked) return; // 锁定：只展示，不绑定修改

  // —— 绑定修改 ——
  $('#p-fs').onchange = (e) => {
    const v = Math.round(+e.target.value);
    if (v > 0) applyStyleToSelection({ 'font-size': v + 'px' }, `字号改为 ${v}px`);
  };
  $('#p-fs-range').oninput = (e) => { $('#p-fs').value = e.target.value; };
  $('#p-fs-range').onchange = (e) => applyStyleToSelection({ 'font-size': e.target.value + 'px' }, `字号改为 ${e.target.value}px`);
  $('#p-ff').onchange = (e) => applyStyleToSelection({ 'font-family': e.target.value || null }, '改字体');
  $('#p-color').oninput = (e) => { if (dom) dom.style.color = e.target.value; }; // 视觉层预览
  $('#p-color').onchange = (e) => applyStyleToSelection({ color: e.target.value }, `颜色改为 ${e.target.value}`);
  $('#p-bold').onclick = () => applyStyleToSelection({ 'font-weight': bold ? '400' : '700' }, bold ? '取消加粗' : '加粗');
  document.querySelectorAll('#p-align button').forEach((b) => {
    b.onclick = () => applyStyleToSelection({ 'text-align': b.dataset.v }, '文字对齐：' + ({ left: '左', center: '中', right: '右' })[b.dataset.v]);
  });
  const setOffset = () => {
    const nx = Math.round(+$('#p-x').value || 0), ny = Math.round(+$('#p-y').value || 0);
    const dx = nx - Math.round(tr[0] || 0), dy = ny - Math.round(tr[1] || 0);
    if (!dx && !dy) return;
    if (info.generated) return;
    doSourceCommand({ label: `设置偏移（${nx}, ${ny}）`, makeEdit: () => ({ kind: 'move', target: info.loc, dx, dy, crossed: false }) });
  };
  $('#p-x').onchange = setOffset;
  $('#p-y').onchange = setOffset;
  $('#p-scale').oninput = (e) => {
    $('#p-scale-val').textContent = e.target.value + '%';
    if (dom) dom.style.scale = String(e.target.value / 100); // 视觉层预览
  };
  $('#p-scale').onchange = (e) => {
    const v = +e.target.value;
    applyStyleToSelection({ scale: v === 100 ? null : String(v / 100) }, `视觉缩放到 ${v}%`);
  };
  $('#prop-addtext').onclick = startAddText;
  $('#p-note').onclick = () => bus.runCommand('notes.addForSelection', ctx);
  $('#p-del').onclick = deleteSelection;
  $('#p-lock').onclick = async () => {
    if (info.generated) return;
    const on = !elementLocked(editor.page, info.selector);
    await bus.doMeta({
      label: on ? `锁定 ${desc}` : `解锁 ${desc}`,
      apply: () => setElementLock(editor.page, info.selector, on),
      revert: () => setElementLock(editor.page, info.selector, !on),
    });
    renderProps(editor.selection);
  };
}

function updatePropsLockUI() {
  if (editor.selection) renderProps(editor.selection);
  const bar = $('#pagebar');
  if (bar && bar._syncLock) bar._syncLock();
}

function rgbToHex(c) {
  const m = String(c).match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return String(c);
  return '#' + m.slice(0, 3).map((v) => ('0' + Math.round(+v).toString(16)).slice(-2)).join('');
}

// ---------- 底部路径条（面包屑：body > … > 当前，可点选祖先） ----------
function renderCrumbs() {
  const box = $('#crumbs');
  if (!box) return;
  const info = editor.selection;
  if (!info || !editor.session) { box.innerHTML = '<span class="crumb-dim">未选中元素</span>'; return; }
  box.innerHTML = '';
  const parts = info.selector.split(' > ');
  parts.forEach((part, i) => {
    const sel = parts.slice(0, i + 1).join(' > ');
    const b = el(`<button class="crumb">${esc(part.replace(/:nth-of-type\((\d+)\)/, '[$1]'))}</button>`);
    if (i === parts.length - 1) b.classList.add('on');
    b.onclick = () => {
      if (part === 'body') { editor.session.clearSelection(); return; }
      const e = editor.session.parsed.bySelector(sel);
      if (e) editor.session.select(e.loc);
    };
    box.appendChild(b);
    if (i < parts.length - 1) box.appendChild(el('<span class="crumb-sep">›</span>'));
  });
}

// ============================================================
// 全局键盘
// ============================================================
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  const inField = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
  // Ctrl+Z / Ctrl+Y：全局撤销重做（输入框里不抢）
  if ((e.ctrlKey || e.metaKey) && !inField) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); bus.undo(); return; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); bus.redo(); return; }
  }
  if (e.key === 'Escape') {
    // 逐层退出：模态 → 面板 → 选中 → 视图回总览
    if (anyModalOpen()) { closeTopModal(); return; }
    if (editor.editingText) return; // 改字中的 Esc 由改字流程自己处理
    if (state.view === 'present') { setView('overview'); return; }
    if (state.activePanel) { togglePanel(null); return; }
    if (state.view === 'edit' && editor.selection) { editorApi.clearSelection(); onEngineSelect(null); return; }
    if (state.view === 'edit' && state.project) { setView('overview'); return; }
    return;
  }
  if (inField || !state.project || state.view !== 'edit' || !editor.session) return;
  if (editor.editingText) return;
  // Delete 删除选中
  if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selection) {
    e.preventDefault();
    deleteSelection();
    return;
  }
  // 方向键微调：1px，Shift 10px
  const st = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
  if (d && editor.selection) {
    e.preventDefault();
    nudgeSelection(d[0], d[1]);
  }
});

// ============================================================
// 插件装配（内置插件都以 registerPanel/registerCommand 方式接入）
// ============================================================
setupLayers(ctx);
setupHistory(ctx);
setupSketch(ctx);
setupNotes(ctx);
setupAssets(ctx);
setupTokens(ctx);
setupOverview(ctx, overviewApi);
setupPresent(ctx, presentApi);

// app 级命令（插件 ↔ 内核的桥）
bus.registerCommand('app.exitPresent', () => setView('overview'));

// 把草图模式开关放工具栏（插件按钮）
bus.on('view', renderToolbarPlugins);

// ---------- 启动 ----------
renderHome();
