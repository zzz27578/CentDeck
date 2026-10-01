/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from './core/i18n.js';
import { refreshAppearance } from './core/extensions.js';
import { connectWorkbench } from './core/mcp-client.js';
// main.js —— 入口：应用上下文、打开项目、视图切换（总览/编辑/放映）、锁定、插件装配
import { api, setApiErrorHandler } from './core/api.js';
import { createBus } from './core/bus.js';
import { toastError } from './core/ui.js';
import { renderHome } from './shell/home.js';
import { buildShell, bindShellKeys } from './shell/workbench.js';
import { createOverview } from './overview/overview.js';
import { createEditor } from './edit/editor.js';
import { createPresent } from './present/present.js';
import { setupSketch } from './sketch/sketch.js';
import { createAgent } from './agent/agent.js';
import { openSettings } from './agent/settings.js';
import { showKeyHelp } from './core/keys.js';
import { setupNotes } from './panels/notes.js';
import { setupAssets } from './panels/assets.js';
import { setupTokens } from './panels/tokens.js';
import { setupHistory } from './panels/history.js';
import { setupCodeview } from './panels/codeview.js';
import { checkMobileProject } from './shell/responsive.js';
import { onViewportChange, setDevice } from './core/viewport.js';
import { requireLogin } from './shell/auth.js';

setApiErrorHandler(toastError);
const bus = createBus({ api, onError: toastError });

const app = {
  api, bus,
  state: { project: null, view: null, page: null, presentFrom: null },
  project: () => app.state.project,
  view: () => app.state.view,
  refs: null,
};

// ---------- 锁定（整页锁 / 元素锁；AI 以后也绕不过这一层） ----------
function locks() {
  const p = app.state.project;
  if (!p.locks) p.locks = { pages: [], elements: [] };
  p.locks.pages = p.locks.pages || [];
  p.locks.elements = p.locks.elements || [];
  return p.locks;
}
app.pageLocked = (file) => !!app.state.project && locks().pages.includes(file);
app.elementLocked = (file, selector) => !!app.state.project && locks().elements.some((x) => x.page === file && x.selector === selector);
app.isLocked = (info) => {
  if (!app.state.project || !app.state.page) return false;
  if (app.pageLocked(app.state.page)) return true;
  return !!(info && !info.generated && app.elementLocked(app.state.page, info.selector));
};
app.setPageLock = (file, on) => bus.doMeta({
  label: on ? i18nText('锁定页面') : i18nText('解锁页面'),
  apply: () => { const L = locks().pages; const i = L.indexOf(file); if (on && i < 0) L.push(file); if (!on && i >= 0) L.splice(i, 1); },
  revert: () => { const L = locks().pages; const i = L.indexOf(file); if (!on && i < 0) L.push(file); if (on && i >= 0) L.splice(i, 1); },
});
app.setElementLock = (file, selector, on) => {
  const set = (v) => {
    const L = locks().elements;
    const i = L.findIndex((x) => x.page === file && x.selector === selector);
    if (v && i < 0) L.push({ page: file, selector });
    if (!v && i >= 0) L.splice(i, 1);
  };
  return bus.doMeta({ label: on ? i18nText('锁定元素') : i18nText('解锁元素'), apply: () => set(on), revert: () => set(!on) });
};

// ---------- 视图 ----------
const views = {};

app.goHome = async () => {
  if (app.state.project && await bus.flushMeta() === false) return;
  if (app.state.view && views[app.state.view]) views[app.state.view].leave();
  app.state = { project: null, view: null, page: null, presentFrom: null };
  bus.emit('project',null);
  bus.clearStacks();
  renderHome(app);
};

app.openProject = async (id) => {
  let proj;
  try { proj = await api.getProject(id); } catch { return; }
  if (app.state.project && await bus.flushMeta() === false) return;
  if (app.state.view && views[app.state.view]) views[app.state.view].leave();
  app.disposeHomeComposer?.();
  app.state = { project: proj, view: null, page: proj.pages[0] ? proj.pages[0].file : null, presentFrom: null };
  if(proj.target)setDevice(proj.target==='app'?'mobile':'desktop');
  bus.clearStacks();
  bus.bindProject(() => app.state.project);
  buildShell(app);
  await agent.mount(app.refs.agent);
  bus.emit('project', proj);
  await app.setView('overview');
  checkMobileProject(app);
};

app.setView = async (v, opts = {}) => {
  if (!app.state.project) return;
  if (app.state.view === v && !opts.force) return;
  const prev = app.state.view;
  if (prev && views[prev]) views[prev].leave();
  app.state.view = v;
  document.body.dataset.view = v;
  const wrap = app.refs.stageWrap;
  wrap.innerHTML = '';
  if (v !== 'edit') app.refs.inspector.classList.remove('open');
  app.setHint('');
  app.setStatusRight('');
  app.setCrumbs(null);
  app.syncViewSwitch();
  bus.emit('view', v);
  await views[v].enter(wrap, opts);
};

app.openPage = async (file) => {
  app.state.page = file;
  if (app.state.view !== 'edit') await app.setView('edit');
  else await views.edit.openPage(file);
  app.syncViewSwitch();
};

app.present = (file) => {
  app.state.presentFrom = file || null;
  app.setView('present', { force: app.state.view === 'present' });
};

app.reloadView = async () => {
  if (!app.state.view) return;
  await app.setView(app.state.view, { force: true });
};

app.refreshProject = async () => {
  app.state.project = await api.getProject(app.state.project.id);
  bus.bindProject(()=>app.state.project);
  bus.emit('project', app.state.project);
};

app.toggleAgent = (force) => agent.toggle(force);

// ---------- 装配 ----------
await refreshAppearance();
await requireLogin(app);
views.overview = createOverview(app);
views.edit = createEditor(app);
views.present = createPresent(app);
app.editor = views.edit;
app.overview = views.overview;
const agent = createAgent(app);
app.agent = agent;
app.openSettings = section => openSettings(app, section);
app.showKeys = () => showKeyHelp(app);

setupSketch(app);
setupNotes(app);
setupAssets(app);
setupTokens(app);
setupHistory(app);
setupCodeview(app);
bindShellKeys(app);
onViewportChange(() => checkMobileProject(app));
bus.on('rendered', () => checkMobileProject(app));
let aiRefresh=Promise.resolve();
bus.on('ai-commit',()=>{aiRefresh=aiRefresh.catch(()=>{}).then(async()=>{if(!app.project())return;if(await bus.flushMeta()===false)return;await app.refreshProject();await app.reloadView();});});

window.addEventListener('beforeunload', () => { if (app.state.project && bus.saveState === 'dirty') bus.flushMeta(); });

const initial=new URLSearchParams(location.search);
if(initial.has('project')){await app.openProject(initial.get('project'));if(initial.get('view')==='edit'&&app.project()?.pages.some(p=>p.file===initial.get('page')))await app.openPage(initial.get('page'));history.replaceState(null,'','/');}
else renderHome(app);

connectWorkbench(app);
if(initial.get('settings')==='general')await app.openSettings('general');
