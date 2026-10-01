import { mountCustomHome } from '../core/extensions.js';
// 首页：描述想做的网站 → 空白项目 / 模板 / 导入；我的项目（搜索、排序、重命名、删除需输入名称确认）
import { icon } from '../core/icons.js';
import { el, esc, toast, openModal, promptDlg, showMenu } from '../core/ui.js';
import { getViewport, setDevice } from '../core/viewport.js';
import { mark, toggleTheme, styleSwitch, bindStyleSwitch } from '../core/brand.js';
import { pixelField, mountPixelField } from '../core/pixel-field.js';
import { pickFiles, filesFromDrop, runImport } from './importer.js';
import { mountHomeComposer } from './home-composer.js';

const KIND = { template: ['模板', 'blue'], blank: ['空白', ''], import: ['导入', 'green'] };
let sortBy = localStorage.getItem('cd.homeSort') || 'updated';

export function ago(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 172800) return '昨天';
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function thumb(url) {
  const { w, h } = getViewport();
  const box = el(`<div class="pc-thumb"><iframe loading="lazy" tabindex="-1" title="预览"></iframe></div>`);
  const f = box.querySelector('iframe');
  Object.assign(f.style, { width: w + 'px', height: h + 'px' });
  f.src = url;
  new ResizeObserver(() => { if (box.clientWidth) f.style.transform = `scale(${box.clientWidth / w})`; }).observe(box);
  return box;
}

function confirmDelete(app, p, after) {
  const body = el(`<div class="del-confirm">
    <p>将永久删除「<b>${esc(p.name)}</b>」的全部页面、历史版本、草图标记和便签，<b>无法恢复</b>。</p>
    <label>请输入项目名称 <b>${esc(p.name)}</b> 确认删除</label>
    <input class="ipt" placeholder="${esc(p.name)}"></div>`);
  const ipt = body.querySelector('input');
  const close = openModal({
    title: '删除项目', width: 460, body,
    actions: [
      { label: '取消' },
      { label: '永久删除', kind: 'danger', onClick: async (c) => {
        if (ipt.value.trim() !== p.name) { ipt.classList.add('shake'); setTimeout(() => ipt.classList.remove('shake'), 400); ipt.focus(); return; }
        try { await app.api.deleteProject(p.id); c(); toast(`「${p.name}」已删除`, 'ok'); after(); } catch { /* 已提示 */ }
      } },
    ],
  });
  const btn = [...document.querySelectorAll('.modal-foot .btn.danger')].pop();
  const sync = () => { if (btn) btn.disabled = ipt.value.trim() !== p.name; };
  ipt.addEventListener('input', sync);
  ipt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
  sync();
  setTimeout(() => ipt.focus(), 60);
  return close;
}

async function rename(app, p, after) {
  const name = await promptDlg({ title: '重命名项目', label: '新名字', value: p.name, okLabel: '保存' });
  if (!name || name === p.name) return;
  try {
    const full = await app.api.getProject(p.id);
    delete full.tokens;
    await app.api.saveProject(p.id, { ...full, name });
    toast('已重命名', 'ok');
    after();
  } catch { /* 已提示 */ }
}

function projectMenu(app, p, x, y, anchor, refresh) {
  showMenu([
    { title: p.name },
    { label: '打开', icon: 'chevRight', onClick: () => app.openProject(p.id) },
    { label: '重命名…', icon: 'edit', onClick: () => rename(app, p, refresh) },
    '-',
    { label: '删除项目…', icon: 'trash', danger: true, onClick: () => confirmDelete(app, p, refresh) },
  ], x, y, anchor ? { anchor, align: 'right' } : {});
}

async function startFromPrompt(app, {text,target='web',model,refs=[]}) {
  const name = text.replace(/\s+/g, ' ').trim().slice(0, 18) || '新网站';
  try {
    const proj = await app.api.createBlank(name);
    proj.target=target;await app.api.saveProject(proj.id,proj);
    setDevice(target==='app'?'mobile':'desktop');
    await app.openProject(proj.id);
    if(app.project()?.id!==proj.id)return false;
    app.agent.prefill(text+'\n\n设计目标：'+(target==='app'?'手机网页 / H5，优先 393px 手机尺寸，兼容桌面浏览。':'Web 网页，优先桌面布局并适配手机。'),{model,refs});
    return true;
  } catch { return false; }
}

