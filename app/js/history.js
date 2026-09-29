// history.js —— 内置插件：版本历史（左侧面板）
// GET history 列表（时间/说明/文件），点"恢复此版本"→ POST restore → 重新加载页面。
// 说明：服务端在每次 PUT 页面源码前自动存历史快照（每个文件最多共 20 条）。

import { api } from './api.js';
import { esc, fmtTime, confirmDlg, toast } from './ui.js';

export function setup(ctx) {
  const { bus } = ctx;

  async function renderList(host) {
    const proj = ctx.project();
    if (!proj) {
      host.innerHTML = '<div class="panel-empty">先打开一个项目</div>';
      return;
    }
    host.innerHTML = '<div class="panel-empty">正在读取版本历史…</div>';
    let list;
    try {
      list = await api.listHistory(proj.id);
    } catch {
      host.innerHTML = '<div class="panel-empty">读取失败，请稍后再试</div>';
      return;
    }
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'panel-note';
    head.innerHTML = '<small>每次保存页面源码前，旧版本会自动存到这里（最多 20 条）。</small>';
    host.appendChild(head);
    if (!list.length) {
        host.insertAdjacentHTML('beforeend', '<div class="panel-empty">还没有历史版本</div>');
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'history-list';
    list.forEach((h) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML =
        `<div class="history-time">${esc(fmtTime(h.time))}</div>` +
        `<div class="history-note">${esc(h.note || '')}</div>` +
        `<div class="history-file">${esc(h.file || '')}</div>` +
        `<button class="btn small">恢复此版本</button>`;
      item.querySelector('button').onclick = async () => {
        const ok = await confirmDlg({
          title: '恢复历史版本',
          body: `将用 <b>${esc(fmtTime(h.time))}</b> 的版本覆盖<br><b>${esc(h.file)}</b> 的当前内容。<br>当前内容不会丢失：会自动再存一条历史。`,
          okLabel: '恢复此版本',
        });
        if (!ok) return;
        try {
          await api.restoreHistory(proj.id, h.hid);
          toast('已恢复到该版本，页面重新加载', 'ok');
          await ctx.reloadCurrentPage();
          renderList(host);
        } catch { /* api 已提示 */ }
      };
      wrap.appendChild(item);
    });
    host.appendChild(wrap);
  }

  bus.registerPanel({
    id: 'history',
    title: '历史',
    icon: '↺',
    side: 'left',
    render(host) { renderList(host); },
    onShow() {},
  });
}
