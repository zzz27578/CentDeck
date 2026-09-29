// 通用界面零件：转义、提示条、对话框、菜单（右键/下拉）、悬停提示
import { icon } from './icons.js';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const uid = (p = 'x') => p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = el('<textarea style="position:fixed;left:-9999px"></textarea>');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* 忽略 */ }
    ta.remove(); return ok;
  }
}

// ---------- 提示条 ----------
let toastHost = null;
export function toast(message, type = '', timeout = 2600) {
  if (!toastHost || !toastHost.isConnected) { toastHost = el('<div class="toast-host"></div>'); document.body.appendChild(toastHost); }
  const ico = type === 'ok' ? icon('check', 16) : type === 'err' ? icon('info', 16) : '';
  const item = el(`<div class="toast ${type}">${ico}<span>${esc(message)}</span></div>`);
  toastHost.appendChild(item);
  requestAnimationFrame(() => item.classList.add('show'));
  const kill = () => { item.classList.remove('show'); setTimeout(() => item.remove(), 260); };
  item.onclick = kill;
  if (timeout > 0) setTimeout(kill, timeout);
  while (toastHost.children.length > 4) toastHost.firstElementChild.remove();
  return kill;
}
export const toastError = (e) => toast(e && e.message ? e.message : String(e || '出错了'), 'err', 4200);

// ---------- 对话框 ----------
const modalStack = [];
export function openModal({ title = '', body = '', actions, width, onClose, className = '' }) {
  const wrap = el(`<div class="modal-mask"><div class="modal ${className}" role="dialog" style="${width ? `width:${width}px` : ''}">
    <div class="modal-head"><div class="modal-title">${esc(title)}</div><button class="icon-btn modal-x" data-tip="关闭" data-kbd="Esc">${icon('close', 16)}</button></div>
    <div class="modal-body"></div><div class="modal-foot"></div></div></div>`);
  const dlg = wrap.firstElementChild;
  const bodyEl = dlg.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const entry = {};
  const close = (result) => {
    const i = modalStack.indexOf(entry);
    if (i < 0) return;
    modalStack.splice(i, 1);
    wrap.classList.remove('show');
    setTimeout(() => wrap.remove(), 180);
    if (onClose) onClose(result);
  };
  entry.close = close;
  const foot = dlg.querySelector('.modal-foot');
  (actions || [{ label: '关闭' }]).forEach((a) => {
    const b = el(`<button class="btn ${a.kind || ''}">${esc(a.label)}</button>`);
    b.onclick = () => (a.onClick ? a.onClick(close) : close());
    foot.appendChild(b);
  });
  if (!foot.children.length) foot.remove();
  dlg.querySelector('.modal-x').onclick = () => close();
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  modalStack.push(entry);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  return close;
}
export const anyModalOpen = () => modalStack.length > 0;
export function closeTopModal() { if (!modalStack.length) return false; modalStack[modalStack.length - 1].close(); return true; }

