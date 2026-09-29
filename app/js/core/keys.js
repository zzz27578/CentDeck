// 快捷键中心：所有快捷键在这里登记，同一张表生成"?"帮助面板；
// 页面 iframe 里的按键也转发到这里（editor 调用 attachDoc）。
import { openModal, esc } from './ui.js';

const bindings = [];   // { combo, label, group, when, run, field, priority, hidden }
let spaceDown = false;

const NAMES = { ' ': 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Del' };
export function comboOf(e) {
  let k = e.key;
  if (!k || k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return '';
  k = NAMES[k] || (k.length === 1 ? k.toUpperCase() : k);
  if (e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);        // Shift+1 等不受键盘布局影响
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

// combo 可以是数组（同一动作多个按键）
export function bindKey(combo, opts) {
  (Array.isArray(combo) ? combo : [combo]).forEach((c, i) => {
    bindings.push({ priority: 0, group: '通用', ...opts, combo: c, hidden: opts.hidden || i > 0 });
  });
  bindings.sort((a, b) => b.priority - a.priority);
}

export function handleKey(e) {
  if (e.key === ' ' && !inField(e.target)) spaceDown = e.type === 'keydown';
  if (e.type !== 'keydown') return false;
  const combo = comboOf(e);
  if (!combo) return false;
  const typing = inField(e.target);
  for (const b of bindings) {
    if (b.combo !== combo) continue;
    if (typing && !b.field) continue;
    if (b.when && !b.when(e)) continue;
    const r = b.run(e);
    if (r === false) continue;           // 返回 false 表示"我不处理"，继续找下一个
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
}
attachDoc(document);
window.addEventListener('blur', () => { spaceDown = false; });

export function showKeyHelp() {
  const groups = new Map();
  bindings.filter((b) => !b.hidden && b.label).forEach((b) => {
    if (!groups.has(b.group)) groups.set(b.group, new Map());
    const g = groups.get(b.group);
    if (!g.has(b.label)) g.set(b.label, []);
    if (!g.get(b.label).includes(b.combo)) g.get(b.label).push(b.combo);
  });
  const extra = {
    '编辑': [['拖动元素', '按住拖'], ['拖动时暂停吸附', 'Alt'], ['拖动时只走横/竖', 'Shift'], ['角点等比缩放 / 边线改宽高', '拖手柄'], ['改字', '双击文字']],
    '视图': [['缩放', 'Ctrl+滚轮'], ['平移画面', '空格+拖 / 中键拖'], ['滚动网页', '滚轮']],
  };
  let html = '<div class="keyhelp">';
  const all = new Set([...groups.keys(), ...Object.keys(extra)]);
  all.forEach((name) => {
    html += `<section><h4>${esc(name)}</h4>`;
    (groups.get(name) || new Map()).forEach((combos, label) => {
      html += `<div class="kh-row"><span>${esc(label)}</span><span>${combos.map((c) => `<kbd>${esc(c)}</kbd>`).join(' ')}</span></div>`;
    });
    (extra[name] || []).forEach(([label, k]) => { html += `<div class="kh-row"><span>${esc(label)}</span><span><kbd>${esc(k)}</kbd></span></div>`; });
    html += '</section>';
  });
  html += '</div>';
  openModal({ title: '快捷键', body: html, width: 720, actions: [] });
}
