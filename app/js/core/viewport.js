// 真实桌面视口：网页按"在这台电脑的浏览器里最大化打开"时的尺寸排版，再整体等比缩放显示。
// 这样媒体查询、vh 单位、首屏高度都和真实浏览完全一致，只是看起来小一号。
import { clamp } from './ui.js';

const KEY = 'cd.viewport';
const listeners = new Set();

export const PRESETS = [
  { id: 'auto', label: '本机浏览器' },
  { id: 'fhd', label: '1080p 显示器', w: 1920, h: 969 },
  { id: 'qhd', label: '2K 显示器', w: 2560, h: 1289 },
  { id: 'lap125', label: '笔记本（125% 缩放）', w: 1536, h: 730 },
  { id: 'mac14', label: 'MacBook 14 寸', w: 1512, h: 823 },
  { id: 'lap', label: '小笔记本', w: 1366, h: 657 },
  { id: 'hd', label: '1280 × 720', w: 1280, h: 720 },
];

// 本机浏览器"最大化时的网页可视区"：屏幕宽 × (可用高度 - 标签栏地址栏高度)
export function autoSize() {
  const sw = window.screen.width || 1920;
  const avail = window.screen.availHeight || 1040;
  let chrome = window.outerHeight - window.innerHeight;
  if (!(chrome >= 40 && chrome <= 220)) chrome = 111;
  return { w: Math.round(sw), h: clamp(Math.round(avail - chrome), 480, 3000) };
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { id: 'auto' }; } catch { return { id: 'auto' }; }
}

export function getViewport() {
  const pref = read();
  if (pref.id === 'custom' && pref.w && pref.h) return { id: 'custom', label: '自定义', w: pref.w, h: pref.h };
  const p = PRESETS.find((x) => x.id === pref.id) || PRESETS[0];
  if (p.id === 'auto') return { ...p, ...autoSize() };
  return { ...p };
}

export function setViewport(id, w, h) {
  localStorage.setItem(KEY, JSON.stringify(id === 'custom' ? { id, w, h } : { id }));
  const v = getViewport();
  listeners.forEach((fn) => fn(v));
}
export function onViewportChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// 等比适配：不放大超过 100%（保持清晰），四周留白
export function fitScale(cw, ch, vw, vh, pad = 28) {
  const s = Math.min((cw - pad * 2) / vw, (ch - pad * 2) / vh, 1);
  return s > 0.02 ? s : 0.02;
}