export async function renderHome(app) {
  app.disposeHomeComposer?.();
  document.body.className = 'home';
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="home-page">
      <header class="home-bar">
        <div class="wordmark">${mark(38)}<b>CentDeck</b><small>百映</small></div>

        <div class="home-bar-right">
          <button class="btn ghost" data-a="settings" aria-label="Agent 工作台">${icon('centdeck', 18)}<span>Agent 工作台</span></button>
          ${styleSwitch()}<button class="icon-btn" data-a="theme" aria-label="切换亮暗模式">◐</button><button class="btn" data-a="preferences" aria-label="设置">${icon('settings',18)}设置</button>
        </div>
      </header>
      ${pixelField()}
      <section class="home-hero">
        <div class="home-orbit">${mark(76)}</div><span class="home-eyebrow">YOUR NEXT POSSIBILITY</span><h1>好设计，始于一个想法</h1>
        <div class="hero-prompt">
          <textarea rows="2" aria-label="网站需求" placeholder="描述你想创建的网站…"></textarea>
          <div class="home-attachments" aria-label="参考附件" hidden></div>
          <div class="prompt-actions"><div class="home-composer-tools"><button class="home-attach" data-a="attach" aria-label="添加图片或文件" title="添加图片、音频或文本文件">${icon('plus',19)}</button><div class="target-switch" role="group" aria-label="构建目标"><button class="on" data-target="web" aria-pressed="true">${icon('monitor',14)}Web</button><button data-target="app" aria-pressed="false">${icon('phone',14)}App</button><i aria-hidden="true"></i></div></div><button class="home-model" data-a="model" aria-label="选择本次设计使用的模型">${icon('brain',16)}<span>选择模型</span>${icon('chevDown',13)}</button><button class="btn primary" data-a="go">开始设计 ${icon('arrow',17)}</button></div>
          <input type="file" data-attachments aria-label="上传参考附件" multiple hidden>
        </div>
        <div class="entry-row">
          <button class="entry" data-a="blank">${icon('plus', 18)}空白项目</button>
          <button class="entry" data-a="tpl">${icon('overview', 18)}浏览模板</button>
          <button class="entry" data-a="import">${icon('upload', 18)}导入网页</button>
        </div>
      </section>
      <section class="home-sec">
        <div class="sec-head"><h2>我的项目 <span data-count></span></h2>
          <div class="seg" data-sort><button data-v="updated">最近修改</button><button data-v="created">创建时间</button><button data-v="name">名称</button></div></div>
        <div class="proj-grid" data-projects><div class="empty">读取中…</div></div>
      </section>
      <section class="home-sec" data-templates-sec>
        <div class="sec-head"><h2>模板</h2></div>
        <div class="proj-grid tpl" data-templates></div>
      </section>
    </div>
    <div class="drop-veil">${icon('upload', 40)}<b>松开鼠标，导入网页</b><span>单个 HTML、多个文件或整个文件夹都可以</span></div>`;
  bindStyleSwitch(root);
  mountCustomHome(root,app);
  app.disposeHomeAppearance?.();
  const appearanceChanged=()=>{if(document.body.classList.contains('home'))mountCustomHome(root,app);};
  addEventListener('centdeck-appearance',appearanceChanged);
  app.disposeHomeAppearance=()=>removeEventListener('centdeck-appearance',appearanceChanged);
  mountPixelField(root);
  const $ = (s) => root.querySelector(s);
  app.disposeHomeComposer=mountHomeComposer(app,root,draft=>startFromPrompt(app,draft));
  $('[data-a=blank]').onclick = async () => {
    const name = await promptDlg({ title: '新建空白项目', label: '项目名字', value: '我的新网站', okLabel: '创建' });
    if (!name) return;
    try { const p = await app.api.createBlank(name); app.openProject(p.id); } catch { /* 已提示 */ }
  };
  $('[data-a=tpl]').onclick = () => $('[data-templates-sec]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('[data-a=import]').onclick = (e) => showMenu([
    { label: '选择网页文件…', icon: 'file', hint: '一个或多个 .html，连同它用到的图片、样式', onClick: async () => { const f = await pickFiles(false); if (f.length) runImport(app, f); } },
    { label: '选择整个文件夹…', icon: 'layers', hint: '推荐：图片、样式都能带上', onClick: async () => { const f = await pickFiles(true); if (f.length) runImport(app, f); } },
  ], 0, 0, { anchor: e.currentTarget, minWidth: 280 });
  $('[data-a=settings]').onclick = () => app.openSettings();
  $('[data-a=theme]').onclick = toggleTheme;
  $('[data-a=preferences]').onclick = () => app.openSettings('general');

  // 拖文件进来就导入
  let depth = 0;
  const veil = root.querySelector('.drop-veil');
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  root.ondragenter = (e) => { if (!hasFiles(e)||e.target.closest('.hero-prompt')) return; depth++; veil.classList.add('show'); };
  root.ondragleave = () => { depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('show'); };
  root.ondragover = (e) => { if (hasFiles(e)) e.preventDefault(); };
  root.ondrop = async (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; veil.classList.remove('show'); const f = await filesFromDrop(e.dataTransfer); if (f.length) runImport(app, f); };

  let projects = [], templates = [];
  try { [projects, templates] = await Promise.all([app.api.listProjects(), app.api.listTemplates()]); } catch { return; }
  const refresh = () => renderHome(app);

  const grid = $('[data-projects]');
  const paint = () => {
    let list = [...projects];
    list = list.sort((a, b) => (sortBy === 'name' ? a.name.localeCompare(b.name, 'zh') : sortBy === 'created' ? String(b.createdAt).localeCompare(String(a.createdAt)) : String(b.updatedAt).localeCompare(String(a.updatedAt))));
    $('[data-count]').textContent = projects.length ? projects.length + ' 个' : '';
    root.querySelectorAll('[data-sort] button').forEach((b) => b.classList.toggle('on', b.dataset.v === sortBy));
    grid.innerHTML = '';
    if (!projects.length) { grid.appendChild(el('<div class="empty wide">你的第一个项目，从这里开始。</div>')); return; }
    list.forEach((p) => {
      const [kind, kcls] = KIND[p.kind] || KIND.blank;
      const card = el(`<div class="pc">
        <div class="pc-acts"><button class="icon-btn sm" data-a="del" data-tip="删除">${icon('trash', 15)}</button><button class="icon-btn sm" data-a="more" data-tip="更多">${icon('more', 16)}</button></div>
        <div class="pc-body"><div class="pc-name">${esc(p.name)}</div>
          <div class="pc-meta"><span class="chip ${kcls}">${kind}</span><span>${p.pages.length} 页</span><span>${esc(ago(p.updatedAt || p.createdAt))}修改</span>${p.marks ? `<span class="chip red">${p.marks} 条待办标记</span>` : ''}</div></div></div>`);
      card.insertBefore(p.pages[0] ? thumb(`/preview/${encodeURIComponent(p.id)}/${p.pages[0].file}`) : el(`<div class="pc-thumb blank">${icon('sparkle', 28)}<span>还没有页面</span></div>`), card.firstChild.nextSibling);
      card.onclick = (e) => { if (!e.target.closest('.pc-acts')) app.openProject(p.id); };
      card.oncontextmenu = (e) => { e.preventDefault(); projectMenu(app, p, e.clientX, e.clientY, null, refresh); };
      card.querySelector('[data-a=del]').onclick = () => confirmDelete(app, p, refresh);
      card.querySelector('[data-a=more]').onclick = (e) => projectMenu(app, p, 0, 0, e.currentTarget, refresh);
      grid.appendChild(card);
    });
  };
  paint();
  root.querySelectorAll('[data-sort] button').forEach((b) => { b.onclick = () => { sortBy = b.dataset.v; localStorage.setItem('cd.homeSort', sortBy); paint(); }; });


  const tbox = $('[data-templates]');
  templates.forEach((t) => {
    const card = el(`<div class="pc"><div class="pc-body"><div class="pc-name">${esc(t.name)}</div><div class="pc-desc">${esc(t.description || '')}</div>
      <div class="pc-meta"><span>${t.pages.length} 页</span><span class="pc-use">${icon('plus', 13)}用这个模板新建</span></div></div></div>`);
    if (t.pages[0]) card.insertBefore(thumb(`/tpl/${encodeURIComponent(t.id)}/${t.pages[0].file}`), card.firstChild);
    card.onclick = async () => {
      const name = await promptDlg({ title: `用「${t.name}」新建`, label: '项目名字', value: t.name, okLabel: '创建' });
      if (!name) return;
      try { const proj = await app.api.createProject(t.id, name); app.openProject(proj.id); } catch { /* 已提示 */ }
    };
    tbox.appendChild(card);
  });
}
