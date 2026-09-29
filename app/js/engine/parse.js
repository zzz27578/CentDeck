// parse.js —— HTML 源码解析：画面元素 → 源码"门牌号"
// 纯函数、零依赖、不碰 DOM，Node 与浏览器通用。
// 移植自 demo/core.js 的 WB.parse / WB.attr / WB.instrument，新增：
//   · 以 body 为根的 :nth-of-type 选择器路径（界面层用它唯一定位元素）
//   · 父子关系、行/列范围
//   · 类型分类（text / image / container / control）
//   · 共用 class 检测（sharedClass：同一个 class 被多个元素使用）
//   · transform 动画通道占用检测（transformAnim：静态分析 <style> 里的 @keyframes 与 animation 规则）
//   · 疑似 JS 生成检测（jsDynamic：脚本里 getElementById / querySelector 引用到的容器）

const TAG_RE = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

// 空元素（没有闭合标签）
const VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
// 不参与"可编辑元素清单"的标签（但仍进树，供 nth-of-type 计数与父子链使用）
const STRUCT = { html: 1, head: 1, body: 1, meta: 1, title: 1, script: 1, style: 1, link: 1 };
// 类型分类用的标签表
const IMAGE = { img: 1, svg: 1, picture: 1, video: 1, audio: 1, canvas: 1, iframe: 1 };
const CONTROL = { a: 1, button: 1, input: 1, select: 1, textarea: 1, label: 1, option: 1 };

// 从属性串里读某个属性的值（移植 demo/core.js WB.attr）
export function attr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(attrs || '');
  return m ? (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : null;
}

function classify(tag, textOnly, text, isVoid, inSvg) {
  if (inSvg || IMAGE[tag]) return 'image';
  if (CONTROL[tag]) return 'control';
  if (!isVoid && textOnly && text.trim()) return 'text';
  return 'container';
}

// —— 简易 CSS 静态分析：找出占用 transform 通道的动画 ——
// 返回 { keyframes: { 动画名: 是否改写 transform }, rules: [{ selector, animNames: [] }] }
function analyzeCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const keyframes = {}, rules = [], n = css.length;
  function matchBrace(k) { // css[k] === '{'，返回配对 '}' 的下标
    let depth = 0;
    for (; k < n; k++) { if (css[k] === '{') depth++; else if (css[k] === '}' && --depth === 0) return k; }
    return n;
  }
  (function walk(from, to) {
    let k = from;
    while (k < to) {
      const open = css.indexOf('{', k);
      if (open < 0 || open >= to) break;
      const head = css.slice(k, open).trim();
      const close = matchBrace(open);
      if (/^@(?:-\w+-)?keyframes/i.test(head)) {
        const name = head.replace(/^@(?:-\w+-)?keyframes\s+/i, '').trim();
        keyframes[name] = /(?:^|[\s;{])-?(?:webkit-)?transform\s*:/.test(css.slice(open + 1, close));
      } else if (/^@(media|supports)\b/i.test(head)) {
        walk(open + 1, close); // 媒体查询里的规则按"疑似生效"处理
      } else if (head && head[0] !== '@') {
        const body = css.slice(open + 1, close);
        const animNames = [];
        (body.match(/(?:^|;)\s*(?:-\w+-)?animation(?:-name)?\s*:[^;]*/gi) || []).forEach(decl => {
          const value = decl.slice(decl.indexOf(':') + 1);
          value.split(/[\s,()]+/).forEach(tok => { if (/^[A-Za-z_][\w-]*$/.test(tok)) animNames.push(tok); });
        });
        rules.push({ selector: head, animNames });
      }
      k = close + 1;
    }
  })(0, n);
  return { keyframes, rules };
}

