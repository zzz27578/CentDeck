// 页面结构扫描（纯静态、不跑脚本）：跳转链接及触发按钮、页内锚点、版块、弹窗及打开它的按钮、自动跳转
import { parse, attr } from '../engine/parse.js';

const POPUP_RE = /(^|[\s_-])(modal|dialog|popup|pop-up|drawer|lightbox|overlay|sheet|popover)([\s_-]|$)/i;
const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function resolveHref(fromFile, href, pageSet) {
  if (!href || /^(#|javascript:|mailto:|tel:|data:)/i.test(href) || /^[a-z]+:\/\//i.test(href) || href.startsWith('//')) return null;
  try {
    const u = new URL(href, 'http://cd.local/' + fromFile);
    const f = decodeURIComponent(u.pathname.slice(1));
    return pageSet.has(f) ? f : null;
  } catch { return null; }
}

export function scanPage(file, src, pageSet) {
  const p = parse(src);
  const els = p.elements;
  const inside = (e, tags) => { for (let q = e.parent; q != null; q = els[q].parent) if (tags.includes(els[q].tag)) return els[q]; return null; };
  const textOf = (e) => plain(src.slice(e.openEnd, e.closeStart)).slice(0, 40) || attr(e.attrs, 'aria-label') || attr(e.attrs, 'title') || '';
  const out = { file, title: (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src) || [])[1] || '', links: [], anchors: [], sections: [], popups: [], redirects: [] };
  const ids = new Map();
  els.forEach((e) => { if (e.id) ids.set(e.id, e); });

  // 弹窗：class/id/role 像弹窗、默认隐藏或本身是 <dialog>；只取最外层
  const cands = els.filter((e) => {
    if (e.tag === 'dialog') return true;
    const cls = (attr(e.attrs, 'class') || '') + ' ' + (e.id || '');
    const role = attr(e.attrs, 'role') || '';
    const hidden = /(^|\s)hidden(\s|=|$)/i.test(e.attrs) || /display\s*:\s*none/i.test(e.style) || /aria-hidden\s*=\s*"true"/i.test(e.attrs);
    return (POPUP_RE.test(cls) || /dialog/.test(role)) && (hidden || /^(div|section|aside)$/.test(e.tag));
  });
  const top = cands.filter((e) => !cands.some((o) => o !== e && isAncestor(els, o.loc, e.loc)));
  top.forEach((e) => {
    const head = els.find((h) => /^h[1-4]$/.test(h.tag) && isAncestor(els, e.loc, h.loc));
    out.popups.push({ loc: e.loc, id: e.id, title: (head && textOf(head)) || attr(e.attrs, 'aria-label') || e.id || '弹窗', triggers: [] });
  });
  const popById = new Map(out.popups.filter((x) => x.id).map((x) => [x.id, x]));

  els.forEach((e) => {
    const inPopup = out.popups.find((x) => x.loc === e.loc || isAncestor(els, x.loc, e.loc));
    // 打开弹窗的按钮
    const tgt = (attr(e.attrs, 'data-target') || attr(e.attrs, 'data-bs-target') || attr(e.attrs, 'aria-controls') || attr(e.attrs, 'popovertarget') || attr(e.attrs, 'data-modal') || attr(e.attrs, 'data-open') || '').replace(/^#/, '');
    const href = e.tag === 'a' ? attr(e.attrs, 'href') : null;
    let pop = tgt && popById.get(tgt);
    if (!pop && href && href.startsWith('#')) pop = popById.get(href.slice(1));
    if (!pop && /\sdata-open-modal(\s|=|$)/i.test(' ' + e.attrs)) {
      const v = attr(e.attrs, 'data-open-modal');
      pop = (v && popById.get(v.replace(/^#/, ''))) || (out.popups.length === 1 ? out.popups[0] : null);
    }
    if (!pop) { const oc = attr(e.attrs, 'onclick') || ''; pop = out.popups.find((x) => x.id && oc.includes(x.id)); }
    if (pop && !inPopup) pop.triggers.push({ loc: e.loc, text: textOf(e) });
    if (e.tag !== 'a' || !href) return;
    if (href.startsWith('#')) {
      const t = ids.get(decodeURIComponent(href.slice(1)));
      if (t && !popById.has(t.id)) out.anchors.push({ loc: e.loc, to: t.loc, text: textOf(e), target: t.id });
      return;
    }
    const to = resolveHref(file, href, pageSet);
    if (!to) return;
    const nav = !!inside(e, ['nav', 'header', 'footer']);
    out.links.push({ loc: e.loc, to, text: textOf(e), nav, inPopup: !!inPopup, self: to === file });
  });

  // 版块：主体里的 section / header / footer / article，或带 id 的大块
  els.forEach((e) => {
    if (!/^(section|header|footer|article|main)$/.test(e.tag)) return;
    if (out.popups.some((x) => isAncestor(els, x.loc, e.loc) || x.loc === e.loc)) return;
    if (e.tag === 'main' && els.some((c) => c.parent === e.loc && c.tag === 'section')) return;
    const head = els.find((h) => /^h[1-3]$/.test(h.tag) && isAncestor(els, e.loc, h.loc));
    const name = { header: '页眉', footer: '页脚', main: '主体' }[e.tag];
    out.sections.push({ loc: e.loc, id: e.id, tag: e.tag, title: (head && textOf(head)) || name || e.id || e.tag });
  });

  // 脚本跳转：location.href = / location.assign / replace；在 setTimeout 里算自动跳转
  p.scripts.forEach(([a, b]) => {
    const body = src.slice(a, b);
    const re = /location(?:\.href)?\s*=\s*['"]([^'"]+)['"]|location\.(?:assign|replace)\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(body))) {
      const to = resolveHref(file, m[1] || m[2], pageSet);
      if (!to) continue;
      const before = body.slice(Math.max(0, m.index - 400), m.index);
      const dm = /setTimeout\s*\(\s*(?:function|\()/.test(before) ? /\}\s*,\s*(\d{2,6})\s*\)/.exec(body.slice(m.index, m.index + 240)) : null;
      const timer = dm ? +dm[1] : null;
      const submit = /["']submit["']|onsubmit|\.submit\b/.test(body.slice(Math.max(0, m.index - 1600), m.index));
      out.redirects.push({ to, kind: timer ? 'timer' : submit ? 'submit' : 'script', delay: timer, line: p.lineOf(a + m.index) });
    }
  });
  const meta = /<meta[^>]+http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'](\d+)\s*;\s*url=([^"']+)["']/i.exec(src);
  if (meta) { const to = resolveHref(file, meta[2], pageSet); if (to) out.redirects.push({ to, kind: 'timer', delay: +meta[1] * 1000 }); }
  return out;
}

function isAncestor(els, a, b) {
  for (let q = els[b] && els[b].parent; q != null; q = els[q].parent) if (q === a) return true;
  return false;
}
