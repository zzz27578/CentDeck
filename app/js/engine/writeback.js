// writeback.js —— 三灯判定 + 精确回写
// 纯函数、零依赖、不碰 DOM，Node 下可测。
// 移植自 demo/core.js（setInlineStyle / setCssRule / parseStyle / diffLines）与 demo/edit.js（三灯判定逻辑）。
//
// 灯色规则（对应《项目说明书》五.1 与 十一"结构判断/波及检测"）：
//   绿灯：能说成"这一个元素的这一项改成多少"，且找得到源码行 → 只改该元素所在行直接写回
//   黄灯：照样写回，但带出 affected（被挤动/被盖住/共用 class 一起变），由用户决定保留或撤销
//   红灯：不写回，返回 reason。触发条件（说明书十一）：
//     · 跨区域移动（move 时 edit.crossed，几何判断由调用方在浏览器里做好传进来）
//     · 目标由脚本生成，源码里没有它自己的一行
//     · 要改的文字在源码里找不到、或找到多处歧义
//     · 改排列结构（display / position / grid-template-columns 等结构性属性）
//   另外两条硬性安全约定（说明书十一"精确回写"）：
//     · 挪位写独立 translate、缩放写独立 scale，绝不写 transform（动画通道）
//     · 默认只改元素自身行内样式，不碰共用 class；除非调用方显式 edit.scope === 'class'
//
// 几何类波及检测（被挤动/被盖住）不在本模块内做：
//   调用方通过 opts.measure(ctx) 注入同步度量回调，返回 [{loc, selector, line, ...}] 或空数组。
//   浏览器侧可用 render.js 的 session.makeMeasure() 直接生成该回调。

import { parse } from './parse.js';

// ---------- 行级 diff（移植 demo/core.js WB.diffLines）----------
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let p = 0, s = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  return { start: p + 1, end: B.length - s, removed: A.length - s - p, added: B.length - s - p, total: B.length };
}

// ---------- 行内样式解析与改写（移植 demo/core.js）----------
export function parseStyle(str) {
  return (str || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
  });
}
function applyProps(pairs, props) {
  Object.keys(props).forEach(k => {
    let idx = -1;
    const v = props[k];
    pairs.forEach((p, j) => { if (p[0] === k) idx = j; });
    if (v == null || v === '') { if (idx >= 0) pairs.splice(idx, 1); }
    else if (idx >= 0) pairs[idx][1] = v;
    else pairs.push([k, v]);
  });
  return pairs;
}
const joinPairs = pairs => pairs.map(p => p[0] + ': ' + p[1] + ';').join(' ');

export function getStyleProp(info, prop) {
  let v = null;
  parseStyle(info.style).forEach(p => { if (p[0] === prop) v = p[1]; });
  return v;
}

// 只改这个元素开标签里的 style="..."，其余源码原样保留（移植 demo/core.js WB.setInlineStyle）
export function setInlineStyle(source, info, props) {
  const styleStr = joinPairs(applyProps(parseStyle(info.style), props));
  const open = source.slice(info.openStart, info.openEnd);
  let out;
  const re = /\sstyle\s*=\s*("[^"]*"|'[^']*')/i;
  if (re.test(open)) {
    out = open.replace(re, () => (styleStr ? ' style="' + styleStr + '"' : ''));
  } else if (styleStr) {
    out = open.replace(/\s*(\/?)>$/, (all, slash) => ' style="' + styleStr + '"' + (slash ? ' /' : '') + '>');
  } else {
    out = open;
  }
  return { src: source.slice(0, info.openStart) + out + source.slice(info.openEnd), style: styleStr };
}

