// 网页结构按实际渲染后的 DOM 列出，同时标明源码行号或动态元素。
import { el, esc } from '../core/ui.js';

export function renderPageStructure(app, host) {
  const paint = () => {
    const ed = app.editor;
    if (!ed.frame?.doc?.body) { host.innerHTML = '<div class="empty">打开一页后这里显示它的结构</div>'; return; }
    host.innerHTML = '<p class="hint" style="padding:12px">这是网页实际的盒子结构。行号表示源码位置；“动态”表示运行后生成或浏览器补出的元素。</p>';
    const byLoc = new Map(ed.frame.parsed.elements.map(e => [e.loc,e]));
    let count = 0;
    const walk = (parent, depth) => {
      for (const node of parent.children) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR)$/.test(node.tagName) || count >= 2000) continue;
        const loc = node.getAttribute('data-cd-loc'), source = loc == null ? null : byLoc.get(+loc);
        const name = node.tagName.toLowerCase();
        const text = [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0,28);
        const row = el(`<button class="list-row layer ${ed.sel === node ? 'on' : ''}" style="width:100%;text-align:left;padding-left:${10+Math.min(depth,16)*12}px"><span class="grow"><span class="t1">&lt;${esc(name)}&gt;${node.classList.length ? '.'+esc(node.classList[0]) : ''} ${esc(text)}</span></span><span class="t2">${source ? source.line : '动态'}</span></button>`);
        row.onclick = () => { ed.select(node); node.scrollIntoView({block:'center',behavior:'smooth'}); };
        host.appendChild(row); count++;
        if (name !== 'svg') walk(node,depth+1);
      }
    };
    walk(ed.frame.doc.body,0);
    if (!count) host.appendChild(el('<div class="empty">这一页没有可显示的元素</div>'));
  };
  paint();
  const off = [app.bus.on('select',() => host.isConnected && paint()),app.bus.on('rendered',() => host.isConnected && paint())];
  return () => off.forEach(fn => fn());
}
