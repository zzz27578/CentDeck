// frame.js —— 预览宿主：把页面源码渲染进 iframe（注入隐藏门牌号 data-cd-loc，源码本身不动）。
// 双缓冲：改完代码后在后台那块 iframe 里渲染好、恢复滚动位置，再无闪烁地换到前台。
import { parse, instrument } from './parse.js';

// 注入 <base>（让相对路径的图片、样式照常加载）和开场禁用过渡的样式；
// 没有 <head> 的页面插在 doctype 后面，绝不能插到 doctype 前（会让页面进入怪异模式、排版变样）
export function withBase(html, baseHref, extra = '') {
  const inject = `<base href="${baseHref}"><style id="__cd_boot">*,*::before,*::after{transition:none!important}</style>${extra}`;
  const m = /<head(?=[\s>/])[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + inject + html.slice(m.index + m[0].length);
  const d = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html);
  return d ? html.slice(0, d[0].length) + inject + html.slice(d[0].length) : inject + html;
}

function running(el) {
  try { return !!(el.getAnimations && el.getAnimations().some((a) => a.playState === 'running')); } catch { return false; }
}

// Browsers suspend requestAnimationFrame in background tabs. Rendering must
// still finish so a remote page operation does not hold the command queue.
export function afterPaint(callback) {
  let settled=false,frame,timer;
  const done=()=>{if(settled)return;settled=true;clearTimeout(timer);cancelAnimationFrame(frame);callback();};
  frame=requestAnimationFrame(done);timer=setTimeout(done,80);
}

export function createFrame(host, { baseHref = '/', onNavigate, onReady } = {}) {
  const frames = [0, 1].map(() => {
    const f = document.createElement('iframe');
    f.className = 'pf';
    f.setAttribute('title', '页面');
    host.appendChild(f);
    return f;
  });
  let active = 0, token = 0, destroyed = false, dupLocs = new Set();
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
        afterPaint(() => afterPaint(() => {
          if (my !== token || destroyed) return resolve(false);
          source = nextSource;
          parsed = nextParsed;
          // 同一个门牌号出现多次：浏览器为了修正交叉嵌套的标签复制了元素，这些地方不能按位置直接写回
          const seen = new Set();
          dupLocs = new Set();
          d.querySelectorAll('[data-cd-loc]').forEach((e) => { const v = e.getAttribute('data-cd-loc'); if (seen.has(v)) dupLocs.add(+v); else seen.add(v); });
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
    elByLoc(loc) { const d = doc(); return d ? d.querySelector(`[data-cd-loc="${loc}"]`) : null; },
    isDup(loc) { return dupLocs.has(loc); },
    // DOM 节点 → 最近的带门牌号元素（没有则返回 null，表示程序生成）
    owner(node) {
      for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
        if (n.hasAttribute && n.hasAttribute('data-cd-loc')) return n;
        if (n.tagName === 'BODY') break;
      }
      return null;
    },
    locOf(elm) { return elm && elm.hasAttribute('data-cd-loc') ? +elm.getAttribute('data-cd-loc') : null; },
    // 几何快照：loc → 页面坐标矩形（跳过正在播动画的元素）
    snapRects() {
      const out = {}, d = doc(), w = win();
      if (!d || !w) return out;
      d.querySelectorAll('[data-cd-loc]').forEach((e) => {
        if (running(e)) return;
        const r = e.getBoundingClientRect();
        out[e.getAttribute('data-cd-loc')] = { x: r.left + w.scrollX, y: r.top + w.scrollY, w: r.width, h: r.height, tag: e.tagName.toLowerCase() };
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
        d.querySelectorAll('[data-cd-loc]').forEach((e) => {
          if (running(e)) return;
          const r = e.getBoundingClientRect();
          out[e.getAttribute('data-cd-loc')] = { x: r.left, y: r.top, w: r.width, h: r.height, tag: e.tagName.toLowerCase() };
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
