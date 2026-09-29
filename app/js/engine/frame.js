// frame.js —— 预览宿主：把页面源码渲染进 iframe（注入隐藏门牌号 data-loc，源码本身不动）。
// 双缓冲：改完代码后在后台那块 iframe 里渲染好、恢复滚动位置，再无闪烁地换到前台。
import { parse, instrument } from './parse.js';

function withBase(html, baseHref) {
  const inject = `<base href="${baseHref}"><style id="__cd_boot">*,*::before,*::after{transition:none!important}</style>`;
  const m = /<head[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + inject + html.slice(m.index + m[0].length);
  return inject + html;
}

function running(el) {
  try { return !!(el.getAnimations && el.getAnimations().some((a) => a.playState === 'running')); } catch { return false; }
}

export function createFrame(host, { baseHref = '/', onNavigate, onReady } = {}) {
  const frames = [0, 1].map(() => {
    const f = document.createElement('iframe');
    f.className = 'pf';
    f.setAttribute('title', '页面');
    host.appendChild(f);
    return f;
  });
  let active = 0, token = 0, destroyed = false;
  let source = '', parsed = parse('');
  const disposers = [];

  const cur = () => frames[active];
  const doc = () => { try { return cur().contentDocument; } catch { return null; } };
  const win = () => { try { return cur().contentWindow; } catch { return null; } };

  function render(src, { keepScroll = true, scroll = null } = {}) {
    const my = ++token;
    const nextSource = String(src);
    const nextParsed = parse(nextSource);
    const back = frames[1 - active];
    const prevWin = win();
    const pos = scroll || (keepScroll && prevWin ? { x: prevWin.scrollX, y: prevWin.scrollY } : { x: 0, y: 0 });
    return new Promise((resolve) => {
      back.onload = () => {
        if (my !== token || destroyed) return resolve(false);
        const w = back.contentWindow, d = back.contentDocument;
        try { w.scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' }); } catch { /* 忽略 */ }
        // 之后再有 load 说明页面自己跳走了（脚本改 location / 未拦截的链接）
        back.onload = () => {
          if (destroyed || back !== cur()) return;
          let href = '';
          try { href = back.contentWindow.location.href; } catch { /* 忽略 */ }
          if (href && href !== 'about:srcdoc' && onNavigate) onNavigate(href);
        };
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (my !== token || destroyed) return resolve(false);
          source = nextSource;
          parsed = nextParsed;
          back.classList.add('on');
          frames[active].classList.remove('on');
          const old = frames[active];
          // 焦点还留在换下去的那块 iframe 里的话，快捷键会失灵：交还给工作台
          if (document.activeElement === old) old.blur();
          active = 1 - active;
          setTimeout(() => { if (old !== cur()) { old.onload = null; old.srcdoc = '<!doctype html><title></title>'; } }, 60);
          setTimeout(() => { try { const b = d.getElementById('__cd_boot'); if (b) b.remove(); } catch { /* 忽略 */ } }, 450);
          if (onReady) onReady(api);
          resolve(true);
        }));
      };
      back.srcdoc = withBase(instrument(nextSource, nextParsed), baseHref);
    });
  }

  const api = {
    get source() { return source; },
    get parsed() { return parsed; },
    get doc() { return doc(); },
    get win() { return win(); },
    get iframe() { return cur(); },
    render,
    elByLoc(loc) { const d = doc(); return d ? d.querySelector(`[data-loc="${loc}"]`) : null; },
    // DOM 节点 → 最近的带门牌号元素（没有则返回 null，表示程序生成）
    owner(node) {
      for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
        if (n.hasAttribute && n.hasAttribute('data-loc')) return n;
        if (n.tagName === 'BODY') break;
      }
      return null;
    },
    locOf(elm) { return elm && elm.hasAttribute('data-loc') ? +elm.getAttribute('data-loc') : null; },
    // 几何快照：loc → 页面坐标矩形（跳过正在播动画的元素）
    snapRects() {
      const out = {}, d = doc(), w = win();
      if (!d || !w) return out;
      d.querySelectorAll('[data-loc]').forEach((e) => {
        if (running(e)) return;
        const r = e.getBoundingClientRect();
        out[e.getAttribute('data-loc')] = { x: r.left + w.scrollX, y: r.top + w.scrollY, w: r.width, h: r.height, tag: e.tagName.toLowerCase() };
      });
      return out;
    },
    // writeback.applyEdit 的波及度量：隐藏 iframe 同步渲染改前/改后，对比谁被挤动
    makeMeasure(getSize) {
      let mf = null, cache = { src: null, map: null };
      const ensure = () => {
        if (mf && mf.isConnected) return mf;
        mf = document.createElement('iframe');
        mf.setAttribute('aria-hidden', 'true');
        mf.style.cssText = 'position:fixed;left:-99999px;top:0;border:0;visibility:hidden;pointer-events:none';
        document.body.appendChild(mf);
        disposers.push(() => mf && mf.remove());
        return mf;
      };
      const snapIn = (f, html) => {
        const d = f.contentDocument;
        d.open(); d.write(withBase(html, baseHref)); d.close();
        const out = {};
        d.querySelectorAll('[data-loc]').forEach((e) => {
          if (running(e)) return;
          const r = e.getBoundingClientRect();
          out[e.getAttribute('data-loc')] = { x: r.left, y: r.top, w: r.width, h: r.height, tag: e.tagName.toLowerCase() };
        });
        return out;
      };
      return function measure(ctx) {
        try {
          const f = ensure();
          const { w, h } = getSize();
          f.style.width = w + 'px';
          f.style.height = h + 'px';
          if (cache.src !== ctx.source) cache = { src: ctx.source, map: snapIn(f, instrument(ctx.source)) };
          const pa = parse(ctx.newSource);
          return collateral(cache.map, snapIn(f, instrument(ctx.newSource, pa)), ctx.target.loc, pa);
        } catch { return null; }
      };
    },
    destroy() {
      destroyed = true;
      frames.forEach((f) => { f.onload = null; f.remove(); });
      disposers.forEach((fn) => { try { fn(); } catch { /* 忽略 */ } });
    },
  };
  return api;
}

// 波及对比：排除目标自身、祖先、子孙；祖先和后代都被挤时只报祖先
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
      moved.push({ loc, selector: e ? e.selector : null, line: e ? e.line : null, tag: e ? e.tag : null, dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y), note: '被挤动（排版让位）' });
    }
  });
  return moved.filter((m) => !moved.some((o) => o !== m && isAnc(o.loc, m.loc)));
}
