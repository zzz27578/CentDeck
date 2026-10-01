import { styleEnabled, chooseStyle } from './extensions.js';
import { icon } from './icons.js';

export function mark(size = 32, { draw = false } = {}) {
  const length = draw ? ' pathLength="100"' : '';
  return `<svg class="cd-mark" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path class="mark-outer"${length} d="M45 17H28a15 15 0 0 0 0 30h6"/><path class="mark-inner"${length} d="M44 27H31a5 5 0 0 0 0 10h14"/><path class="mark-tip"${length} d="m40 42 6 5-6 5"/></g></svg>`;
}
export function theme() {
  return document.documentElement.dataset.theme || "light";
}
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("cd.theme", t);
}
export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}

export function styleSwitch() {

  const active = document.documentElement.dataset.style === 'noir';
  return `<button type="button" class="btn ghost style-switch" ${styleEnabled()?'':'hidden'} data-style aria-label="切换风格，当前：${active ? '黑白蓝' : '原版绿色'}" aria-pressed="${active}">${icon('palette', 18)}<span>切换风格</span></button>`;
}
export function bindStyleSwitch(root) {
  root.querySelectorAll('button[data-style]').forEach(button => { button.onclick = chooseStyle; });
}

export function moveSculpture(root) {
  const sculpture = root.querySelector('.brand-sculpture');
  const cover = root.querySelector('.landing-cover');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let drag = null;
  const turn = (x, y) => {
    sculpture.style.setProperty('--turn-y', `${Math.max(-1, Math.min(1, x)) * 9}deg`);
    sculpture.style.setProperty('--turn-x', `${Math.max(-1, Math.min(1, -y)) * 7}deg`);
    sculpture.style.setProperty('--shine-x', `${50 + Math.max(-1, Math.min(1, x)) * 22}%`);
    sculpture.style.setProperty('--shine-y', `${35 + Math.max(-1, Math.min(1, y)) * 18}%`);
  };
  cover.addEventListener('pointermove', e => {
    if (reduced.matches || document.documentElement.dataset.style === 'noir') return;
    if (drag) {
      turn((e.clientX - drag.x) / 150, (e.clientY - drag.y) / 150);
    } else if (e.pointerType !== 'touch') {
      const r = sculpture.getBoundingClientRect();
      turn((e.clientX - r.left - r.width / 2) / (r.width * 1.5), (e.clientY - r.top - r.height / 2) / (r.height * 1.5));
    }
  });
  sculpture.addEventListener('pointerdown', e => {
    if (reduced.matches || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY };
    sculpture.setPointerCapture(e.pointerId);
    sculpture.classList.add('is-turning');
  });
  const reset = () => { drag = null; sculpture.classList.remove('is-turning'); turn(0, 0); };
  sculpture.addEventListener('pointerup', reset);
  sculpture.addEventListener('pointercancel', reset);
  sculpture.addEventListener('lostpointercapture', reset);
  cover.addEventListener('pointerleave', () => { if (!drag) reset(); });
}
