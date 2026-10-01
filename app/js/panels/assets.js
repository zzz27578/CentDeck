/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 素材库：上传（大图自动压缩）、替换选中图片、插入图片、拖到页面上、导入字体
import { el, esc, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error(i18nText('读取文件失败'))); r.readAsDataURL(file); });
// 从页面文件到素材的相对路径：pages/index.html → ../assets/x.png
const relFrom = (page, target) => '../'.repeat(Math.max(0, page.split('/').length - 1)) + target;

async function compress(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return { b64: await toB64(file), name: file.name };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(i18nText('图片解码失败'))); i.src = url; });
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
    if (!isFont && !IMG_RE.test(file.name) && !/^image\//.test(file.type)) { toast(i18nText('只支持图片和字体文件'), 'err'); return; }
    try {
      const r = isFont ? { b64: await toB64(file), name: file.name } : await compress(file);
      const name = r.name.replace(/[^\w.一-龥-]+/g, '_');
      await app.api.saveAsset(proj.id, name, r.b64);
      if (isFont) window.__cdFonts.push({ name: name.replace(/\.\w+$/, ''), file: name });
      toast(i18nTpl`「${name}」已加入素材${r.compressed ? i18nText('（已自动压缩）') : ''}`, 'ok');
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
    if (!p || p.tag !== 'img') { toast(i18nText('先选中页面里的一张图片'), 'err'); return; }
    ed.doSource({
      label: i18nTpl`换图：${filename}`,
      build: (src) => {
        const open = src.slice(p.openStart, p.openEnd);
        const m = /\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(open);
        const val = relFrom(ed.page, 'assets/' + filename);
        const attr = ` src="${val}"`;
        const nOpen = m ? open.slice(0, m.index) + attr + open.slice(m.index + m[0].length) : open.replace(/\s*\/?>$/, (t) => attr + t);
        return { light: 'green', newSource: src.slice(0, p.openStart) + nOpen + src.slice(p.openEnd), line: p.line, note: i18nText('只换了 src') };
      },
    });
  }
  function useFont(font) {
    const ed = app.editor;
    const rule = `<style>@font-face{font-family:"${font.name}";src:url("${relFrom(ed.page, 'assets/' + font.file)}");font-display:swap}</style>`;
    if (ed.frame.source.includes(`font-family:"${font.name}"`)) { toast(i18nText('本页已经导入过这个字体'), 'err'); return; }
    ed.doSource({ label: i18nTpl`导入字体：${font.name}`, build: (src) => { const i = src.indexOf('</head>'); if (i < 0) return { light: 'red', reason: i18nText('页面里找不到 <head>') }; return { light: 'green', newSource: src.slice(0, i) + rule + '\n' + src.slice(i), line: null, note: i18nText('选中文字后在字体下拉里就能选它') }; } });
  }
  // 从素材卡拖到页面上：变成一张浮在最上层的参考图（草图，不写代码），像 Word 一样随意摆
  const assetUrl = (name) => `/preview/${encodeURIComponent(app.project().id)}/assets/${encodeURIComponent(name)}`;
  document.addEventListener('dragover', (e) => {
    if (app.view() !== 'edit' || !e.dataTransfer || ![...e.dataTransfer.types].includes('text/x-cd-asset')) return;
    if (e.target.closest && e.target.closest('.stage-host')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  document.addEventListener('drop', (e) => {
    const name = e.dataTransfer && e.dataTransfer.getData('text/x-cd-asset');
    if (!name || app.view() !== 'edit' || !(e.target.closest && e.target.closest('.stage-host'))) return;
    e.preventDefault();
    app.sketch.addImage({ asset: name, src: assetUrl(name) }, app.editor.toPage(e.clientX, e.clientY));
  });

  bus.registerPanel({
    id: 'assets', title: i18nText('素材'), icon: 'image', views: ['edit', 'overview'],
    render(host) {
      const paint = async () => {
        host.innerHTML = i18nTpl`<div class="p-sec"><button class="btn small primary" data-up>${icon('upload', 14)}上传图片 / 字体</button>
          <div class="hint" style="margin-top:8px">也可以把文件直接拖进这里，大图会自动压缩。把图片卡拖到页面上，它会变成一张浮在最上层的参考图，随意摆放后交给 AI 放进代码。</div></div>
          <div class="asset-grid"></div>`;
        host.querySelector('[data-up]').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'image/*,.svg,.woff,.woff2,.ttf,.otf'; i.onchange = () => [...i.files].forEach(upload); i.click(); };
        host.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); host.classList.add('drop'); } };
        host.ondragleave = () => host.classList.remove('drop');
        host.ondrop = (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); host.classList.remove('drop'); [...e.dataTransfer.files].forEach(upload); };
        let list = [];
        try { list = await app.api.listAssets(app.project().id); } catch { return; }
        const grid = host.querySelector('.asset-grid');
        if (!list.length) { grid.outerHTML = i18nText('<div class="empty">还没有素材</div>'); return; }
        const sel = app.view() === 'edit' ? app.editor.selection : null;
        list.forEach((a) => {
          const img = IMG_RE.test(a.filename), font = /\.(woff2?|ttf|otf)$/i.test(a.filename);
          const card = el(`<div class="asset-card" ${img ? 'draggable="true"' : ''}><div class="asset-thumb">${img ? `<img src="${esc(a.url)}" alt="" loading="lazy">` : '<b>Aa</b>'}</div><div class="asset-name" title="${esc(a.filename)}">${esc(a.filename)}</div><div class="asset-acts"></div></div>`);
          const acts = card.querySelector('.asset-acts');
          if (img) card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-cd-asset', a.filename); e.dataTransfer.effectAllowed = 'copy'; });
          if (img && app.view() === 'edit') {
            if (sel && sel.tag === 'img' && !sel.generated) { const b = el(i18nText('<button class="btn small">换掉选中图</button>')); b.onclick = () => replaceImage(a.filename, sel.loc); acts.appendChild(b); }
            const put = el(i18nText('<button class="btn small" data-tip="浮在页面最上层，随意拖动缩放，不写进代码">放到页面上</button>'));
            put.onclick = () => app.sketch.addImage({ asset: a.filename, src: a.url });
            acts.appendChild(put);
          }
          if (font && app.view() === 'edit') { const b = el(i18nText('<button class="btn small">用到本页</button>')); b.onclick = () => useFont({ name: a.filename.replace(/\.\w+$/, ''), file: a.filename }); acts.appendChild(b); }
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
