/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 任务单：把未完成的草图标记整理成一份说明，每条带页面、元素、代码行和相关片段，直接粘贴给任何 AI
import { el, esc, toast, openModal, copyText } from '../core/ui.js';
import { parse } from '../engine/parse.js';

const TYPE = { pen: i18nText('圈画'), arrow: i18nText('箭头指向'), rect: i18nText('框选区域'), ellipse: i18nText('圈出重点'), note: i18nText('便签'), image: i18nText('参考图'), verdict: i18nText('手动修改受阻') };
const typeOf = (m) => (m.intent === 'move' ? i18nText('想挪到新位置') : TYPE[m.type] || m.type);

export async function exportTaskSheet(app) {
  const proj = app.project();
  const list = (proj.marks || []).filter((m) => !m.done);
  if (!list.length) { toast(i18nText('还没有未完成的标记'), 'err'); return; }
  const cache = new Map();
  const srcOf = async (page) => {
    if (!cache.has(page)) { try { cache.set(page, await app.api.readFile(proj.id, page)); } catch { cache.set(page, ''); } }
    return cache.get(page);
  };
  const L = [i18nTpl`# 任务单 · ${proj.name}`, '', i18nTpl`> 由 CentDeck 草图标记生成，共 ${list.length} 条。每条都标了代码位置；请只改相关片段，别的不动。`, ''];
  for (const pg of proj.pages) {
    const ms = list.filter((m) => m.page === pg.file);
    for (const m of ms) {
      L.push(`## ${m.color} #${m.no} ${typeOf(m)} · ${pg.title}（\`${pg.file}\`）`, '');
      const src = m.anchor && m.anchor.selector ? await srcOf(m.page) : '';
      if (src) {
        const info = parse(src).bySelector(m.anchor.selector);
        if (info) {
          L.push(i18nTpl`- 元素：<${info.tag}>，代码第 ${info.line}${info.endLine > info.line ? '–' + info.endLine : ''} 行`);
          const lines = src.split('\n');
          const from = Math.max(0, info.line - 2), to = Math.min(lines.length, Math.min(info.endLine, info.line + 12) + 1);
          L.push(i18nText('- 相关代码：'), '```html', ...lines.slice(from, to).map((l, k) => `${from + k + 1}: ${l}`), '```');
        }
      }
      L.push(i18nTpl`- 标记 ID：${m.id}`);
      if (m.meta) L.push(i18nTpl`- 位置：${m.meta}`);
      const vp = m.vp ? i18nTpl`（按 ${m.vp.w}×${m.vp.h} 的屏幕估算）` : '';
      if (m.intent === 'move' && m.pts) L.push(i18nTpl`- 意图：把这个元素挪到箭头指的位置，向右 ${Math.round(m.pts[1][0] - m.pts[0][0])}px、向下 ${Math.round(m.pts[1][1] - m.pts[0][1])}px${vp}；请用合适的排版方式实现，不要用绝对定位硬塞`);
      if (m.type === 'image' && m.pts) L.push(i18nTpl`- 素材：\`assets/${m.asset}\`，请把这张图放进页面，位置和大小参考标记（约 ${Math.round(Math.abs(m.pts[1][0] - m.pts[0][0]))}×${Math.round(Math.abs(m.pts[1][1] - m.pts[0][1]))}px，左上角在页面 ${Math.round(m.pts[0][0])}, ${Math.round(m.pts[0][1])}）${vp}`);
      L.push(i18nTpl`- 要求：${m.text || i18nText('（没写，按标记的图意理解）')}`, '');
    }
  }
  const md = L.join('\n');
  const body = el(i18nTpl`<div><p class="hint" style="margin-bottom:8px">位置已精确到代码行、只附相关片段，比整页代码省很多字数（约 ${md.length} 字）。</p><textarea class="ipt" readonly rows="18" style="font:12px/1.6 ui-monospace,Consolas,monospace">${esc(md)}</textarea></div>`);
  openModal({
    title: i18nTpl`任务单（${list.length} 条）`, width: 760, body,
    actions: [{ label: i18nText('关闭') }, { label: i18nText('复制到剪贴板'), kind: 'primary', onClick: async (close) => { const ok = await copyText(md); toast(ok ? i18nText('已复制，去粘贴给你的 AI 吧') : i18nText('复制失败，请手动全选复制'), ok ? 'ok' : 'err'); if (ok) close(); } }],
  });
}
