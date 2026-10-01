/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
const filters = [...document.querySelectorAll('[data-filter]')];
filters.forEach(button => button.addEventListener('click', () => {
  filters.forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  let visible = 0;
  document.querySelectorAll('[data-category]').forEach(card => { card.hidden = button.dataset.filter !== 'all' && card.dataset.category !== button.dataset.filter; if (!card.hidden) visible++; });
  document.querySelector('.projects')?.classList.toggle('filtered', button.dataset.filter !== 'all');
  const status = document.querySelector('.filter-status');
  if (status) status.textContent = `正在展示 ${visible} 个项目`;
}));
const navigation = document.querySelector('.nav');
const toggle = document.querySelector('.menu-toggle');
const setMenu = open => {
  navigation?.classList.toggle('menu-open', open);
  toggle?.setAttribute('aria-expanded', String(open));
  toggle?.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
};
toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
document.querySelectorAll('#site-nav a').forEach(a => a.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') { setMenu(false); toggle.focus(); } });
document.addEventListener('click', e => { if (navigation && !navigation.contains(e.target)) setMenu(false); });
window.matchMedia('(min-width: 761px)').addEventListener('change', e => { if (e.matches) setMenu(false); });
const dialog = document.getElementById('contact-dialog');
let previousFocus = null;
document.querySelectorAll('[data-contact]').forEach(button => button.addEventListener('click', () => {
  if (!dialog) return;
  previousFocus = button;
  setMenu(false);
  dialog.showModal();
  document.body.classList.add('dialog-open');
}));
dialog?.addEventListener('close', () => { document.body.classList.remove('dialog-open'); previousFocus?.focus(); });
dialog?.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
});
document.getElementById('contact-form')?.addEventListener('submit', event => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const values = new FormData(event.currentTarget), status = document.getElementById('form-status');
  status.hidden = false;
  status.textContent = `${String(values.get('name')).trim()}，你的咨询摘要已生成：${String(values.get('idea')).trim()}。联系邮箱：${String(values.get('email')).trim()}。此演示未发送或保存任何数据。`;
});