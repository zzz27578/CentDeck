// 素材库：上传（大图自动压缩）、替换选中图片、插入图片、拖到页面上、导入字体
import { el, esc, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('读取文件失败')); r.readAsDataURL(file); });
// 从页面文件到素材的相对路径：pages/index.html → ../assets/x.png
const relFrom = (page, target) => '../'.repeat(Math.max(0, page.split('/').length - 1)) + target;

async function compress(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return { b64: await toB64(file), name: file.name };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('图片解码失败')); i.src = url; });
    const big = img.naturalWidth > 1600 || img.naturalHeight > 1600;
    if (!big && file.size < 500 * 1024) return { b64: await toB64(file), name: file.name };
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const png = file.type === 'image/png';
    const data = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85);
    return { b64: data.split(',')[1], name: file.name.replace(/\.\w+$/, png ? '.png' : '.jpg'), compressed: true };
  } finally { URL.revokeObjectURL(url); }
}

export function setupAssets(app) {
  const { bus } = app;
  window.__cdFonts = window.__cdFonts || [];

  async function upload(file) {
    const proj = app.project();
    const isFont = /\.(woff2?|ttf|otf)$/i.test(file.name);
    if (!isFont && !IMG_RE.test(file.name) && !/^image\//.test(file.type)) { toast('只支持图片和字体文件', 'err'); return; }
    try {
      const r = isFont ? { b64: await toB64(file), name: file.name } : await compress(file);
      const name = r.name.replace(/[^\w.一-龥-]+/g, '_');
      await app.api.saveAsset(proj.id, name, r.b64);
      if (isFont) window.__cdFonts.push({ name: name.replace(/\.\w+$/, ''), file: name });
      toast(`「${name}」已加入素材${r.compressed ? '（已自动压缩）' : ''}`, 'ok');
      bus.emit('assets');
    } catch { /* api 已提示 */ }
  }
  bus.on('project', async () => {
    try {
      const list = await app.api.listAssets(app.project().id);
      window.__cdFonts = list.filter((a) => /\.(woff2?|ttf|otf)$/i.test(a.filename)).map((a) => ({ name: a.filename.replace(/\.\w+$/, ''), file: a.filename }));
    } catch { /* 忽略 */ }
  });

  function replaceImage(filename, loc) {
    const ed = app.editor;
    const p = ed.frame.parsed.byLoc(loc);
    if (!p || p.tag !== 'img') { toast('先选中页面里的一张图片', 'err'); return; }
    ed.doSource({
      label: `换图：${filename}`,
      build: (src) => {
        const open = src.slice(p.openStart, p.openEnd);
        const m = /\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(open);
        const val = relFrom(ed.page, 'assets/' + filename);
        const attr = ` src="${val}"`;
        const nOpen = m ? open.slice(0, m.index) + attr + open.slice(m.index + m[0].length) : open.replace(/\s*\/?>$/, (t) => attr + t);
        return { light: 'green', newSource: src.slice(0, p.openStart) + nOpen + src.slice(p.openEnd), line: p.line, note: '只换了 src' };
      },
    });
  }
  function insertImage(filename, contLoc) {
    const ed = app.editor;
    const c = ed.frame.parsed.byLoc(contLoc);
    if (!c) return;
    ed.doSource({
      label: `插入图片：${filename}`,
      build: (src) => {
        let ls = src.lastIndexOf('\n', c.closeStart - 1) + 1;
        let indent = src.slice(ls, c.closeStart);
        if (/\S/.test(indent)) { ls = c.closeStart; indent = ''; }
        const html = `<img src="${esc(relFrom(ed.page, 'assets/' + filename))}" alt="" style="max-width: 100%;">`;
        return { light: 'yellow', newSource: src.slice(0, ls) + indent + '  ' + html + '\n' + src.slice(ls), line: c.line, note: `图片插在 <${c.tag}> 的最后，下面的内容会往下让。`, affected: [] };
      },
    });
  }
  function useFont(font) {
    const ed = app.editor;
    const rule = `<style>@font-face{font-family:"${font.name}";src:url("${relFrom(ed.page, 'assets/' + font.file)}");font-display:swap}</style>`;
    if (ed.frame.source.includes(`font-family:"${font.name}"`)) { toast('本页已经导入过这个字体', 'err'); return; }
    ed.doSource({ label: `导入字体：${font.name}`, build: (src) => { const i = src.indexOf('</head>'); if (i < 0) return { light: 'red', reason: '页面里找不到 <head>' }; return { light: 'green', newSource: src.slice(0, i) + rule + '\n' + src.slice(i), line: null, note: '选中文字后在字体下拉里就能选它' }; } });
  }
  // 从素材卡拖到编辑舞台：落在图片上 = 换图；落在别处 = 插进那一块
  document.addEventListener('dragover', (e) => {
    if (app.view() !== 'edit' || !e.dataTransfer || ![...e.dataTransfer.types].includes('text/x-cd-asset')) return;
    if (e.target.closest && e.target.closest('.stage-host')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  document.addEventListener('drop', (e) => {
    const name = e.dataTransfer && e.dataTransfer.getData('text/x-cd-asset');
    if (!name || app.view() !== 'edit' || !(e.target.closest && e.target.closest('.stage-host'))) return;
    e.preventDefault();
    const ed = app.editor;
    const hit = ed.pickAt(e.clientX, e.clientY);
    const own = hit && ed.frame.owner(hit);
    if (!own) { toast('没有落在页面内容上', 'err'); return; }
    if (own.tagName === 'IMG') { replaceImage(name, ed.frame.locOf(own)); return; }
    const box = own.closest('section[data-loc],main[data-loc],article[data-loc],div[data-loc],header[data-loc],footer[data-loc]') || own;
    insertImage(name, ed.frame.locOf(box));
  });

  bus.registerPanel({
    id: 'assets', title: '素材', icon: 'image', views: ['edit', 'overview'],
    render(host) {
      const paint = async () => {
        host.innerHTML = `<div class="p-sec"><button class="btn small primary" data-up>${icon('upload', 14)}上传图片 / 字体</button>
          <div class="hint" style="margin-top:8px">也可以把文件直接拖进这里。大图会自动压缩。把图片卡拖到页面上：落在图片上就换图，落在别处就插进那一块。</div></div>
          <div class="asset-grid"></div>`;
        host.querySelector('[data-up]').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'image/*,.svg,.woff,.woff2,.ttf,.otf'; i.onchange = () => [...i.files].forEach(upload); i.click(); };
        host.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); host.classList.add('drop'); } };
        host.ondragleave = () => host.classList.remove('drop');
        host.ondrop = (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); host.classList.remove('drop'); [...e.dataTransfer.files].forEach(upload); };
        let list = [];
        try { list = await app.api.listAssets(app.project().id); } catch { return; }
        const grid = host.querySelector('.asset-grid');
        if (!list.length) { grid.outerHTML = '<div class="empty">还没有素材</div>'; return; }
        const sel = app.view() === 'edit' ? app.editor.selection : null;
        list.forEach((a) => {
          const img = IMG_RE.test(a.filename), font = /\.(woff2?|ttf|otf)$/i.test(a.filename);
          const card = el(`<div class="asset-card" ${img ? 'draggable="true"' : ''}><div class="asset-thumb">${img ? `<img src="${esc(a.url)}" alt="" loading="lazy">` : '<b>Aa</b>'}</div><div class="asset-name" title="${esc(a.filename)}">${esc(a.filename)}</div><div class="asset-acts"></div></div>`);
          const acts = card.querySelector('.asset-acts');
          if (img) card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-cd-asset', a.filename); e.dataTransfer.effectAllowed = 'copy'; });
          if (img && app.view() === 'edit') {
            if (sel && sel.tag === 'img' && !sel.generated) { const b = el('<button class="btn small">换掉选中图</button>'); b.onclick = () => replaceImage(a.filename, sel.loc); acts.appendChild(b); }
            if (sel && !sel.generated) { const b = el('<button class="btn small">插到选中块里</button>'); b.onclick = () => insertImage(a.filename, sel.loc); acts.appendChild(b); }
          }
          if (font && app.view() === 'edit') { const b = el('<button class="btn small">用到本页</button>'); b.onclick = () => useFont({ name: a.filename.replace(/\.\w+$/, ''), file: a.filename }); acts.appendChild(b); }
          grid.appendChild(card);
        });
      };
      paint();
      this._a = bus.on('assets', () => host.isConnected && paint());
      this._b = bus.on('select', () => host.isConnected && paint());
    },
    onHide() { if (this._a) this._a(); if (this._b) this._b(); },
  });
}
