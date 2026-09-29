// codeview.js —— 内置插件：源码面板（给想直接看代码的人；默认关闭，从左侧竖排图标打开）
// 显示当前页完整源码（带行号），选中元素时高亮它所在的行并滚动过去。
// 只读查看 + 复制；直接编辑代码是第三步"手写代码插件"的事（Monaco/CodeMirror 双向同步）。

import { api } from './api.js';
import { el, esc, toast, copyText } from './ui.js';

export function setup(ctx) {
  const { bus } = ctx;
  let host = null;
  let source = '';
  let selLine = null;

  async function refresh() {
    if (!host || !host.isConnected) return;
    const proj = ctx.project();
    const page = ctx.editor.page;
    if (!proj || !page) { host.innerHTML = '<div class="panel-empty">在编辑视图打开一页后，这里显示它的源码</div>'; return; }
    try { source = await api.readFile(proj.id, page); }
    catch { host.innerHTML = '<div class="panel-empty">源码读取失败</div>'; return; }
    paint();
  }

  function paint() {
    if (!host || !host.isConnected) return;
    const lines = source.split('\n');
    host.innerHTML = '';
    const bar = el(`<div class="panel-actions">
      <button class="btn small primary" id="cv-copy">复制整页源码</button>
      <button class="btn small" id="cv-refresh">刷新</button>
    </div>
    <div class="panel-note"><small>选中页面元素，会高亮它所在的行。本面板只读；直接改代码留给第三步的"手写代码插件"。</small></div>`);
    bar.querySelector('#cv-copy').onclick = async () => {
      const ok = await copyText(source);
      toast(ok ? '已复制整页源码' : '复制失败', ok ? 'ok' : 'err');
    };
    bar.querySelector('#cv-refresh').onclick = refresh;
    host.appendChild(bar);
    const pre = el('<pre class="code-view"></pre>');
    pre.innerHTML = lines.map((l, i) =>
      `<div class="cv-line${i + 1 === selLine ? ' on' : ''}" data-line="${i + 1}"><span class="cv-no">${i + 1}</span><span class="cv-src">${esc(l) || ' '}</span></div>`
    ).join('');
    host.appendChild(pre);
    const on = pre.querySelector('.cv-line.on');
    if (on) on.scrollIntoView({ block: 'center' });
  }

  bus.registerPanel({
    id: 'codeview',
    title: '源码',
    icon: '‹›',
    side: 'left',
    render(h) {
      host = h;
      refresh();
      this._cv1 = bus.on('select', (info) => {
        selLine = info && !info.generated && info.line != null ? info.line : null;
        if (host && host.isConnected) paint();
      });
      this._cv2 = bus.on('rendered', refresh);
    },
    onHide() {
      host = null;
      if (this._cv1) { this._cv1(); this._cv1 = null; }
      if (this._cv2) { this._cv2(); this._cv2 = null; }
    },
  });
}
