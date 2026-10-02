/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// frame.js —— 预览宿主：把页面源码渲染进 iframe（注入隐藏门牌号 data-cd-loc，源码本身不动）。
// 双缓冲：改完代码后在后台那块 iframe 里渲染好、恢复滚动位置，再无闪烁地换到前台。
import { parse, instrument } from './parse.js';

// 注入 <base>（让相对路径的图片、样式照常加载）和开场禁用过渡的样式；
// 没有 <head> 的页面插在 doctype 后面，绝不能插到 doctype 前（会让页面进入怪异模式、排版变样）
export function withBase(html, baseHref, extra = '') {
  const inject = `<base href="${baseHref}"><style id="__cd_boot">*,*::before,*::after{transition:none!important}</style>${extra}`;
  const m = /<head(?=[\s>/])[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + inject + html.slice(m.index + m[0].length);
  const d = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html);
  return d ? html.slice(0, d[0].length) + inject + html.slice(d[0].length) : inject + html;
}

function running(el) {
  try { return !!(el.getAnimations && el.getAnimations().some((a) => a.playState === 'running')); } catch { return false; }
}

// Browsers suspend requestAnimationFrame in background tabs. Rendering must
// still finish so a remote page operation does not hold the command queue.
export function afterPaint(callback) {
  let settled=false,frame,timer;
  const done=()=>{if(settled)return;settled=true;clearTimeout(timer);cancelAnimationFrame(frame);callback();};
  frame=requestAnimationFrame(done);timer=setTimeout(done,80);
}

export { createFrame } from './frame-host.js';

export function collateral(before, after, targetLoc, parsed) {
  const skip = new Set();
  const els = parsed.elements;
  if (targetLoc != null && els[targetLoc]) {
    skip.add(targetLoc);
    for (let p = els[targetLoc].parent; p != null; p = els[p].parent) skip.add(p);
    els.forEach((e) => { for (let p = e.parent; p != null; p = els[p].parent) if (p === targetLoc) { skip.add(e.loc); break; } });
  }
  const isAnc = (a, b) => { for (let p = els[b] && els[b].parent; p != null; p = els[p].parent) if (p === a) return true; return false; };
  const moved = [];
  Object.keys(before).forEach((k) => {
    const loc = +k, a = before[k], b = after[k];
    if (!b || skip.has(loc) || a.tag !== b.tag) return;
    if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1 || Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1) {
      const e = els[loc];
      moved.push({ loc, selector: e ? e.selector : null, line: e ? e.line : null, tag: e ? e.tag : null, dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y), note: i18nText('被挤动（排版让位）') });
    }
  });
  return moved.filter((m) => !moved.some((o) => o !== m && isAnc(o.loc, m.loc)));
}