export function confirmDlg({ title, body, okLabel = '确定', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    openModal({
      title: title || '请确认', width: 440,
      body: `<div class="confirm-text">${body || ''}</div>`,
      actions: [
        { label: '取消', onClick: (c) => { done = true; resolve(false); c(); } },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: (c) => { done = true; resolve(true); c(); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}
export function promptDlg({ title, label, placeholder = '', value = '', okLabel = '确定' }) {
  return new Promise((resolve) => {
    const body = el(`<div class="form-row">${label ? `<label>${esc(label)}</label>` : ''}<input class="ipt" placeholder="${esc(placeholder)}" value="${esc(value)}"></div>`);
    const input = body.querySelector('input');
    let done = false;
    const submit = (c) => { const v = input.value.trim(); if (!v) { input.focus(); return; } done = true; resolve(v); c(); };
    const close = openModal({
      title: title || '请输入', width: 420, body,
      actions: [{ label: '取消', onClick: (c) => { done = true; resolve(null); c(); } }, { label: okLabel, kind: 'primary', onClick: submit }],
      onClose: () => { if (!done) resolve(null); },
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(close); } });
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}

// ---------- 菜单（右键菜单 / 下拉菜单共用） ----------
// items: [{ label, icon, kbd, hint, checked, disabled, danger, onClick }] 或 '-' 分隔线 或 { title } 小标题
let openMenuEl = null;
export function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
export function showMenu(items, x, y, { minWidth = 190, anchor = null, align = 'left' } = {}) {
  closeMenu();
  const menu = el(`<div class="menu" style="min-width:${minWidth}px"></div>`);
  items.filter(Boolean).forEach((it) => {
    if (it === '-') { menu.appendChild(el('<div class="menu-sep"></div>')); return; }
    if (it.title) { menu.appendChild(el(`<div class="menu-title">${esc(it.title)}</div>`)); return; }
    const row = el(`<button class="menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}" ${it.disabled ? 'disabled' : ''}>
      <span class="mi-ico">${it.checked ? icon('check', 15) : it.icon ? icon(it.icon, 15) : ''}</span>
      <span class="mi-label">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>
      ${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`);
    row.onclick = (e) => { e.stopPropagation(); closeMenu(); if (it.onClick) it.onClick(); };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  let left = x, top = y;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === 'right' ? a.right - r.width : align === 'center' ? a.left + a.width / 2 - r.width / 2 : a.left;
    top = a.bottom + 6;
    if (top + r.height > innerHeight - 8) top = a.top - r.height - 6;
  }
  left = clamp(left, 8, innerWidth - r.width - 8);
  top = clamp(top, 8, innerHeight - r.height - 8);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  requestAnimationFrame(() => menu.classList.add('show'));
  openMenuEl = menu;
  return menu;
}
export const menuOpen = () => !!openMenuEl;
// 用 pointerdown：页面覆盖层会取消 pointerdown，那样浏览器就不再补发 mousedown，菜单会关不掉
document.addEventListener('pointerdown', (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }, true);
document.addEventListener('contextmenu', (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// ---------- 悬停提示：任何带 data-tip 的元素（可带 data-kbd 显示快捷键） ----------
let tipEl = null, tipTimer = 0, tipFor = null;
function hideTip() { clearTimeout(tipTimer); tipFor = null; if (tipEl) tipEl.classList.remove('show'); }
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t === tipFor) return;
  hideTip();
  if (!t) return;
  tipFor = t;
  tipTimer = setTimeout(() => {
    if (!t.isConnected) return;
    if (!tipEl) { tipEl = el('<div class="tip"></div>'); document.body.appendChild(tipEl); }
    const kbd = t.getAttribute('data-kbd');
    tipEl.innerHTML = esc(t.getAttribute('data-tip')) + (kbd ? ` <kbd>${esc(kbd)}</kbd>` : '');
    const a = t.getBoundingClientRect(), r = tipEl.getBoundingClientRect();
    const place = t.getAttribute('data-tip-place') || 'bottom';
    let left = a.left + a.width / 2 - r.width / 2, top = place === 'top' ? a.top - r.height - 8 : a.bottom + 8;
    if (place === 'right') { left = a.right + 10; top = a.top + a.height / 2 - r.height / 2; }
    if (place === 'left') { left = a.left - r.width - 10; top = a.top + a.height / 2 - r.height / 2; }
    if (top + r.height > innerHeight - 6) top = a.top - r.height - 8;
    tipEl.style.left = clamp(left, 6, innerWidth - r.width - 6) + 'px';
    tipEl.style.top = clamp(top, 6, innerHeight - r.height - 6) + 'px';
    tipEl.classList.add('show');
  }, 380);
});
document.addEventListener('pointerdown', hideTip, true);
document.addEventListener('wheel', hideTip, { passive: true, capture: true });

// 行内分段按钮组的通用同步
export function segSync(root, value, attr = 'data-v') {
  root.querySelectorAll(`[${attr}]`).forEach((b) => b.classList.toggle('on', b.getAttribute(attr) === String(value)));
}
