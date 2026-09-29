// ui.js —— 轻量界面工具：toast 提示、模态弹窗、确认框、转义等。
// 纯界面工具，不依赖任何业务模块，各模块可自由使用。

// ---------- 小工具 ----------
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

export function uid(prefix) {
  return (prefix || 'x') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return String(iso); }
}

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// ---------- toast ----------
let toastHost = null;
function ensureToastHost() {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('<div class="toast-host"></div>');
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

// type: '' 普通 | 'ok' 成功 | 'err' 错误；timeout 毫秒，0 表示常驻（需手动关闭）
export function toast(message, type = '', timeout = 3200) {
  const host = ensureToastHost();
  const item = el(`<div class="toast ${type}"><span>${esc(message)}</span><button class="toast-x" title="关闭">×</button></div>`);
  item.querySelector('.toast-x').onclick = () => item.remove();
  host.appendChild(item);
  // 触发出场动画
  requestAnimationFrame(() => item.classList.add('show'));
  if (timeout > 0) {
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 250);
    }, timeout);
  }
  return item;
}

export function toastError(err) {
  toast(err && err.message ? err.message : String(err || '出错了'), 'err', 4200);
}

// ---------- 模态弹窗 ----------
// openModal({ title, body, actions:[{label, kind:'primary'|'danger'|'', onClick(close)}], width, onClose })
// 返回 close()。Esc 关闭；点遮罩不关（防误触丢失内容），需显式按钮/Esc。
let modalStack = [];
export function openModal(opts) {
  const wrap = el(
    `<div class="modal-mask"><div class="modal" style="${opts.width ? `width:${opts.width}px;` : ''}" role="dialog">
      <div class="modal-head"><div class="modal-title">${esc(opts.title || '')}</div>
        <button class="modal-x" title="关闭（Esc）">×</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </div></div>`
  );
  const dlg = wrap.firstElementChild;
  const body = dlg.querySelector('.modal-body');
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);
  const foot = dlg.querySelector('.modal-foot');
  const actions = opts.actions || [{ label: '关闭' }];
  const close = (result) => {
    const i = modalStack.indexOf(entry);
    if (i >= 0) modalStack.splice(i, 1);
    wrap.remove();
    if (opts.onClose) opts.onClose(result);
  };
  const entry = { close };
  actions.forEach((a) => {
    const b = el(`<button class="${a.kind || ''}">${esc(a.label)}</button>`);
    b.onclick = () => {
      if (a.onClick) a.onClick(close);
      else close();
    };
    foot.appendChild(b);
  });
  dlg.querySelector('.modal-x').onclick = () => close();
  modalStack.push(entry);
  document.body.appendChild(wrap);
  return close;
}

// 是否有模态层开着（Esc 退出优先级判断用）
export function anyModalOpen() { return modalStack.length > 0; }
export function closeTopModal() {
  if (modalStack.length) { modalStack[modalStack.length - 1].close(); return true; }
  return false;
}

// 中文确认弹窗（危险操作二次确认）
export function confirmDlg({ title, body, okLabel = '确定', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const close = openModal({
      title: title || '请确认',
      body: typeof body === 'string' ? `<div class="confirm-text">${body}</div>` : body,
      actions: [
        { label: '取消', onClick: (c) => { done = true; resolve(false); c(); } },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: (c) => { done = true; resolve(true); c(); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return close;
  });
}

// 单行输入弹窗 → resolve(string|null)
export function promptDlg({ title, label, placeholder = '', value = '', okLabel = '确定' }) {
  return new Promise((resolve) => {
    const body = el(
      `<div class="form-row">
        ${label ? `<label>${esc(label)}</label>` : ''}
        <input type="text" class="ipt" placeholder="${esc(placeholder)}" value="${esc(value)}">
        <div class="form-hint"></div>
      </div>`
    );
    const input = body.querySelector('input');
    let done = false;
    const submit = (close) => {
      const v = input.value.trim();
      if (!v) { body.querySelector('.form-hint').textContent = '不能为空，请输入内容点确定'; input.focus(); return; }
      done = true; resolve(v); close();
    };
    const close = openModal({
      title: title || '请输入',
      body,
      actions: [
        { label: '取消', onClick: (c) => { done = true; resolve(null); c(); } },
        { label: okLabel, kind: 'primary', onClick: submit },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(close); } });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// 复制到剪贴板（带降级：execCommand）
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = el('<textarea style="position:fixed;left:-9999px;top:0"></textarea>');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}
