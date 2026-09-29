// 任务单：把未完成的草图标记整理成一份说明，每条带页面、元素、代码行和相关片段，直接粘贴给任何 AI
import { el, esc, toast, openModal, copyText } from '../core/ui.js';
import { parse } from '../engine/parse.js';

const TYPE = { pen: '圈画', arrow: '箭头指向', rect: '框选区域', ellipse: '圈出重点', note: '便签', ghost: '想挪到新位置', verdict: '手动修改受阻' };

export async function exportTaskSheet(app) {
  const proj = app.project();
  const list = (proj.marks || []).filter((m) => !m.done);
  if (!list.length) { toast('还没有未完成的标记', 'err'); return; }
  const cache = new Map();
  const srcOf = async (page) => {
    if (!cache.has(page)) { try { cache.set(page, await app.api.readFile(proj.id, page)); } catch { cache.set(page, ''); } }
    return cache.get(page);
  };
  const L = [`# 任务单 · ${proj.name}`, '', `> 由 CentDeck 草图标记生成，共 ${list.length} 条。每条都标了代码位置；请只改相关片段，别的不动。`, ''];
  let n = 0;
  for (const pg of proj.pages) {
    const ms = list.filter((m) => m.page === pg.file);
    for (const m of ms) {
      n++;
      L.push(`## ${n}. ${TYPE[m.type] || m.type} · ${pg.title}（\`${pg.file}\`）`, '');
      const src = m.anchor && m.anchor.selector ? await srcOf(m.page) : '';
      if (src) {
        const info = parse(src).bySelector(m.anchor.selector);
        if (info) {
          L.push(`- 元素：<${info.tag}>，代码第 ${info.line}${info.endLine > info.line ? '–' + info.endLine : ''} 行`);
          const lines = src.split('\n');
          const from = Math.max(0, info.line - 2), to = Math.min(lines.length, Math.min(info.endLine, info.line + 12) + 1);
          L.push('- 相关代码：', '```html', ...lines.slice(from, to).map((l, k) => `${from + k + 1}: ${l}`), '```');
        }
      }
      if (m.meta) L.push(`- 位置：${m.meta}`);
      if (m.type === 'ghost' && m.pts) L.push(`- 意图：把这个元素挪到新位置（向右 ${Math.round(m.pts[1][0])}px、向下 ${Math.round(m.pts[1][1])}px，按屏幕 ${m.vp ? m.vp.w + '×' + m.vp.h : ''} 估算），请用合适的排版方式实现，不要用绝对定位硬塞`);
      L.push(`- 要求：${m.text || '（没写，按标记的图意理解）'}`, '');
    }
  }
  const md = L.join('\n');
  const body = el(`<div><p class="hint" style="margin-bottom:8px">位置已精确到代码行、只附相关片段，比整页代码省很多字数（约 ${md.length} 字）。</p><textarea class="ipt" readonly rows="18" style="font:12px/1.6 ui-monospace,Consolas,monospace">${esc(md)}</textarea></div>`);
  openModal({
    title: `任务单（${list.length} 条）`, width: 760, body,
    actions: [{ label: '关闭' }, { label: '复制到剪贴板', kind: 'primary', onClick: async (close) => { const ok = await copyText(md); toast(ok ? '已复制，去粘贴给你的 AI 吧' : '复制失败，请手动全选复制', ok ? 'ok' : 'err'); if (ok) close(); } }],
  });
}