// 改 <style> 里的共用规则（移植 demo/core.js WB.setCssRule，扩展为多 style 块）：
// 优先在已含该选择器规则的块里改，找不到规则就追加到"最后一块"末尾
export function setCssRule(source, parsed, selector, props) {
  if (!parsed.styles.length) return null;
  const escSel = selector.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
  const ruleRe = new RegExp('(\\n[ \\t]*)' + escSel + '\\s*\\{([^}]*)\\}');
  let target = null, match = null;
  parsed.styles.forEach(range => {
    const css = source.slice(range[0], range[1]);
    const m = ruleRe.exec(css);
    if (m && !target) { target = range; match = m; }
  });
  if (!target) target = parsed.styles[parsed.styles.length - 1]; // 没有现成规则：往最后一块追加
  const css = source.slice(target[0], target[1]);
  let out;
  if (match) {
    const body = joinPairs(applyProps(parseStyle(match[2]), props));
    out = css.slice(0, match.index) + match[1] + selector + ' { ' + body + ' }' + css.slice(match.index + match[0].length);
  } else {
    const nb = joinPairs(applyProps([], props));
    if (/(\n[ \t]*)$/.test(css)) out = css.replace(/(\n[ \t]*)$/, (all, tail) => '\n    ' + selector + ' { ' + nb + ' }' + tail);
    else out = css + '\n    ' + selector + ' { ' + nb + ' }\n';
  }
  return source.slice(0, target[0]) + out + source.slice(target[1]);
}

// ---------- 结构性属性：改这些等于"改排列结构"，红灯 ----------
const STRUCTURAL = new Set([
  'display', 'position', 'float', 'clear',
  'flex', 'flex-direction', 'flex-wrap', 'flex-flow',
  'grid', 'grid-column', 'grid-row', 'grid-area',
  'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-flow', 'order', 'columns', 'column-count', 'table-layout', 'writing-mode'
]);

// ---------- 文本转义（移植 demo/edit.js escText）----------
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function occurrences(raw, needle) {
  const out = [];
  let from = 0, idx;
  while (needle && (idx = raw.indexOf(needle, from)) >= 0) { out.push(idx); from = idx + 1; }
  return out;
}

function curTranslate(info) {
  const v = getStyleProp(info, 'translate');
  if (!v) return [0, 0];
  const p = v.split(/\s+/).map(parseFloat);
  return [p[0] || 0, p[1] || 0];
}

// 解析目标：数字 loc / selector 字符串 / 对象 {loc|selector|generated:true}
function resolveTarget(parsed, target) {
  if (target && typeof target === 'object') {
    if (target.generated) return { generated: true, meta: target };
    if (typeof target.loc === 'number') return { el: parsed.byLoc(target.loc) };
    if (typeof target.selector === 'string') return { el: parsed.bySelector(target.selector) };
    return { el: null };
  }
  if (typeof target === 'number') return { el: parsed.byLoc(target) };
  if (typeof target === 'string') return { el: parsed.bySelector(target) };
  return { el: null };
}

// 程序生成元素的具体原因：在脚本数据清单里找原文，区分"多处歧义 / 拼出来的找不到 / 程序生成"三种红灯
function generatedReason(source, parsed, edit) {
  const base = '目标是程序运行时生成的内容，源码里没有它自己的一行，不宜直接写回；请把意图记成草图标记交给 AI。';
  if (edit.kind === 'text' && edit.meta && edit.meta.text) {
    const old = String(edit.meta.text).trim();
    if (old) {
      let hits = 0, hitLine = null;
      parsed.scripts.forEach(r => {
        ["'", '"', '`'].forEach(q => {
          let from = r[0], idx;
          while ((idx = source.indexOf(q + old + q, from)) >= 0 && idx < r[1]) { hits++; hitLine = parsed.lineOf(idx + 1); from = idx + 1; }
        });
      });
      if (hits > 1) return '源码里有 ' + hits + ' 处相同的「' + old + '」，不确定该改哪一处（多处歧义），不宜直接写回；请记成草图标记交给 AI。';
      if (hits === 1) return '这段字来自第 ' + hitLine + ' 行脚本里的数据清单，内容由程序循环生成，没有源码行可直接对应；请记成草图标记、改清单的任务交给 AI。';
      return '目标文字在源码里找不到原文（可能是程序临时拼接的），不宜直接写回；请记成草图标记交给 AI。';
    }
  }
  return base;
}

