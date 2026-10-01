// 右侧属性栏：没选中时显示本页信息和操作提示；选中后按"文字 / 字体 / 位置大小 / 操作"分组
import { icon } from '../core/icons.js';
import { el, esc, toast } from '../core/ui.js';
import { getStyleProp } from '../engine/writeback.js';
import { comboFor } from '../core/keys.js';
import { getDevice } from '../core/viewport.js';

const FONTS = [
  ['跟随页面', ''], ['微软雅黑', '"Microsoft YaHei", sans-serif'], ['苹方', '"PingFang SC", sans-serif'],
  ['思源黑体', '"Source Han Sans SC", "Noto Sans SC", sans-serif'], ['宋体', 'SimSun, serif'], ['黑体', 'SimHei, sans-serif'],
  ['楷体', 'KaiTi, serif'], ['Arial', 'Arial, sans-serif'], ['Georgia', 'Georgia, serif'], ['等宽', 'ui-monospace, Consolas, monospace'],
];
const KIND = { h1: '大标题', h2: '标题', h3: '小标题', h4: '小标题', p: '段落', a: '链接', button: '按钮', img: '图片', svg: '图形', span: '文字', li: '列表项', ul: '列表', section: '版块', header: '页眉', footer: '页脚', nav: '导航', div: '区块', input: '输入框', label: '标签', em: '强调文字', strong: '加粗文字', b: '加粗文字', article: '文章块', form: '表单', table: '表格' };
const hex = (c) => { const m = String(c).match(/\d+(\.\d+)?/g); return m && m.length >= 3 ? '#' + m.slice(0, 3).map((v) => ('0' + Math.round(+v).toString(16)).slice(-2)).join('') : '#000000'; };

// 元素的"文字段"（与写回引擎的段落编号一致：空白段也占号）
function textGaps(e) {
  const out = [];
  let cur = '', idx = 0;
  const flush = () => { if (cur !== '') { out.push({ index: idx, text: cur }); idx++; } cur = ''; };
  e.childNodes.forEach((n) => { if (n.nodeType === 3) cur += n.data; else if (n.nodeType === 1 || n.nodeType === 8) flush(); });
  flush();
  return out;
}