// 选择器匹配（只做复合选择器末段：tag.class#id 层级右端那一段，足以应付模板内样式）
function lastCompound(sel) {
  sel = sel.replace(/::?[a-zA-Z][\w-]*(\([^)]*\))?/g, '').trim();
  const parts = sel.split(/[\s>+~]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
function compoundMatches(el, compound) {
  if (compound === '*') return true;
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(compound);
  if (!m) return false;
  if (m[1] && m[1].toLowerCase() !== el.tag) return false;
  const tokens = m[2].match(/[.#][\w-]+/g) || [];
  for (const t of tokens) {
    if (t[0] === '#') { if (el.id !== t.slice(1)) return false; }
    else if (!el.classes.includes(t.slice(1))) return false;
  }
  return true;
}
function selectorMatches(el, selector) {
  return selector.split(',').some(s => compoundMatches(el, lastCompound(s)));
}

export function parse(html) {
  const src = String(html);
  TAG_RE.lastIndex = 0;
  const elements = [], scripts = [], styles = [];
  // root 是一棵轻量树：只为算 nth-of-type 与父子链，不作他用
  const root = { tag: '#root', counts: {}, children: [], parent: null, el: null };
  const stack = [root];

  let m;
  while ((m = TAG_RE.exec(src))) {
    if (!m[2]) continue; // 注释 / DOCTYPE
    const tag = m[2].toLowerCase();
    if (m[1]) { // 闭合标签：出栈到同名节点（容忍不成对标签，与 demo 一致）
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          if (stack[k].el) { stack[k].el.closeStart = m.index; stack[k].el.closeEnd = TAG_RE.lastIndex; }
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    parent.counts[tag] = (parent.counts[tag] || 0) + 1;
    const node = { tag: tag, nth: parent.counts[tag], parent: parent, el: null, counts: {}, children: [] };
    parent.children.push(node);

    const el = { tag, openStart: m.index, openEnd: TAG_RE.lastIndex, attrs: m[3] || '', closeStart: null, closeEnd: null };
    if (tag === 'script' || tag === 'style') {
      const end = src.indexOf('</' + tag, el.openEnd);
      const bodyEnd = end < 0 ? src.length : end;
      (tag === 'script' ? scripts : styles).push([el.openEnd, bodyEnd]);
      TAG_RE.lastIndex = bodyEnd; // 跳过脚本/样式正文
      continue; // 不入栈、不进元素清单
    }
    if (VOID[tag] || m[4]) { el.closeStart = el.closeEnd = el.openEnd; el.isVoid = true; }
    else stack.push(node);
    if (!STRUCT[tag]) { el.loc = elements.length; node.el = el; elements.push(el); }
  }

  // 行号/列号（二分查找行首偏移表）
  const lineStarts = [0];
  for (let p = 0; p < src.length; p++) if (src.charCodeAt(p) === 10) lineStarts.push(p + 1);
  function lineIdx(off) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo;
  }
  const lineOf = off => lineIdx(off) + 1;
  const colOf = off => off - lineStarts[lineIdx(off)] + 1;

  // 全页 class 计数，用于判断"共用 class"
  const classUsage = {};
  elements.forEach(el => {
    el.classes = (attr(el.attrs, 'class') || '').split(/\s+/).filter(Boolean);
    el.classes.forEach(c => { classUsage[c] = (classUsage[c] || 0) + 1; });
  });

  // CSS 静态分析（所有 <style> 块的内容合并分析）
  const styleBodies = styles.map(r => src.slice(r[0], r[1]));
  const css = analyzeCss(styleBodies.join('\n'));

  elements.forEach(el => {
    if (el.closeStart == null) el.closeStart = el.closeEnd = el.openEnd; // 未闭合容错
    el.text = src.slice(el.openEnd, el.closeStart);
    el.textOnly = !el.isVoid && el.text.indexOf('<') < 0;
    el.style = attr(el.attrs, 'style') || '';
    el.id = attr(el.attrs, 'id');
    el.line = lineOf(el.openStart);
    el.col = colOf(el.openStart);
    el.endLine = lineOf(Math.max(el.openStart, el.closeEnd - 1));
    el.endCol = colOf(Math.max(el.openStart, el.closeEnd - 1)) + 1;
  });
  // 给每个元素找回它对应的树节点（loc 与 node.el 一一对应，上面入树时已挂好）
  const nodeOf = new Map();
  (function collect(n) { n.children.forEach(c => { if (c.el) nodeOf.set(c.el.loc, c); collect(c); }); })(root);

  elements.forEach(el => {
    const node = nodeOf.get(el.loc);
    const seg = [];
    let inSvg = false, parentLoc = null, underBody = false;
    for (let n = node ? node.parent : null; n && n.tag !== '#root'; n = n.parent) {
      if (n.tag === 'svg') inSvg = true;
      if (n.tag === 'body') { underBody = true; break; }
      if (n.el && parentLoc == null) parentLoc = n.el.loc;
      seg.unshift(n.tag + ':nth-of-type(' + n.nth + ')');
    }
    if (node) seg.push(node.tag + ':nth-of-type(' + node.nth + ')'); // 祖先在前、自己在末尾
    el.selector = (underBody ? 'body > ' : '') + seg.join(' > ');
    el.parent = parentLoc;
    el.type = classify(el.tag, el.textOnly, el.text, !!el.isVoid, inSvg);
    el.sharedClasses = el.classes.filter(c => classUsage[c] > 1);
    el.sharedClass = el.sharedClasses.length > 0;
    // 疑似占用 transform 动画通道：命中了引用 transform 关键帧的 animation 规则（含行内 style）
    const animNames = new Set();
    css.rules.forEach(r => { if (selectorMatches(el, r.selector)) r.animNames.forEach(a => animNames.add(a)); });
    (el.style.match(/animation(?:-name)?\s*:\s*([^;]+)/i) || [])[1]
      ?.split(/[\s,()]+/).forEach(tok => { if (/^[A-Za-z_][\w-]*$/.test(tok)) animNames.add(tok); });
    el.animNames = [...animNames].filter(a => css.keyframes[a]);
    el.transformAnim = el.animNames.length > 0;
    el.jsDynamic = false;
  });

  // 疑似 JS 生成：脚本用 getElementById / querySelector 引用的容器，内容可能由脚本填充
  const JS_REF = /getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)|querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  scripts.forEach(range => {
    const body = src.slice(range[0], range[1]);
    let jm;
    while ((jm = JS_REF.exec(body))) {
      const target = jm[1] != null ? '#' + jm[1] : lastCompound(jm[2]);
      elements.forEach(el => { if (compoundMatches(el, target)) el.jsDynamic = true; });
    }
  });

  const bySel = new Map();
  elements.forEach(el => { if (!bySel.has(el.selector)) bySel.set(el.selector, el); });

  return {
    src, elements, scripts, styles, lineStarts, lineOf, colOf, classUsage, styleBodies,
    bySelector: sel => bySel.get(sel) || null,
    byLoc: loc => elements[loc] || null
  };
}

// 给每个可编辑元素的开标签里注入隐藏门牌号 data-loc（只进预览 iframe，不写回源码）
// 移植 demo/core.js WB.instrument：从后往前插，保证前面的偏移不失效
export function instrument(html, parsed) {
  const p = parsed || parse(html);
  let out = p.src;
  for (let k = p.elements.length - 1; k >= 0; k--) {
    const el = p.elements[k];
    let pos = el.openEnd - 1; // 开标签的 '>'
    if (out.charAt(pos - 1) === '/') pos--;
    out = out.slice(0, pos) + ' data-loc="' + el.loc + '"' + out.slice(pos);
  }
  return out;
}