/**
 * applyEdit(source, edit, opts?) → { light, newSource?, affected?, reason?, changed?, line?, endLine?, selector?, note? }
 *
 * edit:
 *   kind: 'text' | 'style' | 'move'
 *   target: 元素 loc 数字 | selector 字符串 | { loc } | { selector } | { generated:true, text?, selector? }
 *   scope: 'self'（默认）| 'class'（显式改共用 class 规则）
 *   kind=text : { newText, oldText? }   oldText 给了就在元素原文内定位唯一一处替换；不给则整体替换标签间文字
 *   kind=style: { props: { 'font-size': '20px', color: '#fff', ... } }  值为 null/'' 表示删除该属性；scale 走独立 scale
 *   kind=move : { dx, dy, crossed? }    dx/dy 像素增量；crossed 由调用方在浏览器里判断"是否跨出所在容器"后传入
 *
 * opts.measure(ctx) —— 同步度量回调（几何波及检测），ctx = { kind, source, newSource, parsed, target:{loc,selector,line,tag} }
 *   返回非空数组 → 黄灯并作为 affected 合并返回；空数组/null → 不影响灯色。
 */
export function applyEdit(source, edit, opts = {}) {
  edit = edit || {};
  const parsed = parse(source);
  const fail = (reason, extra) => Object.assign({ light: 'red', reason }, extra);

  const t = resolveTarget(parsed, edit.target);
  // —— 红灯：程序生成的元素，源码里没有它的门牌号 ——
  if (t.generated) {
    return fail(generatedReason(source, parsed, { kind: edit.kind, meta: t.meta }), { selector: t.meta && t.meta.selector });
  }
  const info = t.el;
  if (!info) {
    return fail('在源码里找不到目标元素（' + JSON.stringify(edit.target) + '），源码可能已变化；请重新选中后再试。');
  }
  const at = x => x + '（第 ' + info.line + ' 行 <' + info.tag + '>）';

  let newSource = null, scopeClass = null, note = null;

  if (edit.kind === 'text') {
    // —— 改字 ——
    const nt = String(edit.newText == null ? '' : edit.newText);
    if (/\r|\n/.test(nt)) return fail('新文字里不允许换行：换行会改变行数，无法做到"只改那一行"。', { selector: info.selector, line: info.line });
    if (!nt.trim()) return fail('不能把文字清空：清空文字相当于改内容结构；如要删整块内容请用删除命令（会按波及情况亮黄灯）。', { selector: info.selector, line: info.line });
    // 非纯文字元素：给出 oldText（元素内唯一的文本段）时放行——定位替换只动那一小串，标签与行数都不变
    if (!info.textOnly && edit.oldText == null) return fail('目标内部还嵌套着别的标签，不是一行纯文字；请选中里面具体的那段文字，或在右侧属性面板的"文字内容"里分段修改。', { selector: info.selector, line: info.line });
    if (info.jsDynamic) return fail('该区域被脚本引用、内容疑似由 JS 生成，写回源码里的文字不会生效；请记成草图标记交给 AI。', { selector: info.selector, line: info.line });
    const raw = info.text;
    const lead = /^\s*/.exec(raw)[0], trail = /\s*$/.exec(raw)[0];
    if (edit.oldText != null) {
      const occ = occurrences(raw, String(edit.oldText));
      if (occ.length === 0) return fail(at('目标文字') + '在源码里找不到原文（可能由脚本拼接或经过转义），不宜直接写回。', { selector: info.selector, line: info.line });
      if (occ.length > 1) return fail('第 ' + info.line + ' 行里有 ' + occ.length + ' 处相同的「' + edit.oldText + '」，无法确定改哪一处。', { selector: info.selector, line: info.line });
      const pos = info.openEnd + occ[0];
      newSource = source.slice(0, pos) + escText(nt) + source.slice(pos + String(edit.oldText).length);
    } else {
      // 未指明原文：整体替换标签中间的文字，保留原有首尾空白（移植 demo/edit.js commitText）
      newSource = source.slice(0, info.openEnd) + lead + escText(nt) + trail + source.slice(info.closeStart);
    }
  } else if (edit.kind === 'style') {
    // —— 字号 / 字体 / 颜色 / 缩放等行内样式 ——
    const props = {};
    Object.keys(edit.props || {}).forEach(k => { props[k.toLowerCase()] = edit.props[k]; });
    if (!Object.keys(props).length) return fail('edit.props 为空，没有要执行的样式修改。');
    if ('transform' in props) {
      return fail('绝不写 transform（那是动画通道）：挪位请用 move（写独立 translate），缩放请写独立 scale；写 transform 会被动画覆盖、元素"弹回去"。', { selector: info.selector, line: info.line });
    }
    const bad = Object.keys(props).filter(k => STRUCTURAL.has(k));
    if (bad.length) return fail(at(bad.join('、') + ' 这些属性属于排列结构') + '：三列变两列、绝对定位拔出队伍这类改动等于"改结构"，不宜直接写回；请记成草图标记交给 AI。', { selector: info.selector, line: info.line });
    if (edit.scope === 'class') {
      const cls = edit.className || info.classes[0];
      if (!cls || !info.classes.includes(cls)) return fail('scope:"class" 要求目标带指定 class；该元素上没有 class "' + cls + '"。', { selector: info.selector, line: info.line });
      newSource = setCssRule(source, parsed, '.' + cls, props);
      if (newSource == null) return fail('页面里没有 <style> 块，无处写共用规则。', { selector: info.selector, line: info.line });
      scopeClass = cls;
    } else {
      newSource = setInlineStyle(source, info, props).src;
    }
  } else if (edit.kind === 'move') {
    // —— 挪位：只写独立 translate，绝不写 transform ——
    if (edit.crossed) {
      return fail(at('跨区域移动') + '属于"改结构"：需要把整段代码剪切到新位置并适应新区域的排版，不宜直接写回；已恢复原样，请记成草图标记交给 AI。', { selector: info.selector, line: info.line });
    }
    const dx = +edit.dx || 0, dy = +edit.dy || 0;
    const base = curTranslate(info);
    const nx = Math.round(base[0] + dx), ny = Math.round(base[1] + dy);
    const nv = (nx || ny) ? nx + 'px ' + ny + 'px' : null; // 回到原点就清掉 translate
    if (edit.scope === 'class') {
      const cls = edit.className || info.classes[0];
      if (!cls || !info.classes.includes(cls)) return fail('scope:"class" 要求目标带指定 class。', { selector: info.selector, line: info.line });
      newSource = setCssRule(source, parsed, '.' + cls, { translate: nv });
      if (newSource == null) return fail('页面里没有 <style> 块，无处写共用规则。', { selector: info.selector, line: info.line });
      scopeClass = cls;
    } else {
      newSource = setInlineStyle(source, info, { translate: nv }).src;
    }
    if (info.transformAnim) note = '该元素占用 transform 动画通道：本次写的是独立 translate，与动画互不干扰，不会被"弹回去"。';
  } else {
    return fail('未知的编辑类型 kind="' + edit.kind + '"（支持 text / style / move）。');
  }

  // —— 判定灯色与波及 ——
  const changed = diffLines(source, newSource);
  let affected = [];
  if (scopeClass) {
    // scope:"class" 是显式"同类一起改"：被波及者可以静态列出（同 class 的其他元素）
    affected = parsed.elements
      .filter(el => el.loc !== info.loc && el.classes.includes(scopeClass))
      .map(el => ({ loc: el.loc, selector: el.selector, line: el.line, tag: el.tag, note: '与你改的元素共用 class .' + scopeClass + '，会一起变' }));
  }
  if (typeof opts.measure === 'function') {
    let m = null;
    try {
      m = opts.measure({
        kind: edit.kind, source, newSource, parsed,
        target: { loc: info.loc, selector: info.selector, line: info.line, tag: info.tag }
      });
    } catch (e) { m = null; } // 度量失败不阻塞写回（视为无几何信息）
    if (m && m.length) affected = affected.concat(m);
  }
  // 去重（静态 class 波及与几何波及可能重叠）
  const seen = new Set();
  affected = affected.filter(a => {
    const key = a.selector != null ? 's:' + a.selector : 'l:' + a.loc;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    light: affected.length ? 'yellow' : 'green',
    newSource,
    affected: affected.length ? affected : undefined,
    changed,
    line: info.line, endLine: info.endLine, selector: info.selector,
    note: note || undefined
  };
}