export function renderInspector(ed, info, clear) {
  const app = ed.app;
  const box = app.refs && app.refs.inspectorBody;
  if (!box) return;
  if (clear || !ed.frame) { box.innerHTML = ''; return; }
  if (!info) { renderPage(ed, box); return; }
  const e = info.element, win = ed.frame.win, cs = win.getComputedStyle(e);
  const locked = app.isLocked(info);
  const elLocked = !info.generated && app.elementLocked(ed.page, info.selector);
  const kind = KIND[info.tag] || '元素';
  box.innerHTML = `
    <div class="insp-head">
      <div class="insp-title"><span class="grow">${esc(kind)} <span style="color:var(--dim);font-weight:400">&lt;${esc(info.tag)}&gt;</span></span>
        ${info.generated ? '' : `<button class="icon-btn sm ${elLocked ? 'on' : ''}" data-a="lock" data-tip="${elLocked ? '解锁' : '锁定：手和 AI 都改不了'}" data-kbd="Ctrl+Shift+L">${icon(elLocked ? 'lock' : 'unlock', 15)}</button>`}
        <button class="icon-btn sm" data-a="parent" data-tip="选择外面一层" data-kbd="Shift+Enter">${icon('parent', 15)}</button>
        <button class="icon-btn sm" data-a="close" data-tip="收起属性栏" data-kbd="Alt+P">${icon('close', 14)}</button></div>
      <div class="insp-sub">${info.generated ? '程序运行时生成（代码里没有它自己的一行）' : `代码第 ${info.line}${info.endLine > info.line ? '–' + info.endLine : ''} 行 · ${Math.round(e.getBoundingClientRect().width)} × ${Math.round(e.getBoundingClientRect().height)}`}</div>
      ${info.generated ? '<div class="insp-warn red">它是脚本临时生成的，没法直接改代码；想改就右键"记成草图标记"交给 AI。</div>' : ''}
      ${locked ? `<div class="insp-warn">已锁定${app.pageLocked(ed.page) ? '（整页锁定）' : ''}，修改入口都关掉了。</div>` : ''}
      ${getDevice() === 'mobile' && !info.generated ? '<div class="insp-warn" style="background:var(--accent-soft);color:var(--accent-2)">手机模式：这里改的位置、大小、字号、颜色只对手机屏幕生效；文字内容两边共用。</div>' : ''}
      ${!info.generated && info.transformAnim ? '<div class="insp-warn" style="background:var(--accent-soft);color:var(--accent-2)">带动画：挪位和缩放走独立通道，不会和动画打架。</div>' : ''}
    </div>
    <div class="insp-tabs seg"><button data-tab="text">文字</button><button data-tab="layout">布局</button></div>
    <div class="insp-body ${locked || info.generated ? 'disabled' : ''}">
      <div class="p-sec" data-sec="text" hidden><div class="p-sec-title">文字内容<span class="grow"></span><span style="font-weight:400">双击页面文字也能改</span></div><div data-host="text"></div></div>
      <div class="p-sec" data-sec="font"><div class="p-sec-title">字体</div>
        <div class="p-row"><label>字号</label><div class="num"><span>px</span><input type="number" data-k="fs" min="6" max="200"></div>
          <input type="range" data-k="fsr" min="8" max="96" style="flex:1.4;accent-color:var(--accent)"></div>
        <div class="p-row"><label>字重</label><select class="sel" data-k="weight" aria-label="字重">${[100,200,300,400,500,600,700,800,900].map(v => `<option value="${v}">${v}</option>`).join('')}</select></div>
        <div class="p-row"><label>行高</label><div class="num"><span>px</span><input type="number" data-k="lh" aria-label="行高" min="1" step="0.5" placeholder="自动"></div></div>
        <div class="p-row"><label>字间距</label><div class="num"><span>px</span><input type="number" data-k="ls" aria-label="字间距" step="0.1"></div></div>
        <div class="p-row"><label>字体</label><select class="sel" data-k="ff"></select></div>
        <div class="p-row"><label>颜色</label><div class="swatches" data-host="sw"></div><input type="color" class="color-ipt" data-k="color" data-tip="自定义颜色"></div>
        <div class="p-row"><label>样式</label><div class="seg"><button data-k="bold" data-tip="加粗"><b>B</b></button></div>
          <div class="seg" data-k="align"><button data-v="left" data-tip="左对齐">左</button><button data-v="center" data-tip="居中">中</button><button data-v="right" data-tip="右对齐">右</button></div></div>
      </div>
      <div class="p-sec" data-sec="layout"><div class="p-sec-title">位置与大小<span class="grow"></span><span style="font-weight:400">拖动或方向键也行</span></div>
        <div class="p-row"><label>偏移</label><div class="num"><span>X</span><input type="number" data-k="x"></div><div class="num"><span>Y</span><input type="number" data-k="y"></div></div>
        <div class="p-row"><label>尺寸</label><div class="num"><span>宽</span><input type="number" data-k="w" min="4"></div><div class="num"><span>高</span><input type="number" data-k="h" min="4"></div></div>
        <div class="p-row"><label>缩放</label><div class="range-row" style="flex:1"><input type="range" data-k="sc" min="20" max="300" step="5"><span class="val" data-k="scv"></span></div></div>
      </div>
      <div class="p-sec"><div class="p-sec-title">操作</div><div class="p-actions">
        <button class="btn small" data-a="note">${icon('sticky', 14)}贴便签</button>
        <button class="btn small" data-a="mark">${icon('marks', 14)}记成草图标记</button>
        <button class="btn small danger" data-a="del">${icon('trash', 14)}删除</button></div></div>
    </div>`;
  const q = (s) => box.querySelector(s);
  const setTab = tab => { box.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-pressed', b.dataset.tab === tab); }); q('[data-sec=font]').hidden = tab !== 'text'; q('[data-sec=layout]').hidden = tab !== 'layout'; q('[data-sec=text]').hidden = tab !== 'text' || !textGaps(e).some(g => g.text.trim()); };
  box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  setTab(ed.tool === 'text' || info.hasText ? 'text' : 'layout');
  q('[data-a=parent]').onclick = () => ed.selectParent();
  q('[data-a=close]').onclick = () => ed.toggleInspector(false);
  const lockB = q('[data-a=lock]');
  if (lockB) lockB.onclick = () => app.setElementLock(ed.page, info.selector, !elLocked).then(() => renderInspector(ed, ed.selection));
  q('[data-a=note]').onclick = () => app.sketch.markElement(info);
  q('[data-a=mark]').onclick = () => app.sketch && app.sketch.markElement(info);
  q('[data-a=del]').onclick = () => ed.deleteSelection();
  if (info.generated) return;

  // 文字内容
  const gaps = textGaps(e).filter((g) => g.text.trim());
  if (gaps.length) {
    q('[data-sec=text]').hidden = false;
    const host = q('[data-host=text]');
    gaps.forEach((g, i) => {
      if (gaps.length > 1) host.appendChild(el(`<div class="insp-seg-label">第 ${i + 1} 段</div>`));
      const ta = el('<textarea class="ipt insp-text" rows="2"></textarea>');
      const lead = /^\s*/.exec(g.text)[0], trail = /\s*$/.exec(g.text)[0];
      ta.value = g.text.trim();
      const apply = () => {
        const nv = ta.value.replace(/\n+/g, ' ');
        if (nv === g.text.trim()) return;
        if (!nv.trim() && gaps.length === 1 && info.textOnly) { toast('文字不能全部删空', 'err'); ta.value = g.text.trim(); return; }
        ed.commitText([{ loc: info.loc, index: g.index, oldText: g.text, newText: lead + nv + trail }]);
      };
      ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); } });
      ta.addEventListener('change', apply);
      host.appendChild(ta);
    });
  }

  // 字体
  q('[data-k=weight]').value = parseInt(cs.fontWeight) || 400;
  q('[data-k=weight]').onchange = e => ed.applyStyle({'font-weight':e.target.value}, '改字重');
  const lh = q('[data-k=lh]'), ls = q('[data-k=ls]');
  lh.value = cs.lineHeight === 'normal' ? '' : parseFloat(cs.lineHeight);
  ls.value = parseFloat(cs.letterSpacing) || 0;
  lh.onchange = () => { if (!lh.value || +lh.value > 0) ed.applyStyle({'line-height':lh.value ? lh.value+'px' : null}, '改行高'); };
  ls.onchange = () => { if (Number.isFinite(+ls.value)) ed.applyStyle({'letter-spacing':ls.value+'px'}, '改字间距'); };
  [lh, ls].forEach(input => input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.onchange(); }
  }));
  const fs = Math.round(parseFloat(cs.fontSize));
  const fsI = q('[data-k=fs]'), fsR = q('[data-k=fsr]');
  fsI.value = fs; fsR.value = Math.min(96, Math.max(8, fs));
  fsR.oninput = () => { fsI.value = fsR.value; e.style.setProperty('font-size', fsR.value + 'px', 'important'); };
  fsR.onchange = () => ed.applyStyle({ 'font-size': fsR.value + 'px' }, `字号改为 ${fsR.value}px`);
  fsI.onchange = () => { const v = Math.round(+fsI.value); if (v > 0) ed.applyStyle({ 'font-size': v + 'px' }, `字号改为 ${v}px`); };
  const ff = q('[data-k=ff]');
  [...FONTS, ...(window.__cdFonts || []).map((f) => [f.name, `"${f.name}"`])].forEach(([l, v]) => { const o = document.createElement('option'); o.textContent = l; o.value = v; ff.appendChild(o); });
  ff.value = getStyleProp(info, 'font-family') || '';
  ff.onchange = () => ed.applyStyle({ 'font-family': ff.value || null }, '改字体');
  const cur = hex(cs.color);
  const sw = q('[data-host=sw]');
  const colors = app.project().tokens && app.project().tokens.colors ? Object.entries(app.project().tokens.colors) : [];
  colors.slice(0, 10).forEach(([k, c]) => {
    const b = el(`<button class="swatch ${String(c).toLowerCase() === cur ? 'on' : ''}" style="background:${esc(c)}" data-tip="规范色 ${esc(k)} ${esc(c)}"></button>`);
    b.onclick = () => ed.applyStyle({ color: c }, `颜色改为 ${k}`);
    sw.appendChild(b);
  });
  const ci = q('[data-k=color]');
  ci.value = cur;
  ci.oninput = () => { e.style.setProperty('color', ci.value, 'important'); };
  ci.onchange = () => ed.applyStyle({ color: ci.value }, `颜色改为 ${ci.value}`);
  const bold = parseInt(cs.fontWeight, 10) >= 600;
  const bB = q('[data-k=bold]');
  bB.classList.toggle('on', bold);
  bB.onclick = () => ed.applyStyle({ 'font-weight': bold ? '400' : '700' }, bold ? '取消加粗' : '加粗');
  q('[data-k=align]').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === cs.textAlign || (b.dataset.v === 'left' && cs.textAlign === 'start'));
    b.onclick = () => ed.applyStyle({ 'text-align': b.dataset.v }, '文字对齐：' + b.textContent);
  });

  // 位置与大小
  const t = cs.translate && cs.translate !== 'none' ? cs.translate.split(/\s+/).map(parseFloat) : [0, 0];
  const xI = q('[data-k=x]'), yI = q('[data-k=y]');
  xI.value = Math.round(t[0] || 0); yI.value = Math.round(t[1] || 0);
  const setOff = () => {
    const dx = Math.round(+xI.value || 0) - Math.round(t[0] || 0), dy = Math.round(+yI.value || 0) - Math.round(t[1] || 0);
    if (dx || dy) ed.commitMove(info, dx, dy, () => {});
  };
  xI.onchange = setOff; yI.onchange = setOff;
  const wI = q('[data-k=w]'), hI = q('[data-k=h]');
  wI.value = Math.round(e.offsetWidth || e.getBoundingClientRect().width);
  hI.value = Math.round(e.offsetHeight || e.getBoundingClientRect().height);
  const inline = ed.isInlineText(e);
  const scI0 = q('[data-k=sc]');
  [xI, yI, wI, hI, scI0].forEach((n) => { n.disabled = inline; });
  if (inline) {
    const sec = xI.closest('.p-sec');
    sec.querySelector('.p-sec-title span:last-child').textContent = '行内文字：挪动或缩放它所在的整块';
    sec.insertAdjacentHTML('beforeend', '<div class="hint" style="margin-top:6px">浏览器规定行内文字（比如一句话里的加粗、链接）不能单独挪动或缩放。按 <kbd>Shift</kbd>+<kbd>Enter</kbd> 选外面一层，或者直接拖它——会自动拖整块。</div>');
  }
  wI.onchange = () => { const v = Math.round(+wI.value); if (v > 0) ed.applyStyle({ width: v + 'px' }, `宽度改为 ${v}px`); };
  hI.onchange = () => { const v = Math.round(+hI.value); if (v > 0) ed.applyStyle({ height: v + 'px' }, `高度改为 ${v}px`); };
  const scI = q('[data-k=sc]'), scV = q('[data-k=scv]');
  const sc0 = Math.round((parseFloat(cs.scale) || 1) * 100);
  scI.value = sc0; scV.textContent = sc0 + '%';
  scI.oninput = () => { scV.textContent = scI.value + '%'; e.style.setProperty('scale', String(scI.value / 100), 'important'); };
  scI.onchange = () => { const v = +scI.value; ed.applyStyle({ scale: v === 100 ? null : String(v / 100) }, `缩放到 ${v}%`); };
}

