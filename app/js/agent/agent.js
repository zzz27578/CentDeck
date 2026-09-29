// 助手对话框（骨架）：右侧可召唤（Ctrl+K）、可拖宽；大输入框 + 左下角"+"上传 + 模型 + 思考强度。
// 第一步不接模型：发送后只在对话里记下来，并说明第二步会怎么发。
import { icon } from '../core/icons.js';
import { el, esc, uid, showMenu, toast } from '../core/ui.js';

const MODELS = [
  { title: '推荐' },
  { id: 'auto', label: '自动分档', hint: '按任务大小选：小改用经济档，设计规划用专家档' },
  { title: '经济档（便宜、快）' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'deepseek', label: 'DeepSeek', hint: '待接入' },
  { id: 'qwen', label: '通义千问', hint: '待接入' },
  { title: '专家档（能力强）' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'gpt', label: 'GPT（OpenAI）', hint: '待接入' },
  { id: 'gemini', label: 'Gemini（Google）', hint: '待接入' },
  { title: '其它' },
  { id: 'local', label: '本地模型（Ollama 等）', hint: '免费，能力较弱' },
];
const THINK = [
  { id: 'off', label: '不思考', hint: '最快最省，适合改字换色' },
  { id: 'low', label: '浅想', hint: '小范围调整' },
  { id: 'mid', label: '适中', hint: '日常推荐' },
  { id: 'high', label: '深想', hint: '改版、复杂交互' },
  { id: 'max', label: '最深', hint: '整体诊断、规划整站' },
];
const EXAMPLES = ['把首页大标题改得更有冲击力，别超过 12 个字', '让三张功能卡片一样高，间距统一', '给价格页加一个"常见问题"版块', '整体看看哪里不协调，列一份修改清单'];

