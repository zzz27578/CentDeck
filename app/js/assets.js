// assets.js —— 内置插件：素材库
// 面板列出项目素材（GET assets，图片缩略图）；上传支持文件选择 + 拖到面板：
//   >1600px 或 >500KB 的图片用 canvas 重采样压缩后 base64 上传（透明图保留 PNG，否则 JPEG q0.85）。
// 替换图片：选中 <img> 精确定位 open 标签内 src 属性逐字节替换（单行绿灯）；
//           选中 SVG 占位图 → 提示转草图标记；"把素材插入页面"在当前选中容器内插入 <img>。
// 字体导入：上传 .woff2 → 页面 <head> 内插入 @font-face（精确文本插入，PUT 保存）。

import { api } from './api.js';
import { el, esc, toast } from './ui.js';

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

export function setup(ctx) {
  const { bus } = ctx;

  // ---------- 工具 ----------
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('读取文件失败'));
      r.readAsDataURL(file);
    });
  }

  // 检测图片是否带透明通道（抽样 32x32）
  function hasAlpha(img) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  // 压缩：>1600px 或 >500KB 才动；透明留 PNG，否则 JPEG 0.85
  async function compressImage(file) {
    const needBySize = file.size > 500 * 1024;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('图片解码失败'));
        im.src = url;
      });
      const needByDim = img.naturalWidth > 1600 || img.naturalHeight > 1600;
      if (!needBySize && !needByDim) return { base64: await fileToBase64(file), ext: (file.name.split('.').pop() || 'png').toLowerCase() };
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const keepPng = file.type === 'image/png' && hasAlpha(img);
      const mime = keepPng ? 'image/png' : 'image/jpeg';
      const dataUrl = c.toDataURL(mime, keepPng ? undefined : 0.85);
      return { base64: dataUrl.split(',')[1], ext: keepPng ? 'png' : 'jpg', compressed: true };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadFile(file) {
    const proj = ctx.project();
    if (!proj) return;
    if (/\.woff2?$/i.test(file.name)) return uploadFont(file);
    if (!IMG_RE.test(file.name) && !/^image\//.test(file.type)) {
      toast('只支持图片（png/jpg/gif/webp/svg）和字体（woff2）', 'err');
      return;
    }
    try {
      let base64, name = file.name.replace(/[^\w.一-龥-]+/g, '_');
      if (/^image\/(png|jpeg)/.test(file.type) || IMG_RE.test(file.name)) {
        const r = await compressImage(file);
        base64 = r.base64;
        if (r.compressed) {
          name = name.replace(/\.\w+$/, '.' + r.ext);
          toast('图片已自动压缩后上传', '', 2600);
        }
      } else {
        base64 = await fileToBase64(file);
      }
      await api.saveAsset(proj.id, name, base64);
      toast(`素材「${name}」已上传`, 'ok');
      bus.emit('assets');
    } catch { /* api 已提示 */ }
  }

  async function uploadFont(file) {
    const proj = ctx.project();
    try {
      const base64 = await fileToBase64(file);
      const name = file.name.replace(/[^\w.一-龥-]+/g, '_');
      await api.saveAsset(proj.id, name, base64);
      // 登记到字体选择器（内存态，刷新后由 refreshFonts 重建）
      const fontName = name.replace(/\.\w+$/, '');
      registerFont({ name: fontName, file: name });
      toast(`字体「${fontName}」已导入，并出现在字体选择器里`, 'ok');
      bus.emit('assets');
    } catch { /* api 已提示 */ }
  }

  // 字体登记（window.__cdFonts：属性面板字体下拉读取；@font-face 在"应用到当前页"时写入页面源码）
  function registerFont(f) {
    window.__cdFonts = window.__cdFonts || [];
    if (!window.__cdFonts.some((x) => x.name === f.name)) window.__cdFonts.push(f);
  }

  async function refreshFonts() {
    const proj = ctx.project();
    if (!proj) return;
    try {
      const list = await api.listAssets(proj.id);
      list.filter((a) => /\.woff2?$/i.test(a.filename)).forEach((a) =>
        registerFont({ name: a.filename.replace(/\.\w+$/, ''), file: a.filename }));
    } catch { /* 忽略 */ }
  }

  // 把 @font-face 规则插入当前页 <head>（精确文本插入，走 bus 命令可撤销）
  async function applyFontFace(font) {
    const proj = ctx.project();
    const page = ctx.editor.page;
    const session = ctx.editor.session;
    if (!proj || !page || !session) { toast('先在编辑视图打开一页', 'err'); return; }
    const rule = `@font-face{font-family:"${font.name}";src:url("../assets/${font.file}") format("woff2");font-display:swap;}`;
    const source = session.source;
    if (source.includes(`font-family:"${font.name}"`) || source.includes(`font-family: "${font.name}"`)) {
      toast('这个页面已经有该字体的 @font-face', 'err');
      return;
    }
    // 优先插到 cd-tokens 的 </style> 后面；没有就插到 </head> 前
    const before = source;
    let after = null;
    const m = source.match(/<style\s+id="cd-tokens"[^>]*>[\s\S]*?<\/style>/i);
    if (m) {
      const at = m.index + m[0].length;
      after = source.slice(0, at) + `\n<style>${rule}</style>` + source.slice(at);
    } else {
      const hi = source.indexOf('</head>');
      if (hi < 0) { toast('页面里找不到 <head>，无法插入字体规则', 'err'); return; }
      after = source.slice(0, hi) + `<style>${rule}</style>\n` + source.slice(hi);
    }
    await bus.do({
      label: `导入字体「${font.name}」到本页`,
      page,
      beforeSource: before,
      afterSource: after,
      apply: async () => {
        await api.writeFile(proj.id, page, after);
        await session.setSource(after);
      },
      revert: async () => {
        await api.writeFile(proj.id, page, before);
        await session.setSource(before);
      },
    });
    toast('字体规则已写入本页 <head>，选中文字后在字体下拉里选它', 'ok', 4200);
  }

  // ---------- 替换图片 / 插入图片 ----------
  function selectionEl() {
    const s = ctx.editor.session;
    const info = ctx.editor.selection;
    if (!s || !info || info.generated) return null;
    return s.parsed.byLoc(info.loc);
  }

  async function replaceImage(asset, infoE = null) {
    const proj = ctx.project();
    const page = ctx.editor.page;
    const session = ctx.editor.session;
    if (!infoE) infoE = selectionEl();
    if (!proj || !session || !infoE) return;
    if (infoE.tag === 'svg' || (infoE.type === 'image' && infoE.tag !== 'img')) {
      // svg：本步提示转为标记交给后续
      toast('内联 SVG 换图涉及结构改写，已帮你记成草图标记交给 AI', '', 4200);
      bus.runCommand('sketch.markFromVerdict', ctx, {
        light: 'red', selector: infoE.selector,
        reason: `想用素材「${asset.filename}」替换这段内联 SVG（第 ${infoE.line} 行），SVG 换图属于结构改写，不适合直接写回。`,
      }, { label: '替换图片' });
      return;
    }
    if (infoE.tag !== 'img') { toast('先选中页面里的一张 <img> 图片', 'err'); return; }
    // 精确定位 open 标签内 src 属性，逐字节替换（单行绿灯）
    const open = session.source.slice(infoE.openStart, infoE.openEnd);
    const m = /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/i.exec(open);
    if (!m) { toast('这个 <img> 没有 src 属性，无法替换', 'err'); return; }
    const rel = `assets/${asset.filename}`;
    const before = session.source;
    const attrStart = infoE.openStart + m.index;
    const quote = m[2] != null ? '"' : m[3] != null ? "'" : null;
    const newAttr = quote ? m[0].replace(/=\s*.*$/, `=${quote}${rel}${quote}`) : m[0].replace(/=\s*.*$/, `=${rel}`);
    const after = before.slice(0, attrStart) + newAttr + before.slice(attrStart + m[0].length);
    await bus.do({
      label: `替换图片为「${asset.filename}」`,
      page,
      beforeSource: before,
      afterSource: after,
      apply: async () => {
        await api.writeFile(proj.id, page, after);
        await session.setSource(after);
      },
      revert: async () => {
        await api.writeFile(proj.id, page, before);
        await session.setSource(before);
      },
    });
    // 绿灯提示（单行替换，借用判定面板的绿通道）
    toast(`已替换：只改了第 ${infoE.line} 行的 src 属性`, 'ok');
  }

  async function insertImage(asset, cont = null) {
    const proj = ctx.project();
    const page = ctx.editor.page;
    const session = ctx.editor.session;
    if (!proj || !session) return;
    // 容器：优先用传入容器（拖放落点）；否则当前选中（不是容器就用它的父级）；没选中用第一个版块
    if (!cont) {
      const info = ctx.editor.selection;
      if (info && !info.generated) {
        const e = session.parsed.byLoc(info.loc);
        if (e) cont = e.type === 'container' || /^(section|div|main|article|header|footer|nav|aside)$/.test(e.tag)
          ? e
          : (e.parent != null ? session.parsed.byLoc(e.parent) : null);
      }
      if (!cont) cont = session.parsed.elements.find((e) => /^(section|main|article)$/.test(e.tag)) || null;
    }
    if (!cont) { toast('找不到可以插入的容器，先点选页面里的某个区块', 'err'); return; }
    const rel = `assets/${asset.filename}`;
    const before = session.source;
    let ls = before.lastIndexOf('\n', cont.closeStart - 1) + 1;
    let indent = before.slice(ls, cont.closeStart);
    if (/\S/.test(indent)) { ls = cont.closeStart; indent = ''; }
    const html = `<img src="${esc(rel)}" alt="" style="max-width: 100%;">`;
    const after = before.slice(0, ls) + indent + '  ' + html + '\n' + before.slice(ls);
    await bus.do({
      label: `插入图片「${asset.filename}」`,
      page,
      beforeSource: before,
      afterSource: after,
      apply: async () => {
        await api.writeFile(proj.id, page, after);
        await session.setSource(after);
      },
      revert: async () => {
        await api.writeFile(proj.id, page, before);
        await session.setSource(before);
      },
    });
    toast(`已插入到 <${cont.tag}>（第 ${cont.line} 行）里`, 'ok');
  }

  // ---------- 面板 ----------
  bus.registerPanel({
    id: 'assets',
    title: '素材',
    icon: '🖼️',
    side: 'left',
    render(host) {
      const proj = ctx.project();
      if (!proj) { host.innerHTML = '<div class="panel-empty">先打开一个项目</div>'; return; }
      const paint = async () => {
        host.innerHTML = '';
        const bar = el(`<div class="panel-actions">
          <button class="btn small primary" id="as-upload">上传图片 / 字体</button>
        </div>
        <div class="panel-note"><small>也可以直接把文件拖进这个面板。大于 1600px 或 500KB 的图片会自动压缩。</small></div>`);
        bar.querySelector('#as-upload').onclick = () => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = 'image/*,.svg,.woff2,.woff';
          inp.multiple = true;
          inp.onchange = () => { [...inp.files].forEach(uploadFile); };
          inp.click();
        };
        host.appendChild(bar);
        // 拖拽上传
        host.ondragover = (e) => { e.preventDefault(); host.classList.add('drag'); };
        host.ondragleave = () => host.classList.remove('drag');
        host.ondrop = (e) => {
          e.preventDefault();
          host.classList.remove('drag');
          [...(e.dataTransfer.files || [])].forEach(uploadFile);
        };
        let list;
        try { list = await api.listAssets(proj.id); }
        catch { host.insertAdjacentHTML('beforeend', '<div class="panel-empty">读取素材失败</div>'); return; }
        if (!list.length) {
          host.insertAdjacentHTML('beforeend', '<div class="panel-empty">还没有素材</div>');
          return;
        }
        const grid = el('<div class="asset-grid"></div>');
        list.forEach((a) => {
          const isImg = IMG_RE.test(a.filename);
          const isFont = /\.woff2?$/i.test(a.filename);
          const card = el(`<div class="asset-card">
            <div class="asset-thumb">${isImg ? `<img src="${esc(a.url)}" alt="" loading="lazy">` : isFont ? '<span class="asset-font-ico">Aa</span>' : '<span class="asset-font-ico">📄</span>'}</div>
            <div class="asset-name" title="${esc(a.filename)}">${esc(a.filename)}</div>
            <div class="asset-acts"></div>
          </div>`);
          const acts = card.querySelector('.asset-acts');
          // 拖拽源头：图片素材卡可以整个拖上页面（替换/插入由接收层按落点决定）
          if (isImg) {
            card.draggable = true;
            card.title = '可以拖到页面上：落到图片=替换，落到区块=插入';
            card.addEventListener('dragstart', (e) => {
              e.dataTransfer.setData('application/x-centdeck-asset', a.filename);
              e.dataTransfer.effectAllowed = 'copy';
            });
          }
          if (isImg && ctx.view() === 'edit') {
            const info = ctx.editor.selection;
            if (info && !info.generated && session_tag() === 'img') {
              const rb = el('<button class="btn small">替换选中图</button>');
              rb.title = '把选中的 <img> 的 src 换成这个素材';
              rb.onclick = () => replaceImage(a);
              acts.appendChild(rb);
            }
            const ib = el('<button class="btn small">插入页面</button>');
            ib.title = '在当前选中容器（没选中则第一个版块）里插入这张图片';
            ib.onclick = () => insertImage(a);
            acts.appendChild(ib);
          }
          if (isFont && ctx.view() === 'edit') {
            const fb = el('<button class="btn small">用到本页</button>');
            fb.title = '在本页 <head> 插入 @font-face，之后字体下拉里能选';
            fb.onclick = () => applyFontFace({ name: a.filename.replace(/\.\w+$/, ''), file: a.filename });
            acts.appendChild(fb);
          }
          grid.appendChild(card);
        });
        host.appendChild(grid);
      };
      function session_tag() {
        const s = ctx.editor.session, info = ctx.editor.selection;
        if (!s || !info || info.generated) return null;
        const e = s.parsed.byLoc(info.loc);
        return e ? e.tag : null;
      }
      paint();
      this._off1 = bus.on('assets', () => { if (host.isConnected) paint(); });
      this._off2 = bus.on('select', () => { if (host.isConnected) paint(); });
    },
    onHide() {
      if (this._off1) this._off1();
      if (this._off2) this._off2();
    },
  });

  // 打开项目时重建字体登记表
  bus.on('project', refreshFonts);

  // ---------- 素材拖上页面：透明接收层 ----------
  // 拖拽从素材卡出发（同文档），dragenter 进编辑视图时在舞台上铺接收层；
  // 落点是 <img> → 替换；落点是区块容器 → 插入。草图开着也能用（接收层在其上）。
  function stageScale() {
    const fr = ctx.editor.iframeRect();
    const f = document.querySelector('#stage-frame');
    if (!fr || !f || !f.offsetWidth) return 1;
    return fr.width / f.offsetWidth; // 适配档 iframe 被 transform 缩放：rect 是视觉宽，offsetWidth 是布局宽
  }
  function showDropLayer() {
    const stage = document.querySelector('#stage');
    if (!stage || stage.querySelector('.asset-droplayer')) return;
    const layer = el('<div class="asset-droplayer"><span>松开鼠标：放到图片上 = 替换它；放到区块上 = 插入图片</span><input type="file" hidden></div>');
    const off = () => { if (layer.isConnected) layer.remove(); document.removeEventListener('dragend', off); };
    layer.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    layer.addEventListener('drop', async (e) => {
      e.preventDefault();
      const name = e.dataTransfer.getData('application/x-centdeck-asset');
      off();
      if (!name) return;
      const session = ctx.editor.session;
      if (!session || !session.document) return;
      const doc = session.document;
      const fr = ctx.editor.iframeRect();
      if (!fr) return;
      const k = stageScale();
      const node = doc.elementFromPoint((e.clientX - fr.left) / k, (e.clientY - fr.top) / k);
      if (!node) { toast('没有落在页面内容上', 'err'); return; }
      const withLoc = node.hasAttribute('data-loc') ? node : node.closest('[data-loc]');
      // 落在图片上 → 替换它
      if (node.tagName === 'IMG' && withLoc) {
        const eInfo = session.parsed.byLoc(+withLoc.getAttribute('data-loc'));
        await replaceImage({ filename: name }, eInfo);
        return;
      }
      // 否则找最近的区块容器 → 插入
      let cont = null;
      if (withLoc) {
        const cNode = withLoc.closest('section,main,article,div,header,footer,nav,aside') || withLoc;
        if (cNode && cNode.hasAttribute('data-loc')) cont = session.parsed.byLoc(+cNode.getAttribute('data-loc'));
      }
      if (!cont) { toast('找不到落点所在的区块', 'err'); return; }
      await insertImage({ filename: name }, cont);
    });
    stage.appendChild(layer);
    document.addEventListener('dragend', off); // 源头松手（含拖出窗口取消）
  }
  document.addEventListener('dragenter', (e) => {
    if (ctx.view() !== 'edit') return;
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('application/x-centdeck-asset')) return;
    showDropLayer();
  });
  bus.on('view', (v) => { if (v !== 'edit') { const l = document.querySelector('.asset-droplayer'); if (l) l.remove(); } });
}