function renderPage(ed, box) {
  const app = ed.app;
  const pg = app.project().pages.find((p) => p.file === ed.page) || {};
  const locked = app.pageLocked(ed.page);
  box.innerHTML = `
    <div class="insp-head"><div class="insp-title"><span class="grow">${esc(pg.title || '')}</span>
      <button class="icon-btn sm ${locked ? 'on' : ''}" data-a="plock" data-tip="${locked ? '解锁本页' : '锁定本页：整页只读'}">${icon(locked ? 'lock' : 'unlock', 15)}</button>
      <button class="icon-btn sm" data-a="close" data-tip="收起属性栏" data-kbd="Alt+P">${icon('close', 14)}</button></div>
      <div class="insp-sub">${esc(ed.page || '')}</div></div>
    <div class="insp-tips">
      <h4>怎么改</h4>
      <div><kbd>${comboFor('tool.select', 'R')}</kbd>选择：点一下选中，按住直接拖</div>
      <div><kbd>${comboFor('tool.text', 'T')}</kbd>文字：点哪里就在哪里改字</div>
      <div><kbd>${comboFor('tool.interact', 'E')}</kbd>交互：像真实浏览一样点按钮、开弹窗</div>
      <div>拖<b>角点</b>等比缩放，拖<b>边线</b>改宽高</div>
      <div><kbd>Shift</kbd>+<kbd>Enter</kbd> 选外面一层 · <kbd>Tab</kbd> 选下一个</div>
      <div>方向键微调 1px，加 <kbd>Shift</kbd> 10px</div>
      <div>右键：便签、草图标记、锁定、删除</div>
      <div><kbd>Ctrl</kbd>+滚轮缩放 · 空格+拖动平移</div>
      <div style="margin-top:8px;color:var(--dim)">每次修改都会亮灯：绿灯直接写回；黄灯写回但提示连带影响；红灯保持原样并帮你记成草图标记。</div>
    </div>`;
  box.querySelector('[data-a=close]').onclick = () => ed.toggleInspector(false);
  box.querySelector('[data-a=plock]').onclick =() => app.setPageLock(ed.page, !locked).then(() => { renderPage(ed, box); ed.chrome && ed.chrome.syncLabel(); });
}
