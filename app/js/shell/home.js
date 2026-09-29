// 首页：我的项目 + 从模板新建（缩略图按真实桌面视口渲染后等比缩小）
import { icon } from '../core/icons.js';
import { el, esc, toast, confirmDlg, promptDlg, showMenu, fmtTime } from '../core/ui.js';
import { getViewport } from '../core/viewport.js';

function thumb(url) {
  const { w, h } = getViewport();
  const box = el(`<div class="pcard-thumb" style="aspect-ratio:${w} / ${h}"><iframe loading="lazy" tabindex="-1" title="预览"></iframe></div>`);
  const f = box.querySelector('iframe');
  f.style.width = w + 'px';
  f.style.height = h + 'px';
  f.src = url;
  const fit = () => { const cw = box.clientWidth; if (cw) f.style.transform = `scale(${cw / w})`; };
  new ResizeObserver(fit).observe(box);
  return box;
}

export async function renderHome(app) {
  document.body.className = 'home';
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="home-wrap">
      <div class="home-top">
        <div class="brand"><span class="brand-mark">百</span>CentDeck <small>百映</small></div>
        <div class="grow"></div>
        <span class="hint">视口：${getViewport().w} × ${getViewport().h}（按本机浏览器比例）</span>
      </div>
      <div class="home-hero">
        <h1>AI 负责写网页，你负责指和改。</h1>
        <p>页面按你电脑上的真实比例摊开；小改自己动手直接写回代码，说不清的画下来交给 AI。</p>
      </div>
      <section class="home-sec"><h2>我的项目 <span id="proj-count"></span></h2><div class="card-grid" id="home-projects"><div class="empty">读取中…</div></div></section>
      <section class="home-sec"><h2>从模板新建 <span>8 类常见网页，一键创建</span></h2><div class="card-grid" id="home-templates"></div></section>
    </div>`;
  let projects = [], templates = [];
  try { [projects, templates] = await Promise.all([app.api.listProjects(), app.api.listTemplates()]); } catch { return; }

  const pbox = root.querySelector('#home-projects');
  root.querySelector('#proj-count').textContent = projects.length ? `${projects.length} 个` : '';
  pbox.innerHTML = projects.length ? '' : '<div class="empty">还没有项目，从下面挑一个模板开始吧。</div>';
  projects.forEach((p) => {
    const first = p.pages[0];
    const card = el(`<div class="pcard">
      <span class="pcard-tag">${p.pages.length} 页</span>
      <button class="icon-btn sm pcard-more" data-tip="更多">${icon('more', 16)}</button>
      <div class="pcard-body"><div class="pcard-name">${esc(p.name)}</div>
      <div class="pcard-desc">${esc(p.template ? '模板：' + p.template : '')}${p.createdAt ? ' · 创建于 ' + esc(fmtTime(p.createdAt)) : ''}</div></div></div>`);
    if (first) card.insertBefore(thumb(`/preview/${encodeURIComponent(p.id)}/${first.file}`), card.querySelector('.pcard-body'));
    card.onclick = (e) => { if (!e.target.closest('.pcard-more')) app.openProject(p.id); };
    card.querySelector('.pcard-more').onclick = (e) => {
      e.stopPropagation();
      showMenu([
        { label: '打开', icon: 'chevRight', onClick: () => app.openProject(p.id) },
        '-',
        { label: '删除项目', icon: 'trash', danger: true, onClick: async () => {
          const ok = await confirmDlg({ title: '删除项目', danger: true, okLabel: '删除', body: `将删除「<b>${esc(p.name)}</b>」的全部文件、历史、标记和便签，<b>不能恢复</b>。` });
          if (!ok) return;
          try { await app.api.deleteProject(p.id); toast(`已删除「${p.name}」`, 'ok'); renderHome(app); } catch { /* api 已提示 */ }
        } },
      ], 0, 0, { anchor: e.currentTarget, align: 'right' });
    };
    pbox.appendChild(card);
  });

  const tbox = root.querySelector('#home-templates');
  templates.forEach((t) => {
    const first = t.pages[0];
    const card = el(`<div class="pcard"><span class="pcard-tag">${t.pages.length} 页</span>
      <div class="pcard-body"><div class="pcard-name">${esc(t.name)}</div><div class="pcard-desc">${esc(t.description || '')}</div></div></div>`);
    if (first) card.insertBefore(thumb(`/tpl/${encodeURIComponent(t.id)}/${first.file}`), card.querySelector('.pcard-body'));
    card.onclick = async () => {
      const name = await promptDlg({ title: `用「${t.name}」新建项目`, label: '项目名字', value: t.name, okLabel: '创建' });
      if (name == null) return;
      try { const proj = await app.api.createProject(t.id, name); toast(`「${proj.name}」已创建`, 'ok'); app.openProject(proj.id); } catch { /* api 已提示 */ }
    };
    tbox.appendChild(card);
  });
}
