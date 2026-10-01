/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from './i18n.js';
// 真实桌面视口：网页按"在这台电脑的浏览器里最大化打开"时的尺寸排版，再整体等比缩放显示。
// 这样媒体查询、vh 单位、首屏高度都和真实浏览完全一致，只是看起来小一号。
import { clamp } from './ui.js';

const KEY = 'cd.viewport';
const listeners = new Set();

export const PRESETS = [
  { id: 'auto', label: i18nText('本机浏览器') },
  { id: 'fhd', label: i18nText('1080p 显示器'), w: 1920, h: 969 },
  { id: 'qhd', label: i18nText('2K 显示器'), w: 2560, h: 1289 },
  { id: 'lap125', label: i18nText('笔记本（125% 缩放）'), w: 1536, h: 730 },
  { id: 'mac14', label: i18nText('MacBook 14 寸'), w: 1512, h: 823 },
  { id: 'lap', label: i18nText('小笔记本'), w: 1366, h: 657 },
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

// 手机尺寸（都不超过 767px，这样"只改手机版"写进 @media (max-width: 767px) 正好对得上）
export const MOBILE_PRESETS = [
  { id: 'iphone15', label: 'iPhone 15 / 14', w: 393, h: 852 },
  { id: 'android', label: i18nText('常见安卓手机'), w: 412, h: 915 },
  { id: 'iphonese', label: 'iPhone SE', w: 375, h: 667 },
  { id: 'small', label: i18nText('小屏安卓'), w: 360, h: 780 },
];
export const MOBILE_MAX = 767;
const DEV_KEY = 'cd.device', MKEY = 'cd.mobileVp';

function read(key = KEY) {
  try { return JSON.parse(localStorage.getItem(key)) || { id: 'auto' }; } catch { return { id: 'auto' }; }
}
export const getDevice = () => (localStorage.getItem(DEV_KEY) === 'mobile' ? 'mobile' : 'desktop');

export function getViewport() {
  if (getDevice() === 'mobile') {
    const m = read(MKEY);
    const p = MOBILE_PRESETS.find((x) => x.id === m.id) || MOBILE_PRESETS[0];
    return { ...p, device: 'mobile' };
  }
  const pref = read();
  if (pref.id === 'custom' && pref.w && pref.h) return { id: 'custom', label: i18nText('自定义'), w: pref.w, h: pref.h, device: 'desktop' };
  const p = PRESETS.find((x) => x.id === pref.id) || PRESETS[0];
  if (p.id === 'auto') return { ...p, ...autoSize(), device: 'desktop' };
  return { ...p, device: 'desktop' };
}

// 先复制一份再逐个通知：回调里重建视图会注册新的监听，直接遍历 Set 会把新加的也调用一遍，陷入死循环
const notify = () => { const v = getViewport(); [...listeners].forEach((fn) => fn(v)); };
export function setViewport(id, w, h) {
  if (getDevice() === 'mobile') localStorage.setItem(MKEY, JSON.stringify({ id }));
  else localStorage.setItem(KEY, JSON.stringify(id === 'custom' ? { id, w, h } : { id }));
  notify();
}
export function setDevice(d) {
  if (d === getDevice()) return;
  localStorage.setItem(DEV_KEY, d === 'mobile' ? 'mobile' : 'desktop');
  notify();
}
export function onViewportChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// 等比适配：不放大超过 100%（保持清晰），四周留白
export function fitScale(cw, ch, vw, vh, pad = 28) {
  const s = Math.min((cw - pad * 2) / vw, (ch - pad * 2) / vh, 1);
  return s > 0.02 ? s : 0.02;
}
