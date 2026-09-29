// parse.js —— 源码解析：用 parse5（和浏览器同一套 HTML 解析规则）找出每个元素、每段文字在源码里的精确位置。
// 任何写法都行：缩进、压成一行、省略结束标签、<div />、实体字符……解析出的结构和浏览器里的页面一致。
// 纯函数、不碰 DOM，Node 与浏览器通用。
import { parse as p5parse } from '../vendor/parse5.js';

export const LOC_ATTR = 'data-cd-loc';

// 不进"可编辑元素清单"的标签（仍参与 nth-of-type 计数）
const STRUCT = new Set(['html', 'head', 'body', 'meta', 'title', 'link', 'base']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const IMAGE = new Set(['img', 'svg', 'picture', 'video', 'audio', 'canvas', 'iframe', 'object', 'embed']);
const CONTROL = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'option']);

// 从属性原文里读某个属性（总览扫描用；元素本身的属性以 attrMap 为准）
export function attr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(attrs || '');
  if (m) return m[1] != null ? m[1] : m[2] != null ? m[2] : m[3];
  return new RegExp('(?:^|\\s)' + name + '(?=\\s|/|$)', 'i').test(attrs || '') ? '' : null;
}

// ---------- CSS 静态分析：哪些规则的动画会改写 transform ----------
function analyzeCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const keyframes = {}, rules = [], n = css.length;
  const matchBrace = (k) => { let d = 0; for (; k < n; k++) { if (css[k] === '{') d++; else if (css[k] === '}' && --d === 0) return k; } return n; };
  (function walk(from, to) {
    let k = from;
    while (k < to) {
      const open = css.indexOf('{', k);
      if (open < 0 || open >= to) break;
      const head = css.slice(k, open).trim(), close = matchBrace(open);
      if (/^@(?:-\w+-)?keyframes/i.test(head)) keyframes[head.replace(/^@(?:-\w+-)?keyframes\s+/i, '').trim()] = /(?:^|[\s;{])-?(?:webkit-)?(?:transform|translate|scale)\s*:/.test(css.slice(open + 1, close));
      else if (/^@(media|supports|layer|container)\b/i.test(head)) walk(open + 1, close);
      else if (head && head[0] !== '@') {
        const names = [];
        (css.slice(open + 1, close).match(/(?:^|;)\s*(?:-\w+-)?animation(?:-name)?\s*:[^;]*/gi) || []).forEach((d) => d.slice(d.indexOf(':') + 1).split(/[\s,()]+/).forEach((t) => { if (/^[A-Za-z_][\w-]*$/.test(t)) names.push(t); }));
        rules.push({ selector: head, animNames: names });
      }
      k = close + 1;
    }
  })(0, n);
  return { keyframes, rules };
}
function lastCompound(sel) {
  const parts = sel.replace(/::?[a-zA-Z][\w-]*(\([^)]*\))?/g, '').trim().split(/[\s>+~]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
function compoundMatches(el, compound) {
  if (compound === '*') return true;
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(compound);
  if (!m) return false;
  if (m[1] && m[1].toLowerCase() !== el.tag.toLowerCase()) return false;
  for (const t of m[2].match(/[.#][\w-]+/g) || []) {
    if (t[0] === '#' ? el.id !== t.slice(1) : !el.classes.includes(t.slice(1))) return false;
  }
  return true;
}
const selectorMatches = (el, sel) => sel.split(',').some((s) => compoundMatches(el, lastCompound(s)));

export function parse(html) {
  const src = String(html);
  const doc = p5parse(src, { sourceCodeLocationInfo: true });
  const elements = [], scripts = [], styles = [];
  const lineStarts = [0];
  for (let p = 0; p < src.length; p++) if (src.charCodeAt(p) === 10) lineStarts.push(p + 1);
  const lineIdx = (off) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };
  const lineOf = (off) => lineIdx(off) + 1;
  const colOf = (off) => off - lineStarts[lineIdx(off)] + 1;

  function walk(node, parentLoc, segs, inSvg) {
    const counts = {};
    for (const ch of node.childNodes || []) {
      if (!ch.tagName) continue;
      const tag = ch.tagName, lower = tag.toLowerCase();
      counts[lower] = (counts[lower] || 0) + 1;
      const seg = lower + ':nth-of-type(' + counts[lower] + ')';
      const loc = ch.sourceCodeLocation;
      if (lower === 'script' || lower === 'style') {
        if (loc && loc.startTag) (lower === 'script' ? scripts : styles).push([loc.startTag.endOffset, loc.endTag ? loc.endTag.startOffset : loc.endOffset]);
        continue;
      }
      if (lower === 'template' || lower === 'noscript') continue;   // 模板内容由脚本克隆、noscript 在开着脚本时不显示
      let mine = parentLoc;
      const path = lower === 'html' ? [] : lower === 'body' || lower === 'head' ? [lower] : segs.concat(seg);
      if (!STRUCT.has(lower) && loc && loc.startTag) {
        const st = loc.startTag, openStart = st.startOffset, openEnd = st.endOffset;
        const attrMap = {};
        ch.attrs.forEach((a) => { if (!(a.name in attrMap)) attrMap[a.name] = a.value; });
        let lastAttrEnd = -1;
        Object.values(st.attrs || {}).forEach((a) => { lastAttrEnd = Math.max(lastAttrEnd, a.endOffset); });
        // 门牌号插在 ">" 前；"/>" 且斜杠不属于属性值时插在斜杠前（保住 SVG 的自闭合）
        let insertAt = openEnd - 1;
        if (src[openEnd - 2] === '/' && lastAttrEnd <= openEnd - 2) insertAt = openEnd - 2;
        const hasEl = ch.childNodes.some((c) => c.tagName);
        const isVoid = VOID.has(lower) || (!loc.endTag && !ch.childNodes.length && (loc.endOffset == null || loc.endOffset <= openEnd));
        const closeStart = loc.endTag ? loc.endTag.startOffset : Math.max(openEnd, loc.endOffset == null ? openEnd : loc.endOffset);
        const closeEnd = loc.endTag ? loc.endTag.endOffset : closeStart;
        const el = {
          loc: elements.length, tag: lower, openStart, openEnd, closeStart, closeEnd, insertAt, isVoid,
          attrs: src.slice(openStart + 1 + tag.length, openEnd - 1), attrMap,
          id: attrMap.id != null ? attrMap.id : null, style: attrMap.style || '',
          classes: (attrMap.class || '').split(/\s+/).filter(Boolean),
          text: src.slice(openEnd, closeStart),
          textOnly: !isVoid && !hasEl && ch.childNodes.every((c) => c.nodeName === '#text'),
          textNodes: ch.childNodes.filter((c) => c.nodeName === '#text').map((c) => (c.sourceCodeLocation ? [c.sourceCodeLocation.startOffset, c.sourceCodeLocation.endOffset] : null)),
          selector: path.join(' > '), parent: parentLoc, inSvg: inSvg || lower === 'svg',
          line: lineOf(openStart), col: colOf(openStart), endLine: lineOf(Math.max(openStart, closeEnd - 1)), endCol: colOf(Math.max(openStart, closeEnd - 1)) + 1,
        };
        el.type = el.inSvg || IMAGE.has(lower) ? 'image' : CONTROL.has(lower) ? 'control' : el.textOnly && el.text.trim() ? 'text' : 'container';
        elements.push(el);
        mine = el.loc;
      }
      walk(ch, mine, path, inSvg || lower === 'svg');
    }
  }
  walk(doc, null, [], false);

  const classUsage = {};
  elements.forEach((el) => el.classes.forEach((c) => { classUsage[c] = (classUsage[c] || 0) + 1; }));
  const styleBodies = styles.map((r) => src.slice(r[0], r[1]));
  const css = analyzeCss(styleBodies.join('\n'));
  elements.forEach((el) => {
    el.sharedClasses = el.classes.filter((c) => classUsage[c] > 1);
    el.sharedClass = el.sharedClasses.length > 0;
    const names = new Set();
    css.rules.forEach((r) => { if (selectorMatches(el, r.selector)) r.animNames.forEach((a) => names.add(a)); });
    ((el.style.match(/animation(?:-name)?\s*:\s*([^;]+)/i) || [])[1] || '').split(/[\s,()]+/).forEach((t) => { if (/^[A-Za-z_][\w-]*$/.test(t)) names.add(t); });
    el.animNames = [...names].filter((a) => css.keyframes[a]);
    el.transformAnim = el.animNames.length > 0;
    el.jsDynamic = false;
  });
  const JS_REF = /getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)|querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  scripts.forEach(([a, b]) => {
    const body = src.slice(a, b);
    let m;
    while ((m = JS_REF.exec(body))) {
      const target = m[1] != null ? '#' + m[1] : lastCompound(m[2]);
      elements.forEach((el) => { if (compoundMatches(el, target)) el.jsDynamic = true; });
    }
  });
  const bySel = new Map();
  elements.forEach((el) => { if (!bySel.has(el.selector)) bySel.set(el.selector, el); });
  return {
    src, elements, scripts, styles, lineStarts, lineOf, colOf, classUsage, styleBodies,
    bySelector: (s) => bySel.get(s) || null,
    byLoc: (l) => elements[l] || null,
  };
}

// 给每个元素的开标签插入隐藏门牌号（只进预览，不写回源码）
export function instrument(html, parsed) {
  const p = parsed || parse(html);
  const cuts = p.elements.map((e) => [e.insertAt, e.loc]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let from = 0;
  for (const [at, loc] of cuts) { out.push(p.src.slice(from, at), ` ${LOC_ATTR}="${loc}"`); from = at; }
  out.push(p.src.slice(from));
  return out.join('');
}
