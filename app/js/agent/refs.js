/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 助手的"引用"：像给 AI 看参考图一样，把页面、元素、草图标记、框选区域精确地指给它
// 每个引用 = { kind, label, icon, ...数据 }，在输入框上方显示成一个小标签（文字过长自动省略）
import { COLORS, TYPE_NAME } from '../sketch/sketch.js';

const COLOR_NAME = { '#e5484d': i18nText('红色'), '#f5a524': i18nText('橙色'), '#16a34a': i18nText('绿色'), '#3b82f6': i18nText('蓝色'), '#8b5cf6': i18nText('紫色'), '#1f2430': i18nText('黑色') };
export const colorName = (c) => COLOR_NAME[String(c || '').toLowerCase()] || i18nText('其它颜色');

export function refLabel(r) {
  if (r.kind === 'canvas-note') return { icon: 'sticky2', text: i18nTpl`便签 #${r.no} ${(r.text || '').slice(0, 20)}`, color: r.color };
  if (r.kind === 'page') return { icon: r.popup ? 'popup' : 'file', text: r.title };
  if (r.kind === 'region') return { icon: 'marquee', text: i18nTpl`${r.title} · 框选 ${r.rect.w}×${r.rect.h}` };
  if (r.kind === 'element') return { icon: 'target', text: r.title };
  if (r.kind === 'mark') return { icon: 'marks', text: `${colorName(r.color)} #${r.no} ${r.title}`, color:r.color };
  if (r.kind === 'marks-color') return { icon: 'marks', text: i18nTpl`全部${colorName(r.color)}标记（${r.count}）`, color: r.color };
  if (r.kind === 'marks-all') return { icon: 'marks', text: i18nTpl`全部草图标记（${r.count}）` };
  if (r.kind === 'file') return { icon: 'paperclip', text: r.name };
  return { icon: 'info', text: r.title || i18nText('引用') };
}
export const refKey = (r) => r.id&&['mark','canvas-note'].includes(r.kind)?r.kind+'|'+r.id:[r.kind, r.id, r.page, r.popup, r.no, r.color, r.selector, r.rect && [r.rect.x, r.rect.y, r.rect.w, r.rect.h].join(','), r.name].join('|');

const pageTitle = (app, f) => ((app.project().pages.find((p) => p.file === f) || {}).title || f);

// "@" 菜单：页面、选中的元素、标记（按编号 / 按颜色 / 全部）
export function mentionItems(app, add) {
  const items = [{ title: i18nText('页面') }];
  app.project().pages.forEach((p) => items.push({ label: p.title, hint: p.file, icon: 'file', onClick: () => add({ kind: 'page', page: p.file, title: p.title }) }));
  const ed = app.editor, info = app.view() === 'edit' && ed.selection;
  if (info) {
    items.push('-', { label: i18nText('选中的元素'), hint: ed.describe(info), icon: 'target', onClick: () => add({ kind: 'element', page: app.state.page, selector: info.selector, line: info.line, title: `${pageTitle(app, app.state.page)} · ${ed.describe(info)}` }) });
  }
  const marks = (app.sketch ? app.sketch.list() : []).filter((m) => !m.done);
  if (marks.length) {
    items.push('-', { title: i18nText('草图标记') });
    items.push({ label: i18nTpl`全部未完成标记（${marks.length} 条）`, hint: 'all', icon: 'marks', onClick: () => add({ kind: 'marks-all', count: marks.length }) });
    COLORS.forEach((c) => {
      const n = marks.filter((m) => (m.color || '').toLowerCase() === c).length;
      if (n) items.push({ label: i18nTpl`全部${colorName(c)}标记（${n}）`, icon: 'marks', onClick: () => add({ kind: 'marks-color', color: c, count: n }) });
    });
    marks.slice(-12).reverse().forEach((m) => items.push({
      label: `${colorName(m.color)} #${m.no} ${TYPE_NAME[m.type] || i18nText('标记')} · ${pageTitle(app, m.page)}`, hint: (m.text || m.meta || '').slice(0, 30), icon: 'marks',
      onClick: () => add({ kind: 'mark', id:m.id, color:m.color, no: m.no, page: m.page, title: `${TYPE_NAME[m.type] || i18nText('标记')} · ${pageTitle(app, m.page)}` }),
    }));
  }
  const notes = app.project().canvasNotes || [];
  if (notes.length) items.push('-', {title: i18nText('画布便签')}, ...notes.map(n => ({ label: i18nTpl`便签 #${n.no} ${(n.text || '').slice(0,24)}`, icon: 'sticky2', onClick: () => add({ kind: 'canvas-note', id: n.id, no: n.no, text: n.text, color: n.color }) })));
  return items;
}

// 发送时附带的"引用说明"（第二步会把它和对应的代码片段一起交给模型）
export function describeRefs(app, refs) {
  return refs.map((r) => {
    if (r.kind === 'canvas-note') { const n = (app.project().canvasNotes || []).find(n => n.id === r.id) || r; return i18nTpl`画布便签 #${n.no}（${colorName(n.color)}）：${n.text || ''}`; }
    if (r.kind === 'region') return i18nTpl`页面「${r.title}」上框选的区域：左 ${r.rect.x}、上 ${r.rect.y}、宽 ${r.rect.w}、高 ${r.rect.h}（${r.page}）`;
    if (r.kind === 'page') return i18nTpl`页面「${r.title}」（${r.page}）`;
    if (r.kind === 'element') return i18nTpl`元素 ${r.title}`;
    if (r.kind === 'mark') { const m=app.project().marks?.find(m=>m.id===r.id); return m ? i18nTpl`${colorName(m.color)}草图标记 #${m.no}（ID: ${m.id}）：${m.text||''}` : i18nTpl`${colorName(r.color)}草图标记 #${r.no}（${r.id||r.page}）`; }
    if (r.kind === 'marks-color') return i18nTpl`全部${colorName(r.color)}草图标记`;
    if (r.kind === 'marks-all') return i18nText('全部未完成的草图标记');
    if (r.kind === 'file') return i18nTpl`附件 ${r.name}`;
    return refLabel(r).text;
  });
}
