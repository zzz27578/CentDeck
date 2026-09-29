// 快捷键中心：所有快捷键在这里登记；带 id 的可以在"快捷键"面板里改键（存在浏览器里），
// 撤销、删除、方向键这类基础键固定不可改。页面 iframe 里的按键也转发到这里。
import { openModal, esc, toast, closeMenu } from './ui.js';

const bindings = [];   // { id, combo, label, group, when, run, field, priority, hidden, fixed }
const defs = new Map(); // id → { combos, opts }
const listeners = new Set();
let spaceDown = false, capturing = null;
const KEYMAP = 'cd.keymap';
let userMap = {};
try { userMap = JSON.parse(localStorage.getItem(KEYMAP)) || {}; } catch { userMap = {}; }

const NAMES = { ' ': 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Del' };
export function comboOf(e) {
  let k = e.key;
  if (!k || k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Process') return '';
  k = NAMES[k] || (k.length === 1 ? k.toUpperCase() : k);
  if (e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
  if (e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);            // 中文输入法下也按物理键认
  if (e.code === 'Equal' || e.code === 'NumpadAdd') k = '+';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') k = '-';
  if (e.code === 'Slash' && e.shiftKey) k = '?';
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey && k !== '?') mods.push('Shift');
  return [...mods, k].join('+');
}

export function inField(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') return !/^(checkbox|radio|range|button|submit|color|file)$/i.test(t.type);
  return false;
}

const sortAll = () => bindings.sort((a, b) => b.priority - a.priority);
function push(combos, opts) {
  combos.forEach((c, i) => bindings.push({ priority: 0, group: '通用', ...opts, combo: c, hidden: opts.hidden || i > 0 }));
}
// opts.id 表示可改键；不带 id 的是固定键
export function bindKey(combo, opts) {
  const combos = Array.isArray(combo) ? combo : [combo];
  if (opts.id) defs.set(opts.id, { combos, opts });
  push(opts.id && userMap[opts.id] ? [userMap[opts.id]] : combos, { ...opts, fixed: !opts.id });
  sortAll();
}
export function comboFor(id, fallback = '') {
  const b = bindings.find((x) => x.id === id && !x.hidden);
  return b ? b.combo : fallback;
}
export function onKeymapChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function remap(id, combo) {
  const d = defs.get(id);
  if (!d) return;
  for (let i = bindings.length - 1; i >= 0; i--) if (bindings[i].id === id) bindings.splice(i, 1);
  if (combo) userMap[id] = combo; else delete userMap[id];
  localStorage.setItem(KEYMAP, JSON.stringify(userMap));
  push(combo ? [combo] : d.combos, { ...d.opts, fixed: false });
  sortAll();
  [...listeners].forEach((fn) => fn());
}

export function handleKey(e) {
  if (e.key === ' ' && !inField(e.target)) spaceDown = e.type === 'keydown';
  if (e.type !== 'keydown') return false;
  if (capturing) { e.preventDefault(); e.stopPropagation(); capturing(e); return true; }
  const combo = comboOf(e);
  if (!combo) return false;
  const typing = inField(e.target);
  for (const b of bindings) {
    if (b.combo !== combo) continue;
    if (typing && !b.field) continue;
    if (b.when && !b.when(e)) continue;
    if (b.run(e) === false) continue;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }
  return false;
}
export const isSpaceDown = () => spaceDown;

export function attachDoc(doc) {
  if (!doc || doc.__cdKeys) return;
  Object.defineProperty(doc, '__cdKeys', { value: true });
  doc.addEventListener('keydown', handleKey, true);
  doc.addEventListener('keyup', handleKey, true);
  if (doc !== document) doc.addEventListener('pointerdown', () => closeMenu(), true);
}
attachDoc(document);
window.addEventListener('blur', () => { spaceDown = false; });

// ---------- 快捷键面板：可改的点一下按新键，固定的带锁 ----------
const EXTRA = {
  '编辑': [['拖动元素', '按住拖'], ['拖动时暂停吸附', 'Alt'], ['拖动时只走横 / 竖', 'Shift'], ['角点等比缩放 / 边线改宽高', '拖手柄'], ['改字', '双击文字']],
  '视图': [['缩放画面', 'Ctrl+滚轮'], ['平移画面', '空格+拖 / 中键拖'], ['滚动网页', '滚轮']],
};
export function showKeyHelp() {
  const box = document.createElement('div');
  const paint = () => {
    const groups = new Map();
    bindings.filter((b) => !b.hidden && b.label).forEach((b) => {
      if (!groups.has(b.group)) groups.set(b.group, new Map());
      const g = groups.get(b.group);
      const key = b.id || b.label;
      if (!g.has(key)) g.set(key, { b, combos: [] });
      if (!g.get(key).combos.includes(b.combo)) g.get(key).combos.push(b.combo);
    });
    let html = '<p class="hint" style="margin-bottom:10px">点一下带下划线的按键就能改成你顺手的键；带锁的是基础键，不能改。改动只保存在这台电脑的浏览器里。</p><div class="keyhelp">';
    new Set([...groups.keys(), ...Object.keys(EXTRA)]).forEach((name) => {
      html += `<section><h4>${esc(name)}</h4>`;
      (groups.get(name) || new Map()).forEach(({ b, combos }) => {
        const custom = b.id && userMap[b.id];
        html += `<div class="kh-row"><span>${esc(b.label)}</span><span>${b.fixed
          ? combos.map((c) => `<kbd>${esc(c)}</kbd>`).join(' ') + ' <i class="kh-lock" title="基础键，不能改">🔒</i>'
          : `<button class="kh-key" data-id="${esc(b.id)}">${esc(combos[0])}</button>${custom ? `<button class="kh-reset" data-reset="${esc(b.id)}" title="恢复默认">↺</button>` : ''}`}</span></div>`;
      });
      (EXTRA[name] || []).forEach(([l, k]) => { html += `<div class="kh-row"><span>${esc(l)}</span><span><kbd>${esc(k)}</kbd></span></div>`; });
      html += '</section>';
    });
    box.innerHTML = html + '</div>';
    box.querySelectorAll('[data-reset]').forEach((r) => { r.onclick = () => { remap(r.dataset.reset, null); paint(); }; });
    box.querySelectorAll('.kh-key').forEach((k) => {
      k.onclick = () => {
        box.querySelectorAll('.kh-key.wait').forEach((x) => x.classList.remove('wait'));
        k.classList.add('wait');
        k.textContent = '按下新按键…';
        capturing = (e) => {
          const c = comboOf(e);
          if (!c) return;
          capturing = null;
          if (c === 'Esc') { paint(); return; }
          const fixed = bindings.find((x) => x.fixed && x.combo === c);
          if (fixed) { toast(`${c} 是基础键（${fixed.label || '系统'}），换一个吧`, 'err'); paint(); return; }
          const me = defs.get(k.dataset.id);
          const other = bindings.find((x) => x.id && x.id !== k.dataset.id && x.combo === c && x.group === me.opts.group);
          if (other) { remap(other.id, comboFor(k.dataset.id)); toast(`已和「${other.label}」互换按键`); }
          remap(k.dataset.id, c);
          paint();
        };
      };
    });
  };
  paint();
  openModal({ title: '快捷键', body: box, width: 760, actions: [{ label: '全部恢复默认', onClick: () => { [...defs.keys()].forEach((id) => { if (userMap[id]) remap(id, null); }); paint(); } }, { label: '完成', kind: 'primary' }], onClose: () => { capturing = null; } });
}
