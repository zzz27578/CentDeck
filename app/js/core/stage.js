/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
// 舞台：把固定尺寸的"设备屏幕"（vw × vh）等比放进可用区域；
// 支持 适应 / 任意百分比、Ctrl+滚轮以光标为中心缩放、空格或中键拖动平移。
import { fitScale } from './viewport.js';
import { clamp } from './ui.js';
import { isSpaceDown } from './keys.js';

const STEPS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];

export function createStage(host, { onChange, pad = 28, labelHeight = 26 } = {}) {
  const device = document.createElement('div');
  device.className = 'device';
  host.appendChild(device);
  let vw = 1920, vh = 1080, z = 0.5, tx = 0, ty = 0, mode = 'fit';
  let raf = 0;

  const cw = () => host.clientWidth;
  const chh = () => host.clientHeight;

  function clampPan() {
    const dw = vw * z, dh = vh * z, W = cw(), H = chh();
    tx = dw + pad * 2 <= W ? (W - dw) / 2 : clamp(tx, W - dw - pad, pad);
    const top = pad + labelHeight;
    ty = dh + top + pad <= H ? top + (H - top - pad - dh) / 2 : clamp(ty, H - dh - pad, top);
  }
  function apply(animate) {
    clampPan();
    device.style.transition = animate ? 'transform .28s cubic-bezier(.2,.8,.2,1)' : 'none';
    device.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    host.style.setProperty('--z', z);
    host.style.setProperty('--inv', 1 / z);
    if (onChange) onChange(api);
  }
  function fit(animate = false) {
    mode = 'fit';
    z = fitScale(cw(), chh() - labelHeight, vw, vh, pad);
    tx = ty = 0;
    apply(animate);
  }
  function setZoom(nz, { cx, cy, animate = false } = {}) {
    nz = clamp(nz, 0.05, 3);
    const r = host.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const dx = (px - tx) / z, dy = (py - ty) / z;   // 光标下的设备坐标保持不动
    z = nz;
    tx = px - dx * z;
    ty = py - dy * z;
    mode = 'manual';
    apply(animate);
  }
  function step(dir) {
    const next = dir > 0 ? STEPS.find((s) => s > z + 0.001) : [...STEPS].reverse().find((s) => s < z - 0.001);
    setZoom(next || z, { animate: true });
  }

  // Ctrl+滚轮缩放（事件从设备内的覆盖层冒泡上来也会到这里）
  host.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0022));
      setZoom(z * k, { cx: e.clientX, cy: e.clientY });
      return;
    }
    if (e.target === host && mode === 'manual') {   // 灰色空白处滚轮 = 平移
      e.preventDefault();
      tx -= e.shiftKey ? e.deltaY : e.deltaX;
      ty -= e.shiftKey ? 0 : e.deltaY;
      apply(false);
    }
  }, { passive: false });

  // 空格+左键 或 中键 拖动平移（捕获阶段拦截，覆盖层不会收到）
  host.addEventListener('mousedown', (e) => {
    const panning = e.button === 1 || (e.button === 0 && isSpaceDown());
    if (!panning) return;
    e.preventDefault();
    e.stopPropagation();
    mode = 'manual';
    const sx = e.clientX, sy = e.clientY, ox = tx, oy = ty;
    host.classList.add('panning');
    const mv = (ev) => { tx = ox + ev.clientX - sx; ty = oy + ev.clientY - sy; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => apply(false)); };
    const up = () => { host.classList.remove('panning'); window.removeEventListener('mousemove', mv, true); window.removeEventListener('mouseup', up, true); };
    window.addEventListener('mousemove', mv, true);
    window.addEventListener('mouseup', up, true);
  }, true);

  const ro = new ResizeObserver(() => { if (mode === 'fit') fit(false); else apply(false); });
  ro.observe(host);

  const api = {
    device, host,
    get zoom() { return z; },
    get mode() { return mode; },
    get size() { return { w: vw, h: vh }; },
    setSize(w, h) { vw = w; vh = h; device.style.width = w + 'px'; device.style.height = h + 'px'; mode === 'fit' ? fit(false) : apply(false); },
    fit, setZoom, zoomIn: () => step(1), zoomOut: () => step(-1),
    actual: () => setZoom(1, { animate: true }),
    // 屏幕坐标 → 设备坐标（网页视口坐标）
    toDevice(clientX, clientY) {
      const r = device.getBoundingClientRect();
      return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
    },
    destroy() { ro.disconnect(); device.remove(); },
  };
  api.setSize(vw, vh);
  return api;
}
