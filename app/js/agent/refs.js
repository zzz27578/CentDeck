// 助手的"引用"：像给 AI 看参考图一样，把页面、元素、草图标记、框选区域精确地指给它
// 每个引用 = { kind, label, icon, ...数据 }，在输入框上方显示成一个小标签（文字过长自动省略）
import { COLORS, TYPE_NAME } from '../sketch/sketch.js';

const COLOR_NAME = { '#e5484d': '红色', '#f5a524': '橙色', '#16a34a': '绿色', '#3b82f6': '蓝色', '#8b5cf6': '紫色', '#1f2430': '黑色' };
export const colorName = (c) => COLOR_NAME[String(c || '').toLowerCase()] || '其它颜色';

export function refLabel(r) {
  if (r.kind === 'canvas-note') return { icon: 'sticky2', text: `便签 #${r.no} ${(r.text || '').slice(0, 20)}`, color: r.color };
  if (r.kind === 'page') return { icon: r.popup ? 'popup' : 'file', text: r.title };
  if (r.kind === 'region') return { icon: 'marquee', text: `${r.title} · 框选 ${r.rect.w}×${r.rect.h}` };
  if (r.kind === 'element') return { icon: 'target', text: r.title };
  if (r.kind === 'mark') return { icon: 'marks', text: `#${r.no} ${r.title}` };
  if (r.kind === 'marks-color') return { icon: 'marks', text: `全部${colorName(r.color)}标记（${r.count}）`, color: r.color };
  if (r.kind === 'marks-all') return { icon: 'marks', text: `全部草图标记（${r.count}）` };
  if (r.kind === 'file') return { icon: 'paperclip', text: r.name };
  return { icon: 'info', text: r.title || '引用' };
}
export const refKey = (r) => [r.kind, r.id, r.page, r.popup, r.no, r.color, r.selector, r.rect && [r.rect.x, r.rect.y, r.rect.w, r.rect.h].join(','), r.name].join('|');

const pageTitle = (app, f) => ((app.project().pages.find((p) => p.file === f) || {}).title || f);

// "@" 菜单：页面、选中的元素、标记（按编号 / 按颜色 / 全部）
export function mentionItems(app, add) {
  const items = [{ title: '页面' }];
  app.project().pages.forEach((p) => items.push({ label: p.title, hint: p.file, icon: 'file', onClick: () => add({ kind: 'page', page: p.file, title: p.title }) }));
  const ed = app.editor, info = app.view() === 'edit' && ed.selection;
  if (info) {
    items.push('-', { label: '选中的元素', hint: ed.describe(info), icon: 'target', onClick: () => add({ kind: 'element', page: app.state.page, selector: info.selector, line: info.line, title: `${pageTitle(app, app.state.page)} · ${ed.describe(info)}` }) });
  }
  const marks = (app.sketch ? app.sketch.list() : []).filter((m) => !m.done);
  if (marks.length) {
    items.push('-', { title: '草图标记' });
    items.push({ label: `全部未完成标记（${marks.length} 条）`, hint: 'all', icon: 'marks', onClick: () => add({ kind: 'marks-all', count: marks.length }) });
    COLORS.forEach((c) => {
      const n = marks.filter((m) => (m.color || '').toLowerCase() === c).length;
      if (n) items.push({ label: `全部${colorName(c)}标记（${n}）`, icon: 'marks', onClick: () => add({ kind: 'marks-color', color: c, count: n }) });
    });
    marks.slice(-12).reverse().forEach((m) => items.push({
      label: `#${m.no} ${TYPE_NAME[m.type] || '标记'} · ${pageTitle(app, m.page)}`, hint: (m.text || m.meta || '').slice(0, 30), icon: 'marks',
      onClick: () => add({ kind: 'mark', no: m.no, page: m.page, title: `${TYPE_NAME[m.type] || '标记'} · ${pageTitle(app, m.page)}` }),
    }));
  }
  const notes = app.project().canvasNotes || [];
  if (notes.length) items.push('-', {title: '画布便签'}, ...notes.map(n => ({ label: `便签 #${n.no} ${(n.text || '').slice(0,24)}`, icon: 'sticky2', onClick: () => add({ kind: 'canvas-note', id: n.id, no: n.no, text: n.text, color: n.color }) })));
  return items;
}

// 发送时附带的"引用说明"（第二步会把它和对应的代码片段一起交给模型）
export function describeRefs(app, refs) {
  return refs.map((r) => {
    if (r.kind === 'canvas-note') { const n = (app.project().canvasNotes || []).find(n => n.id === r.id) || r; return `画布便签 #${n.no}（${colorName(n.color)}）：${n.text || ''}`; }
    if (r.kind === 'region') return `页面「${r.title}」上框选的区域：左 ${r.rect.x}、上 ${r.rect.y}、宽 ${r.rect.w}、高 ${r.rect.h}（${r.page}）`;
    if (r.kind === 'page') return `页面「${r.title}」（${r.page}）`;
    if (r.kind === 'element') return `元素 ${r.title}`;
    if (r.kind === 'mark') return `草图标记 #${r.no}`;
    if (r.kind === 'marks-color') return `全部${colorName(r.color)}草图标记`;
    if (r.kind === 'marks-all') return '全部未完成的草图标记';
    if (r.kind === 'file') return `附件 ${r.name}`;
    return refLabel(r).text;
  });
}