export function createAgent(app) {
  let box = null, open = localStorage.getItem('cd.agentOpen') === '1';
  let width = +localStorage.getItem('cd.agentW') || 400;
  let model = localStorage.getItem('cd.model') || 'auto', think = localStorage.getItem('cd.think') || 'mid';
  let atts = [], ctxChips = [], msgs = [];
  const labelOf = (list, id) => (list.find((x) => x.id === id) || {}).label || id;

  function mount(host) {
    box = host;
    box.style.setProperty('--agent-w', width + 'px');
    box.innerHTML = `<div class="agent-inner">
      <div class="agent-resize" data-tip="拖动改宽度" data-tip-place="left"></div>
      <div class="agent-head">${icon('sparkle', 17)}<b>助手</b><span class="chip">第二步接入模型</span><span class="grow"></span>
        <button class="icon-btn sm" data-a="new" data-tip="新对话">${icon('plus', 16)}</button>
        <button class="icon-btn sm" data-a="close" data-tip="收起" data-kbd="Ctrl+K">${icon('close', 15)}</button></div>
      <div class="agent-msgs"></div>
      <div class="agent-composer">
        <div class="comp-chips"></div>
        <textarea rows="3" placeholder="想改什么？直接说，或者 @ 一个元素、页面、模型…\nEnter 发送 · Shift+Enter 换行"></textarea>
        <div class="comp-bar">
          <button class="icon-btn sm" data-a="plus" data-tip="添加文件、图片或引用">${icon('plus', 18)}</button>
          <button class="comp-pick" data-a="model" data-tip="选模型">${icon('brain', 14)}<span></span>${icon('chevDown', 12)}</button>
          <button class="comp-pick" data-a="think" data-tip="思考强度：越深越慢也越贵">${icon('sparkle', 14)}<span></span>${icon('chevDown', 12)}</button>
          <span class="grow"></span>
          <button class="comp-send" data-a="send" data-tip="发送" data-kbd="Enter">${icon('send', 17)}</button>
        </div>
        <input type="file" multiple hidden>
      </div></div>`;
    const q = (s) => box.querySelector(s);
    const ta = q('textarea'), fileIpt = q('input[type=file]');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(260, Math.max(76, ta.scrollHeight)) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); }
    });
    ta.addEventListener('keyup', (e) => { if (e.key === '@') mentionMenu(ta); });
    q('[data-a=send]').onclick = send;
    q('[data-a=close]').onclick = () => toggle(false);
    q('[data-a=new]').onclick = () => { msgs = []; atts = []; ctxChips = []; renderMsgs(); renderChips(); };
    q('[data-a=model]').onclick = (e) => showMenu(MODELS.map((m) => (m.title ? m : { label: m.label, hint: m.hint, checked: m.id === model, onClick: () => { model = m.id; localStorage.setItem('cd.model', model); syncPickers(); } })), 0, 0, { anchor: e.currentTarget, minWidth: 260 });
    q('[data-a=think]').onclick = (e) => showMenu([{ title: '思考强度' }, ...THINK.map((t) => ({ label: t.label, hint: t.hint, checked: t.id === think, onClick: () => { think = t.id; localStorage.setItem('cd.think', think); syncPickers(); } }))], 0, 0, { anchor: e.currentTarget, minWidth: 220 });
    q('[data-a=plus]').onclick = (e) => {
      const info = app.view() === 'edit' && app.editor.selection;
      showMenu([
        { label: '上传文件或图片', icon: 'upload', hint: '参考图、截图、文档都可以', onClick: () => fileIpt.click() },
        { label: info ? `引用选中元素 ${app.editor.describe(info)}` : '引用选中元素（先在编辑里选一个）', icon: 'target', disabled: !info, onClick: () => addCtx({ kind: 'element', label: app.editor.describe(info), data: { page: app.state.page, selector: info.selector, line: info.line } }) },
        { label: '引用当前页面', icon: 'file', disabled: !app.state.page, onClick: () => addCtx({ kind: 'page', label: pageTitle(app.state.page), data: { page: app.state.page } }) },
        { label: '引用全部草图标记', icon: 'marks', onClick: () => addCtx({ kind: 'marks', label: `${(app.project().marks || []).filter((m) => !m.done).length} 条草图标记` }) },
      ], 0, 0, { anchor: e.currentTarget, minWidth: 280 });
    };
    fileIpt.onchange = () => { [...fileIpt.files].forEach(addFile); fileIpt.value = ''; };
    box.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drop'); });
    box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drop'); [...(e.dataTransfer.files || [])].forEach(addFile); });
    q('.agent-resize').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const sx = e.clientX, w0 = width;
      box.classList.add('resizing');
      const mv = (ev) => { width = Math.max(320, Math.min(720, w0 + sx - ev.clientX)); box.style.setProperty('--agent-w', width + 'px'); };
      const up = () => { box.classList.remove('resizing'); localStorage.setItem('cd.agentW', width); window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); };
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', up, true);
    });
    syncPickers();
    renderMsgs();
    renderChips();
    setOpen(open, false);
  }
  const pageTitle = (f) => ((app.project().pages.find((p) => p.file === f) || {}).title || f);

  function syncPickers() {
    if (!box) return;
    box.querySelector('[data-a=model] span').textContent = labelOf(MODELS, model);
    box.querySelector('[data-a=think] span').textContent = labelOf(THINK, think);
  }
  function addCtx(c) { if (!ctxChips.some((x) => x.label === c.label)) ctxChips.push({ id: uid('c'), ...c }); renderChips(); focus(); }
  function addFile(f) {
    const a = { id: uid('f'), name: f.name, size: f.size, type: f.type, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null };
    atts.push(a);
    renderChips();
  }
  function renderChips() {
    if (!box) return;
    const host = box.querySelector('.comp-chips');
    host.innerHTML = '';
    const all = [...ctxChips.map((c) => ({ ...c, ctx: true })), ...atts];
    host.hidden = !all.length;
    all.forEach((c) => {
      const chip = el(`<span class="comp-chip ${c.ctx ? 'ctx' : ''}">${c.url ? `<img src="${c.url}" alt="">` : icon(c.ctx ? (c.kind === 'element' ? 'target' : c.kind === 'marks' ? 'marks' : 'file') : 'paperclip', 13)}
        <span>${esc(c.ctx ? c.label : c.name)}</span>${c.size ? `<small>${Math.max(1, Math.round(c.size / 1024))}KB</small>` : ''}<button data-tip="移除">${icon('close', 11)}</button></span>`);
      chip.querySelector('button').onclick = () => { ctxChips = ctxChips.filter((x) => x.id !== c.id); atts = atts.filter((x) => x.id !== c.id); renderChips(); };
      host.appendChild(chip);
    });
  }
  function renderMsgs() {
    if (!box) return;
    const host = box.querySelector('.agent-msgs');
    host.innerHTML = '';
    if (!msgs.length) {
      const empty = el(`<div class="agent-empty"><div class="ae-mark">${icon('sparkle', 26)}</div><h3>想改哪里，直接说</h3>
        <p>小改动（改字、挪位置、换颜色）自己在页面上动手就行，不花钱；说不清的、要动结构的交给我。</p><div class="ae-examples"></div></div>`);
      EXAMPLES.forEach((t) => { const b = el(`<button>${esc(t)}</button>`); b.onclick = () => { const ta = box.querySelector('textarea'); ta.value = t; ta.dispatchEvent(new Event('input')); focus(); }; empty.querySelector('.ae-examples').appendChild(b); });
      host.appendChild(empty);
      return;
    }
    msgs.forEach((m) => {
      const b = el(`<div class="msg ${m.role}"><div class="msg-body"></div></div>`);
      b.querySelector('.msg-body').innerHTML = m.html;
      host.appendChild(b);
    });
    host.scrollTop = host.scrollHeight;
  }
  function send() {
    const ta = box.querySelector('textarea');
    const text = ta.value.trim();
    if (!text && !atts.length) return;
    const chips = [...ctxChips, ...atts].map((c) => `<span class="chip">${esc(c.label || c.name)}</span>`).join(' ');
    msgs.push({ role: 'user', html: `${esc(text).replace(/\n/g, '<br>')}${chips ? `<div class="msg-chips">${chips}</div>` : ''}` });
    msgs.push({ role: 'sys', html: `<b>还没接入模型</b>（第二步）。接入后，这句话会连同${ctxChips.length ? '你引用的元素、代码行' : '当前页面的相关片段'}一起，用 <b>${esc(labelOf(MODELS, model))}</b> · 思考「${esc(labelOf(THINK, think))}」发送。<br>现在可以先用草图标记写下要求，再从任务单复制给任意 AI。` });
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    atts = []; ctxChips = [];
    renderChips();
    renderMsgs();
  }
  function mentionMenu(ta) {
    const info = app.view() === 'edit' && app.editor.selection;
    const insert = (t) => { const i = ta.selectionStart; ta.value = ta.value.slice(0, i) + t + ' ' + ta.value.slice(i); ta.focus(); ta.selectionStart = ta.selectionEnd = i + t.length + 1; };
    showMenu([
      { title: '@ 指定对象' },
      info ? { label: '选中的元素', hint: app.editor.describe(info), icon: 'target', onClick: () => { insert('选中元素'); addCtx({ kind: 'element', label: app.editor.describe(info), data: { selector: info.selector } }); } } : null,
      ...app.project().pages.map((p) => ({ label: p.title, hint: p.file, icon: 'file', onClick: () => { insert(p.title); addCtx({ kind: 'page', label: p.title, data: { page: p.file } }); } })),
      '-',
      { label: '经济档', icon: 'brain', onClick: () => insert('经济档') },
      { label: '专家档', icon: 'brain', onClick: () => insert('专家档') },
    ], 0, 0, { anchor: ta, minWidth: 240 });
  }
  function focus() { const ta = box && box.querySelector('textarea'); if (ta) setTimeout(() => ta.focus(), 60); }
  function setOpen(v, save = true) {
    open = v;
    if (box) box.classList.toggle('open', v);
    const b = document.getElementById('tb-agent');
    if (b) b.classList.toggle('on', v);
    if (save) localStorage.setItem('cd.agentOpen', v ? '1' : '0');
    if (v) focus();
    else if (box && box.contains(document.activeElement)) document.activeElement.blur();
  }
  function toggle(force) { setOpen(force == null ? !open : !!force); }
  app.bus.on('project', () => { msgs = []; atts = []; ctxChips = []; });
  function prefill(text) {
    setOpen(true);
    const ta = box && box.querySelector('textarea');
    if (ta) { ta.value = text; ta.dispatchEvent(new Event('input')); }
  }
  return { mount, toggle, addCtx, prefill };
}
