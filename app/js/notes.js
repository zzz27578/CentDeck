// notes.js —— 内置插件：便签
// 选中元素后"加便签"：类型二选一（一次性任务 / 长期规则）；
// 面板分两个页签列出全部便签，可勾选完成/删除；长期规则用不同颜色钉子图标显示。
// 存 project.json.notes（AI 读取规则是第二步的事，本步只存与展示）。

import { el, esc, uid, toast, openModal, confirmDlg } from './ui.js';

export function setup(ctx) {
  const { bus } = ctx;

  function notes() {
    const p = ctx.project();
    if (!p) return [];
    if (!Array.isArray(p.notes)) p.notes = [];
    return p.notes;
  }

  // ---------- 加便签（属性面板"加便签"按钮经命令总线调用） ----------
  bus.registerCommand('notes.addForSelection', async (c) => {
    const info = c.editor.selection;
    if (!info || info.generated) {
      toast('先选中一个源码里存在的元素，再加便签', 'err');
      return;
    }
    const proj = c.project();
    const page = c.editor.page;
    const pageTitle = (proj.pages.find((p) => p.file === page) || {}).title || page;
    let kind = 'task';
    const body = el(`<div class="note-form">
      <div class="form-row">
        <label>便签类型</label>
        <div class="seg kind-seg">
          <button data-k="task" class="on">一次性任务<br><small>改完打勾就收起来</small></button>
          <button data-k="rule">长期规则<br><small>一直有效，比如"保持简洁"</small></button>
        </div>
      </div>
      <div class="form-row">
        <label>内容</label>
        <textarea rows="3" placeholder="例如：这个按钮的字改成「立即体验」"></textarea>
      </div>
      <div class="form-hint">贴在：${esc(c.editor.describe(info))} · ${esc(pageTitle)}</div>
    </div>`);
    body.querySelectorAll('.kind-seg button').forEach((b) => {
      b.onclick = () => {
        kind = b.dataset.k;
        body.querySelectorAll('.kind-seg button').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    const ta = body.querySelector('textarea');
    openModal({
      title: '加便签',
      width: 460,
      body,
      actions: [
        { label: '取消' },
        {
          label: '贴上去', kind: 'primary', onClick: async (close) => {
            const text = ta.value.trim();
            if (!text) { toast('写点内容再贴', 'err'); return; }
            const note = {
              id: uid('nt'), page, selector: info.selector,
              kind, text, done: false, createdAt: new Date().toISOString(),
            };
            const list = notes();
            await bus.doMeta({
              label: kind === 'rule' ? '新增长期规则便签' : '新增任务便签',
              apply: () => { list.push(note); },
              revert: () => { const i = list.indexOf(note); if (i >= 0) list.splice(i, 1); },
            });
            bus.emit('notes');
            toast(kind === 'rule' ? '长期规则已贴上（蓝色钉子）' : '任务便签已贴上', 'ok');
            close();
          },
        },
      ],
    });
    setTimeout(() => ta.focus(), 30);
  });

  // ---------- 面板 ----------
  let curTab = 'all'; // all | task | rule
  bus.registerPanel({
    id: 'notes',
    title: '便签',
    icon: '🗒️',
    side: 'left',
    render(host) {
      const proj = ctx.project();
      if (!proj) { host.innerHTML = '<div class="panel-empty">先打开一个项目</div>'; return; }
      const paint = () => {
        const list = notes();
        host.innerHTML = '';
        const tabs = el(`<div class="seg note-tabs">
          <button data-t="all" class="${curTab === 'all' ? 'on' : ''}">全部（${list.length}）</button>
          <button data-t="task" class="${curTab === 'task' ? 'on' : ''}">任务（${list.filter((n) => n.kind === 'task').length}）</button>
          <button data-t="rule" class="${curTab === 'rule' ? 'on' : ''}">长期规则（${list.filter((n) => n.kind === 'rule').length}）</button>
        </div>`);
        tabs.querySelectorAll('button').forEach((b) => {
          b.onclick = () => { curTab = b.dataset.t; paint(); };
        });
        host.appendChild(tabs);
        host.insertAdjacentHTML('beforeend',
          '<div class="panel-note"><small>在编辑视图选中元素 → 右侧"加便签"。长期规则以后会被 AI 读取（第二步）。</small></div>');
        const shown = list.filter((n) => curTab === 'all' || n.kind === curTab);
        if (!shown.length) {
          host.insertAdjacentHTML('beforeend', '<div class="panel-empty">这一类还没有便签</div>');
          return;
        }
        const wrap = el('<div class="note-list"></div>');
        shown.forEach((n) => {
          const pageTitle = (proj.pages.find((p) => p.file === n.page) || {}).title || n.page;
          const item = el(`<div class="note-item ${n.done ? 'done' : ''}">
            <span class="note-pin ${n.kind}" title="${n.kind === 'rule' ? '长期规则' : '一次性任务'}">${n.kind === 'rule' ? '📍' : '📌'}</span>
            <div class="note-main">
              <div class="note-meta">${esc(pageTitle)} · ${esc(shortSel(n.selector))}</div>
              <div class="note-text">${esc(n.text)}</div>
            </div>
            <label class="note-check" title="完成"><input type="checkbox" ${n.done ? 'checked' : ''}></label>
            <button class="note-del" title="删除">×</button>
          </div>`);
          item.querySelector('input').onchange = async (e) => {
            const v = e.target.checked;
            await bus.doMeta({
              label: v ? '便签打勾完成' : '取消便签完成',
              apply: () => { n.done = v; },
              revert: () => { n.done = !v; },
            });
            item.classList.toggle('done', v);
          };
          item.querySelector('.note-del').onclick = async () => {
            const ok = await confirmDlg({ title: '删除便签', body: '确定删除这条便签吗？', okLabel: '删除', danger: true });
            if (!ok) return;
            const i = list.indexOf(n);
            await bus.doMeta({
              label: '删除便签',
              apply: () => { const j = list.indexOf(n); if (j >= 0) list.splice(j, 1); },
              revert: () => { list.splice(Math.min(i, list.length), 0, n); },
            });
            paint();
          };
          wrap.appendChild(item);
        });
        host.appendChild(wrap);
      };
      paint();
      this._off = bus.on('notes', () => { if (host.isConnected) paint(); });
    },
    onHide() { if (this._off) this._off(); },
  });

  function shortSel(sel) {
    if (!sel) return '';
    const last = sel.split(' > ').pop();
    return last.replace(/:nth-of-type\((\d+)\)/, '[$1]');
  }
}
