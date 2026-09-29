// 首页：描述想做的网站 → 空白项目 / 模板 / 导入；我的项目（搜索、排序、重命名、删除需输入名称确认）
import { icon } from '../core/icons.js';
import { el, esc, toast, openModal, promptDlg, showMenu } from '../core/ui.js';
import { getViewport } from '../core/viewport.js';
import { pickFiles, filesFromDrop, runImport } from './importer.js';

const KIND = { template: ['模板', 'blue'], blank: ['空白', ''], import: ['导入', 'green'] };
let sortBy = localStorage.getItem('cd.homeSort') || 'updated';
let query = '';

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

async function startFromPrompt(app, text) {
  const name = text.replace(/\s+/g, ' ').trim().slice(0, 18) || '新网站';
  try {
    const proj = await app.api.createBlank(name);
    await app.openProject(proj.id);
    app.agent.prefill(text, { skill: 'design-variants' });
    toast('描述已经放进助手：接入模型后按发送，就会在画布上铺出几版方案', 'ok', 5200);
  } catch { /* 已提示 */ }
}

export async function renderHome(app) {
  document.body.className = 'home';
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="home-page">
      <header class="home-bar">
        <div class="brand"><span class="brand-mark">百</span>CentDeck<small>百映</small></div>
        <label class="home-search">${icon('search', 16)}<input placeholder="搜索项目" value="${esc(query)}"></label>
        <div class="home-bar-right">
          <button class="btn ghost" data-a="settings" data-tip="配置模型和 API 接口">${icon('brain', 16)}模型设置</button>
          <button class="icon-btn" data-a="keys" data-tip="快捷键" data-kbd="?">${icon('keyboard')}</button>
        </div>
      </header>
      <section class="home-hero">
        <h1>今天想做一个什么样的网站？</h1>
        <p>描述一下，助手会在画布上铺出几版方案；也可以从模板开始，或者导入已经做好的网页接着改。</p>
        <div class="hero-prompt">
          <textarea rows="2" placeholder="比如：一家精品咖啡店的官网，温暖的奶咖色调，要有菜单、门店地图和线上预约"></textarea>
          <button class="btn primary" data-a="go">${icon('sparkle', 16)}开始设计</button>
        </div>
        <div class="entry-row">
          <button class="entry" data-a="blank"><span class="entry-ico">${icon('plus', 22)}</span><b>空白项目</b><small>从零开始，用助手生成页面</small></button>
          <button class="entry" data-a="tpl"><span class="entry-ico">${icon('overview', 22)}</span><b>从模板开始</b><small>两个完整的示例网站</small></button>
          <button class="entry" data-a="import"><span class="entry-ico">${icon('upload', 22)}</span><b>导入网页</b><small>HTML 文件或整个文件夹，也能直接拖进来</small></button>
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
  const $ = (s) => root.querySelector(s);
  const ta = $('.hero-prompt textarea');
  const go = () => { const t = ta.value.trim(); if (!t) { ta.focus(); return; } startFromPrompt(app, t); };
  $('[data-a=go]').onclick = go;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
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
  $('[data-a=keys]').onclick = () => app.showKeys();

  // 拖文件进来就导入
  let depth = 0;
  const veil = root.querySelector('.drop-veil');
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  root.ondragenter = (e) => { if (!hasFiles(e)) return; depth++; veil.classList.add('show'); };
  root.ondragleave = () => { depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('show'); };
  root.ondragover = (e) => { if (hasFiles(e)) e.preventDefault(); };
  root.ondrop = async (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; veil.classList.remove('show'); const f = await filesFromDrop(e.dataTransfer); if (f.length) runImport(app, f); };

  let projects = [], templates = [];
  try { [projects, templates] = await Promise.all([app.api.listProjects(), app.api.listTemplates()]); } catch { return; }
  const refresh = () => renderHome(app);

  const grid = $('[data-projects]');
  const paint = () => {
    const q = query.trim().toLowerCase();
    let list = projects.filter((p) => !q || p.name.toLowerCase().includes(q));
    list = list.sort((a, b) => (sortBy === 'name' ? a.name.localeCompare(b.name, 'zh') : sortBy === 'created' ? String(b.createdAt).localeCompare(String(a.createdAt)) : String(b.updatedAt).localeCompare(String(a.updatedAt))));
    $('[data-count]').textContent = projects.length ? projects.length + ' 个' : '';
    root.querySelectorAll('[data-sort] button').forEach((b) => b.classList.toggle('on', b.dataset.v === sortBy));
    grid.innerHTML = '';
    if (!projects.length) { grid.appendChild(el('<div class="empty wide">还没有项目。在上面描述你想做的网站，或者从模板开始。</div>')); return; }
    if (!list.length) { grid.appendChild(el(`<div class="empty wide">没有名字里带「${esc(query)}」的项目</div>`)); return; }
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
  $('.home-search input').addEventListener('input', (e) => { query = e.target.value; paint(); });

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
