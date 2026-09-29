// layers.js —— 内置插件：图层列表（左侧面板）
// 从 engine parse 结果生成页面结构树，点击定位选中元素。

import { esc } from './ui.js';

export function setup(ctx) {
  const { bus } = ctx;

  function shortText(el) {
    if (el.textOnly && el.text.trim()) {
      const t = el.text.trim();
      return t.length > 12 ? t.slice(0, 12) + '…' : t;
    }
    return '';
  }

  function buildTree(host) {
    const session = ctx.editor.session;
    if (!session || !session.parsed) {
      host.innerHTML = '<div class="panel-empty">编辑视图下可用<br>（先打开一个项目）</div>';
      return;
    }
    const els = session.parsed.elements;
    const sel = ctx.editor.selection;
    const tree = document.createElement('div');
    tree.className = 'layer-tree';
    const byParent = new Map(); // parentLoc|null -> [el]
    els.forEach((e) => {
      const k = e.parent == null ? 'null' : String(e.parent);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(e);
    });
    function renderLevel(parentKey, depth) {
      (byParent.get(parentKey) || []).forEach((e) => {
        const kids = byParent.get(String(e.loc)) || [];
        const row = document.createElement('div');
        row.className = 'layer-row' + (sel && sel.loc === e.loc ? ' on' : '');
        row.style.paddingLeft = 8 + depth * 14 + 'px';
        row.title = `第 ${e.line} 行 <${e.tag}>`;
        row.innerHTML =
          `<span class="layer-tag">&lt;${esc(e.tag)}&gt;</span>` +
          `<span class="layer-text">${esc(shortText(e))}</span>` +
          `<span class="layer-line">${e.line}</span>`;
        row.onclick = () => ctx.editor.selectByLoc(e.loc);
        tree.appendChild(row);
        if (kids.length) renderLevel(String(e.loc), depth + 1);
      });
    }
    renderLevel('null', 0);
    host.innerHTML = '';
    host.appendChild(tree);
  }

  bus.registerPanel({
    id: 'layers',
    title: '图层',
    icon: '☰',
    side: 'left',
    render(host) {
      buildTree(host);
      // 选中变化 / 页面重渲染后同步刷新（host 被替换后旧监听随面板卸载失效，由 main 负责重建面板）
      this._off1 = bus.on('select', () => { if (host.isConnected) buildTree(host); });
      this._off2 = bus.on('rendered', () => { if (host.isConnected) buildTree(host); });
    },
    onHide() {
      if (this._off1) this._off1();
      if (this._off2) this._off2();
    },
  });
}
