/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 导入体检：逐页判断能不能直接改，用大白话说明原因
//   green = 完整可改；yellow = 大部分能改，个别地方要注意；red = 只能查看、圈选，修改交给 AI
import { parse, instrument, LOC_ATTR } from '../engine/parse.js';
import { withBase } from '../engine/frame.js';
import { renderSafePreview } from '../engine/preview.js';

const SPA_MARK = /__NEXT_DATA__|data-reactroot|ng-version=|data-v-app|data-server-rendered|__NUXT__|window\.__remixContext/;
const TW_CDN = /cdn\.tailwindcss\.com|@tailwindcss\/browser/;

// 在看不见的框里真正渲染一遍，数一数有多少页面元素在运行后没有源码对应位置（源码里没有）
function renderCount(html, baseHref) {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-30000px;top:0;width:1440px;height:900px;visibility:hidden;border:0';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      let total = 0, gen = 0;
      try {
        f.contentDocument.body.querySelectorAll('*').forEach((e) => {
          if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR)$/.test(e.tagName)) return;
          if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return;
          total++;
          if (!e.hasAttribute(LOC_ATTR)) gen++;
        });
      } catch { /* 忽略 */ }
      f.remove();
      resolve({ total, gen });
    };
    f.onload = () => setTimeout(finish, 700);
    setTimeout(finish, 4500);
    document.body.appendChild(f);
    renderSafePreview(f,withBase(instrument(html),baseHref),baseHref).catch(finish);
  });
}

export async function checkPage(file, src, { baseHref, fileSet }) {
  const issues = [];
  let grade = 'green';
  const bump = (g) => { if (g === 'red' || (g === 'yellow' && grade === 'green')) grade = g; };
  const lines = src.split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  if (!/^\uFEFF?\s*<!doctype html/i.test(src)) { issues.push({ level: 'yellow', text: i18nText('开头缺少 <!DOCTYPE html>：浏览器会用"兼容老网页"的方式排版，看起来可能和预期不一样。') }); bump('yellow'); }
  const selfClose = (src.match(/<(div|span|p|section|a|button|li|ul|ol|main|header|footer|nav|article|label|i|em|strong)\b[^<>]*\/>/gi) || []).length;
  if (selfClose) { issues.push({ level: 'yellow', text: i18nTpl`有 ${selfClose} 处 <div /> 这类写法：HTML 里它不会自己关闭，浏览器会把后面的内容都包进去，排版可能乱。` }); bump('yellow'); }
  if (lines.length < 8 && longest > 800) issues.push({ level: 'info', text: i18nText('代码压成了一行：照样能直接改，只是人看起来吃力。') });
  if (TW_CDN.test(src)) issues.push({ level: 'info', text: i18nText('用了 Tailwind：挪位置、缩放时如果和它自带的居中 / 悬停效果冲突，会提示你。') });
  const ext = (src.match(/<(?:link|script)[^>]+(?:href|src)\s*=\s*["']https?:\/\//gi) || []).length;
  if (ext) issues.push({ level: 'info', text: i18nTpl`引用了 ${ext} 个网上的样式或脚本：没网的时候可能显示不全。` });
  if (fileSet) {
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    const missing = [];
    const re = /<(?:link|script|img|source)\b[^>]*?\s(?:href|src)\s*=\s*["']([^"'#?]+)/gi;
    let m;
    while ((m = re.exec(src))) {
      const ref = m[1].trim();
      if (!ref || /^(https?:|data:|\/\/|mailto:|javascript:)/i.test(ref)) continue;
      let p;
      try { p = decodeURIComponent(new URL(ref, 'http://x/' + dir).pathname.slice(1)); } catch { continue; }
      if (!fileSet.has(p) && missing.length < 6 && !missing.includes(ref)) missing.push(ref);
    }
    if (missing.length) { issues.push({ level: 'yellow', text: i18nTpl`缺少文件：${missing.join('、')}。页面可能少了样式或图片，可以把整个文件夹一起导入。` }); bump('yellow'); }
  }
  const p = parse(src);
  const bodyEls = p.elements.filter((e) => !e.inSvg || e.tag === 'svg').length;
  if (SPA_MARK.test(src) || (bodyEls < 6 && p.scripts.length && /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(src))) {
    issues.push({ level: 'red', text: i18nText('这是打包后的 React / Vue 页面：内容都是脚本运行时生成的，代码里找不到对应的文字和位置。可以正常预览、圈选、画草图，修改交给 AI。') });
    bump('red');
  }
  {
    const { total, gen } = await renderCount(src, baseHref);
    if (total > 0 && gen / total > 0.6) { issues.push({ level: 'red', text: i18nTpl`页面上 ${Math.round((gen / total) * 100)}% 的页面元素在运行后没有源码对应位置：这些地方只能查看和圈选，修改交给 AI。` }); bump('red'); }
    else if (total > 0 && gen / total > 0.2) { issues.push({ level: 'yellow', text: i18nTpl`约 ${Math.round((gen / total) * 100)}% 的页面元素在运行后没有源码对应位置：这部分不能直接改字，其余照常。` }); bump('yellow'); }
  }
  return { file, grade, issues };
}

export async function checkProject(app, proj, fileSet) {
  const out = [];
  for (const pg of proj.pages.slice(0, 20)) {
    let src = '';
    try { src = await app.api.readFile(proj.id, pg.file); } catch { continue; }
    const dir = pg.file.includes('/') ? pg.file.slice(0, pg.file.lastIndexOf('/') + 1) : '';
    out.push({ ...(await checkPage(pg.file, src, { baseHref: `/preview/${encodeURIComponent(proj.id)}/${dir}`, fileSet })), title: pg.title });
  }
  return out;
}

// 交给 AI 整理格式的提示词（放进助手输入框，由用户自己发送）
export function tidyPrompt(proj, report) {
  const bad = report.filter((r) => r.grade !== 'green');
  return [
    i18nTpl`请用「整理导入的网页」技能处理项目「${proj.name}」。`,
    i18nText('要求：页面看起来必须和现在一模一样；只整理写法，不改文字内容、不改配色排版；保留所有 id、class、脚本和交互；输出普通的 HTML / CSS / JS（不要换成框架），按层级缩进、行内元素贴着文字写。'),
    i18nText('体检发现的问题：'),
    ...bad.map((r) => `- ${r.title}（${r.file}）：${r.issues.filter((i) => i.level !== 'info').map((i) => i.text).join(' ')}`),
  ].join('\n');
}
