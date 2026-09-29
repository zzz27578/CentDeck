// 一个助手窗口：标题栏（可拖动、停靠 / 弹出）、对话区、输入框（+ 上传与引用、@、技能、模型、思考强度）
import { icon } from '../core/icons.js';
import { el, esc, uid, showMenu } from '../core/ui.js';
import { refLabel, refKey, mentionItems, describeRefs } from './refs.js';

export const THINK = [
  { id: 'off', label: '不思考', hint: '最快最省，适合改字换色' },
  { id: 'low', label: '浅想', hint: '小范围调整' },
  { id: 'mid', label: '适中', hint: '日常推荐' },
  { id: 'high', label: '深想', hint: '改版、复杂交互' },
  { id: 'max', label: '最深', hint: '整体诊断、规划整站' },
];
const ROLES = ['通用', '设计师', '施工员', '审查员'];
const EXAMPLES = ['把首页大标题改得更有冲击力，别超过 12 个字', '让三张功能卡片一样高，间距统一', '按全部红色标记逐条修改', '整体看看哪里不协调，列一份修改清单'];

export function createSession(app, mgr, opts) {
  const s = {
    id: opts.id || uid('ag'), name: opts.name || '助手', role: opts.role || '通用',
    model: localStorage.getItem('cd.model') || 'auto', think: localStorage.getItem('cd.think') || 'mid',
    skill: null, refs: [], msgs: [], root: null,
  };
  const root = el(`<div class="ag">
    <div class="ag-head" data-drag>
      ${icon('sparkle', 16)}<b class="ag-name"></b>
      <button class="ag-role" data-a="role" data-tip="这个助手负责什么（多助手协作用）"></button>
      <span class="grow"></span>
      <button class="icon-btn sm" data-a="new" data-tip="再开一个助手窗口">${icon('plus', 15)}</button>
      <button class="icon-btn sm" data-a="dock" data-tip="停靠到右侧 / 弹出成悬浮窗"></button>
      <button class="icon-btn sm" data-a="settings" data-tip="模型与接口设置">${icon('settings', 15)}</button>
      <button class="icon-btn sm" data-a="clear" data-tip="清空这段对话">${icon('refresh', 14)}</button>
      <button class="icon-btn sm" data-a="close" data-tip="收起" data-kbd="Ctrl+K">${icon('close', 14)}</button>
    </div>
    <div class="ag-msgs"></div>
    <div class="agent-composer">
      <div class="comp-chips"></div>
      <textarea rows="3" placeholder="想改什么？直接说，或者 @ 一个页面、元素、草图标记…&#10;Enter 发送 · Shift+Enter 换行"></textarea>
      <div class="comp-bar">
        <button class="icon-btn sm" data-a="plus" data-tip="上传文件、引用页面或元素">${icon('plus', 18)}</button>
        <button class="icon-btn sm" data-a="at" data-tip="@ 引用页面、元素、标记">${icon('at', 17)}</button>
        <button class="comp-pick" data-a="skill" data-tip="用哪个技能（按 CentDeck 的规则来做）">${icon('book', 14)}<span>技能</span></button>
        <button class="comp-pick" data-a="model" data-tip="选模型">${icon('brain', 14)}<span></span>${icon('chevDown', 12)}</button>
        <button class="comp-pick" data-a="think" data-tip="思考强度：越深越慢也越贵">${icon('sparkle', 14)}<span></span>${icon('chevDown', 12)}</button>
        <span class="grow"></span>
        <button class="comp-send" data-a="send" data-tip="发送" data-kbd="Enter">${icon('send', 17)}</button>
      </div>
      <input type="file" multiple hidden>
    </div></div>`);
  s.root = root;
  const q = (sel) => root.querySelector(sel);
  const ta = q('textarea'), fileIpt = q('input[type=file]');

  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(260, Math.max(76, ta.scrollHeight)) + 'px'; };
  ta.addEventListener('input', grow);
  ta.addEventListener('focus', () => mgr.setActive(s));
  root.addEventListener('pointerdown', () => mgr.setActive(s), true);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); }
  });
  ta.addEventListener('keyup', (e) => { if (e.key === '@') mention(ta); });

  function mention(anchor) {
    showMenu(mentionItems(app, (r) => addRef(r)), 0, 0, { anchor, minWidth: 280 });
  }
  function addRef(r) {
    if (!s.refs.some((x) => refKey(x) === refKey(r))) s.refs.push({ id: uid('rf'), ...r });
    paintChips();
    focus();
  }
  function paintChips() {
    const host = q('.comp-chips');
    host.innerHTML = '';
    const all = [...(s.skill ? [{ kind: 'skill', id: 'skill' }] : []), ...s.refs];
    host.hidden = !all.length;
    all.forEach((r) => {
      const sk = r.kind === 'skill' ? mgr.skill(s.skill) : null;
      const lb = sk ? { icon: sk.icon, text: '技能：' + sk.name } : refLabel(r);
      const chip = el(`<span class="comp-chip ${sk ? 'skill' : 'ctx'}" title="${esc(lb.text)}">${r.url ? `<img src="${r.url}" alt="">` : icon(lb.icon, 13)}<span>${esc(lb.text)}</span>${lb.color ? `<i class="cc-dot" style="background:${lb.color}"></i>` : ''}<button data-tip="移除">${icon('close', 11)}</button></span>`);
      chip.querySelector('button').onclick = () => { if (sk) s.skill = null; else s.refs = s.refs.filter((x) => x.id !== r.id); paintChips(); };
      host.appendChild(chip);
    });
  }
  function paintPickers() {
    q('[data-a=model] span').textContent = mgr.modelLabel(s.model);
    q('[data-a=think] span').textContent = (THINK.find((t) => t.id === s.think) || THINK[2]).label;
    q('.ag-name').textContent = s.name;
    q('[data-a=role]').textContent = s.role;
    const dk = q('[data-a=dock]');
    dk.innerHTML = icon(mgr.isDocked(s) ? 'undock' : 'dock', 15);
    dk.setAttribute('data-tip', mgr.isDocked(s) ? '弹出成悬浮窗（也可以直接拖标题栏）' : '停靠到右侧');
  }
  function paintMsgs() {
    const host = q('.ag-msgs');
    host.innerHTML = '';
    if (!s.msgs.length) {
      const empty = el(`<div class="agent-empty"><div class="ae-mark">${icon('sparkle', 26)}</div><h3>想改哪里，直接说</h3>
        <p>小改动（改字、挪位置、换颜色）在页面上自己动手就行，不花钱；说不清的、要动结构的交给我。可以用 @ 或右键把页面、元素、标记指给我。</p><div class="ae-examples"></div></div>`);
      EXAMPLES.forEach((t) => { const b = el(`<button>${esc(t)}</button>`); b.onclick = () => { ta.value = t; grow(); focus(); }; empty.querySelector('.ae-examples').appendChild(b); });
      host.appendChild(empty);
      return;
    }
    s.msgs.forEach((m) => { const b = el(`<div class="msg ${m.role}"><div class="msg-body"></div></div>`); b.firstChild.innerHTML = m.html; host.appendChild(b); });
    host.scrollTop = host.scrollHeight;
  }
  function send() {
    const text = ta.value.trim();
    if (!text && !s.refs.length) return;
    const chips = s.refs.map((r) => `<span class="chip">${esc(refLabel(r).text)}</span>`).join(' ');
    const sk = s.skill && mgr.skill(s.skill);
    s.msgs.push({ role: 'user', html: `${esc(text).replace(/\n/g, '<br>')}${chips || sk ? `<div class="msg-chips">${sk ? `<span class="chip">技能：${esc(sk.name)}</span>` : ''}${chips}</div>` : ''}` });
    const refs = describeRefs(app, s.refs);
    s.msgs.push({ role: 'sys', html: `<b>还没接入模型</b>（第二步接入）。接入后会用 <b>${esc(mgr.modelLabel(s.model))}</b> · 思考「${esc((THINK.find((t) => t.id === s.think) || {}).label || '')}」${sk ? ` · 技能「${esc(sk.name)}」` : ''}发送，并附上《页面写法规范》${refs.length ? '和这些引用对应的代码片段：<br>· ' + refs.map(esc).join('<br>· ') : '。'}<br>现在可以先把要求写进草图标记，再从任务单复制给任意 AI。` });
    ta.value = '';
    grow();
    s.refs = [];
    paintChips();
    paintMsgs();
  }
  function focus() { setTimeout(() => ta.focus(), 40); }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'send') send();
    if (a === 'close') mgr.close(s);
    if (a === 'new') mgr.newWindow();
    if (a === 'dock') mgr.toggleDock(s);
    if (a === 'settings') app.openSettings();
    if (a === 'clear') { s.msgs = []; s.refs = []; paintChips(); paintMsgs(); }
    if (a === 'at') mention(b);
    if (a === 'role') showMenu(ROLES.map((r) => ({ label: r, checked: r === s.role, onClick: () => { s.role = r; paintPickers(); } })), 0, 0, { anchor: b, minWidth: 150 });
    if (a === 'think') showMenu([{ title: '思考强度' }, ...THINK.map((t) => ({ label: t.label, hint: t.hint, checked: t.id === s.think, onClick: () => { s.think = t.id; localStorage.setItem('cd.think', t.id); paintPickers(); } }))], 0, 0, { anchor: b, minWidth: 220 });
    if (a === 'model') mgr.modelMenu(b, s.model, (id) => { s.model = id; localStorage.setItem('cd.model', id); paintPickers(); });
    if (a === 'skill') showMenu([{ title: '技能：让 AI 按 CentDeck 的规则来做' }, ...mgr.skills().map((k) => ({ label: k.name, hint: k.desc, icon: k.icon, checked: s.skill === k.id, onClick: () => { s.skill = s.skill === k.id ? null : k.id; paintChips(); focus(); } }))], 0, 0, { anchor: b, minWidth: 300 });
    if (a === 'plus') {
      const info = app.view() === 'edit' && app.editor.selection;
      showMenu([
        { label: '上传文件或图片', icon: 'upload', hint: '参考图、截图、文档都可以', onClick: () => fileIpt.click() },
        { label: '引用当前页面', icon: 'file', disabled: !app.state.page, onClick: () => addRef({ kind: 'page', page: app.state.page, title: (app.project().pages.find((p) => p.file === app.state.page) || {}).title || app.state.page }) },
        { label: info ? `引用选中元素 ${app.editor.describe(info)}` : '引用选中元素（先在编辑里选一个）', icon: 'target', disabled: !info, onClick: () => addRef({ kind: 'element', page: app.state.page, selector: info.selector, line: info.line, title: app.editor.describe(info) }) },
        { label: '@ 更多（页面、标记编号、颜色）…', icon: 'at', onClick: () => mention(b) },
      ], 0, 0, { anchor: b, minWidth: 290 });
    }
  });
  fileIpt.onchange = () => {
    [...fileIpt.files].forEach((f) => addRef({ kind: 'file', name: f.name, size: f.size, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null }));
    fileIpt.value = '';
  };
  root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('drop'); } });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
  root.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    root.classList.remove('drop');
    [...e.dataTransfer.files].forEach((f) => addRef({ kind: 'file', name: f.name, size: f.size, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null }));
  });

  Object.assign(s, {
    addRef, focus, paintPickers,
    prefill(text, o = {}) { ta.value = text; grow(); if (o.skill) s.skill = o.skill; paintChips(); focus(); },
    reset() { s.msgs = []; s.refs = []; s.skill = null; paintChips(); paintMsgs(); },
    blur() { if (root.contains(document.activeElement)) document.activeElement.blur(); },
  });
  paintPickers();
  paintChips();
  paintMsgs();
  return s;
}
