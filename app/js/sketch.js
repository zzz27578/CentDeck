// sketch.js —— 内置插件：草图模式
// 在编辑视图的 iframe 上铺透明覆盖层（鼠标事件走覆盖层，不碰页面）：
//   虚影拖动（拖半透明影子到目标位）、画笔（自由线）、箭头、框选、文字便签钉在元素上。
// 标记锚定：{ id, page, selector, offset, type, data, text, done } 存 project.json.marks；
// 渲染时按 selector 找当前 rect 重定位；找不到元素 → 留在最后位置并标"可能漂移"。
// 红灯/黄灯转来的标记自动带：对象描述、源码行号、用户意图。

import { el, esc, uid, toast, openModal, copyText, confirmDlg } from './ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function setup(ctx) {
  const { bus } = ctx;
  let active = false;     // 草图模式开关
  let tool = 'pen';       // pen | arrow | rect | ghost | note
  let overlay = null;     // 覆盖层根（含 SVG + HTML 层）
  let svgEl = null;
  let htmlLayer = null;
  let toolbarEl = null;
  let ghost = null;       // 进行中的虚影拖动
  let drawing = null;     // 进行中的笔画/箭头/框选

  // ---------- 标记存取 ----------
  function marks() {
    const p = ctx.project();
    if (!p) return [];
    if (!Array.isArray(p.marks)) p.marks = [];
    return p.marks;
  }
  function pageMarks() {
    const page = ctx.editor.page;
    return marks().filter((m) => m.page === page);
  }

  // ---------- 覆盖层几何 ----------
  function overlayRect() { return overlay ? overlay.getBoundingClientRect() : null; }
  // 屏幕坐标 → 覆盖层坐标
  function toLocal(e) {
    const r = overlayRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  // 页面上某 selector 的当前覆盖层矩形（锚定重定位）
  function rectOf(selector) {
    const r = ctx.rectOfSelector(selector);
    if (!r) return null;
    const o = overlayRect();
    return { x: r.x - o.left, y: r.y - o.top, w: r.w, h: r.h };
  }
  // 覆盖层坐标 → 锚定信息（找覆盖层下对应页面元素）
  function anchorAt(clientX, clientY) {
    const session = ctx.editor.session;
    if (!session || !session.document) return null;
    const fr = ctx.editor.iframeRect();
    const doc = session.document;
    // elementFromPoint 用 iframe 视口坐标
    const node = doc.elementFromPoint(clientX - fr.left, clientY - fr.top);
    if (!node || node === doc.body || node === doc.documentElement) return null;
    const withLoc = node.hasAttribute('data-loc') ? node : node.closest('[data-loc]');
    if (!withLoc) {
      return { selector: null, loc: null, generated: true, tag: node.tagName.toLowerCase() };
    }
    const loc = +withLoc.getAttribute('data-loc');
    const info = session.parsed.byLoc(loc);
    const r = withLoc.getBoundingClientRect();
    return {
      selector: info.selector,
      loc,
      line: info.line,
      tag: info.tag,
      // 相对元素左上角的偏移比例（元素大小变化时按比例贴）
      offset: {
        px: r.width ? (clientX - fr.left - r.left) / r.width : 0,
        py: r.height ? (clientY - fr.top - r.top) / r.height : 0,
      },
    };
  }

  // ---------- 覆盖层搭建 ----------
  function buildOverlay() {
    const stage = document.querySelector('#stage');
    if (!stage || overlay) return;
    overlay = el(`<div class="sketch-overlay">
      <svg class="sketch-svg"></svg>
      <div class="sketch-html"></div>
      <div class="sketch-bar">
        <span class="sketch-mode-tag">草图模式</span>
        <button data-tool="pen" title="自由画笔">✏️ 画笔</button>
        <button data-tool="arrow" title="画箭头">➹ 箭头</button>
        <button data-tool="rect" title="框选一块区域">▭ 框选</button>
        <button data-tool="ghost" title="把元素影子拖到想要的位置（不改代码）">👻 虚影拖动</button>
        <button data-tool="note" title="点一个元素，钉一句要求">📝 文字便签</button>
        <span class="sketch-bar-gap"></span>
        <button id="sk-export" title="把所有标记整理成任务单">📋 导出任务单</button>
        <button id="sk-exit" title="退出草图模式（Esc）">退出草图</button>
      </div>
    </div>`);
    svgEl = overlay.querySelector('.sketch-svg');
    htmlLayer = overlay.querySelector('.sketch-html');
    toolbarEl = overlay.querySelector('.sketch-bar');
    stage.appendChild(overlay);
    toolbarEl.querySelectorAll('button[data-tool]').forEach((b) => {
      b.onclick = () => setTool(b.dataset.tool);
    });
    overlay.querySelector('#sk-exit').onclick = () => setActive(false);
    overlay.querySelector('#sk-export').onclick = exportTaskSheet;
    overlay.addEventListener('mousedown', onDown);
    setTool(tool);
    renderMarks();
  }

  function destroyOverlay() {
    if (overlay) overlay.remove();
    overlay = svgEl = htmlLayer = toolbarEl = null;
    ghost = drawing = null;
  }

  function setTool(t) {
    tool = t;
    if (toolbarEl) {
      toolbarEl.querySelectorAll('button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    }
    if (overlay) overlay.dataset.tool = t;
  }

  function setActive(on) {
    if (on && ctx.view() !== 'edit') {
      toast('草图模式在编辑视图里使用（先切到"编辑"）', 'err');
      return;
    }
    active = on;
    document.body.classList.toggle('sketch-on', on);
    if (on) buildOverlay();
    else destroyOverlay();
    bus.emit('sketch', on);
  }

  // ---------- 标记渲染（锚定重定位） ----------
  function markBaseRect(m) {
    // 优先按 selector 找当前位置；找不到 → 用最后位置 + 漂移标记
    if (m.selector) {
      const r = rectOf(m.selector);
      if (r) {
        m._drift = false;
        m._last = { x: r.x, y: r.y, w: r.w, h: r.h };
        return r;
      }
      m._drift = true;
      return m._last || null;
    }
    m._drift = false;
    return m._last || null;
  }

  function renderMarks() {
    if (!svgEl) return;
    // 清掉旧标记（保留 defs）
    svgEl.querySelectorAll('.sk-mark').forEach((n) => n.remove());
    htmlLayer.querySelectorAll('.sk-pin,.sk-note-card,.sk-ghostbox').forEach((n) => n.remove());
    pageMarks().forEach((m) => {
      const base = markBaseRect(m);
      if (!base) return;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'sk-mark' + (m.done ? ' done' : '') + (m._drift ? ' drift' : ''));
      const ox = m.offset ? base.x + m.offset.px * base.w - base.x : 0; // 锚点相对 base 的偏移
      const oy = m.offset ? base.y + m.offset.py * base.h - base.y : 0;
      const dx = base.x + ox, dy = base.y + oy;
      if (m.type === 'pen' || m.type === 'arrow') {
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', m.data.d);
        path.setAttribute('transform', `translate(${dx},${dy})`);
        g.appendChild(path);
        if (m.type === 'arrow') {
          const head = document.createElementNS(SVGNS, 'path');
          head.setAttribute('d', arrowHead(m.data));
          head.setAttribute('transform', `translate(${dx},${dy})`);
          head.setAttribute('class', 'sk-arrow-head');
          g.appendChild(head);
        }
      } else if (m.type === 'rect') {
        const r = document.createElementNS(SVGNS, 'rect');
        r.setAttribute('x', dx + m.data.x);
        r.setAttribute('y', dy + m.data.y);
        r.setAttribute('width', m.data.w);
        r.setAttribute('height', m.data.h);
        g.appendChild(r);
      } else if (m.type === 'ghost') {
        const box = el(`<div class="sk-ghostbox ${m.done ? 'done' : ''}" style="left:${dx + m.data.toX}px;top:${dy + m.data.toY}px;width:${m.data.w}px;height:${m.data.h}px">
          <span>虚影：把「${esc(m.data.tag || '元素')}」挪到这里</span></div>`);
        htmlLayer.appendChild(box);
        const line = document.createElementNS(SVGNS, 'line');
        line.setAttribute('x1', dx + m.data.fromX + m.data.w / 2);
        line.setAttribute('y1', dy + m.data.fromY + m.data.h / 2);
        line.setAttribute('x2', dx + m.data.toX + m.data.w / 2);
        line.setAttribute('y2', dy + m.data.toY + m.data.h / 2);
        line.setAttribute('class', 'sk-ghost-line');
        g.appendChild(line);
      }
      svgEl.appendChild(g);
      // 图钉（所有类型都有）：点开编辑/打勾/删除
      const pin = el(`<button class="sk-pin ${m.done ? 'done' : ''} ${m._drift ? 'drift' : ''}" style="left:${dx}px;top:${dy}px" title="${m._drift ? '锚点元素找不到了，位置可能漂移\n' : oldTitle(m)}">${m.done ? '✓' : '📌'}</button>`);
      pin.addEventListener('mousedown', (e) => e.stopPropagation());
      pin.onclick = (e) => { e.stopPropagation(); openMarkCard(m, pin); };
      htmlLayer.appendChild(pin);
    });
  }

  function oldTitle(m) { return (m.text || '（没写要求）') + '\n点开编辑'; }

  function arrowHead(d) {
    // 由终点与倒数第二个点算箭头两翼
    const p = d.points;
    if (!p || p.length < 2) return '';
    const [x2, y2] = p[p.length - 1];
    const [x1, y1] = p[p.length - 2];
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const L = 12;
    const a1 = ang + Math.PI * 0.82, a2 = ang - Math.PI * 0.82;
    return `M ${x2} ${y2} L ${x2 + L * Math.cos(a1)} ${y2 + L * Math.sin(a1)} M ${x2} ${y2} L ${x2 + L * Math.cos(a2)} ${y2 + L * Math.sin(a2)}`;
  }

  // ---------- 标记卡片（编辑要求 / 打勾 / 删除） ----------
  let openCard = null;
  function openMarkCard(m, pinEl) {
    if (openCard) openCard.remove();
    const card = el(`<div class="sk-note-card">
      <div class="sk-card-head">${esc(m.auto ? '自动标记（来自判定）' : '草图标记')} ${m._drift ? '<span class="drift-tag">可能漂移</span>' : ''}</div>
      ${m.meta ? `<div class="sk-card-meta">${esc(m.meta)}</div>` : ''}
      <textarea rows="3" placeholder="写一句要求，比如：把这个按钮挪到这里，换成品牌色">${esc(m.text || '')}</textarea>
      <div class="sk-card-acts">
        <button class="btn small primary">保存</button>
        <button class="btn small">${m.done ? '取消完成' : '打勾完成'}</button>
        <button class="btn small danger">删除</button>
      </div>
    </div>`);
    const pr = pinEl.getBoundingClientRect();
    const or = overlayRect();
    card.style.left = Math.min(pr.left - or.left + 20, or.width - 280) + 'px';
    card.style.top = (pr.top - or.top + 20) + 'px';
    card.addEventListener('mousedown', (e) => e.stopPropagation());
    const [saveB, doneB, delB] = card.querySelectorAll('button');
    const ta = card.querySelector('textarea');
    saveB.onclick = async () => {
      const v = ta.value.trim();
      await bus.doMeta({
        label: '修改标记要求',
        apply: () => { m.text = v; },
        revert: () => { m.text = m.text || ''; },
      });
      card.remove();
      renderMarks();
    };
    doneB.onclick = async () => {
      const was = m.done;
      await bus.doMeta({
        label: was ? '取消标记完成' : '标记打勾完成',
        apply: () => { m.done = !was; },
        revert: () => { m.done = was; },
      });
      card.remove();
      renderMarks();
    };
    delB.onclick = async () => {
      const ok = await confirmDlg({ title: '删除标记', body: '确定删除这条标记吗？', okLabel: '删除', danger: true });
      if (!ok) return;
      const list = marks();
      const i = list.indexOf(m);
      await bus.doMeta({
        label: '删除草图标记',
        apply: () => { const j = list.indexOf(m); if (j >= 0) list.splice(j, 1); },
        revert: () => { list.splice(Math.min(i, list.length), 0, m); },
      });
      card.remove();
      renderMarks();
    };
    htmlLayer.appendChild(card);
    openCard = card;
    ta.focus();
  }

  // ---------- 新建标记 ----------
  async function addMark(mark) {
    const list = marks();
    await bus.doMeta({
      label: '新增草图标记',
      apply: () => { list.push(mark); },
      revert: () => { const i = list.indexOf(mark); if (i >= 0) list.splice(i, 1); },
    });
    renderMarks();
    return mark;
  }

  // ---------- 覆盖层鼠标交互 ----------
  function onDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.sk-pin') || e.target.closest('.sk-note-card') || e.target.closest('.sk-bar')) return;
    e.preventDefault();
    if (openCard) { openCard.remove(); openCard = null; }
    const p0 = toLocal(e);

    if (tool === 'note') {
      const a = anchorAt(e.clientX, e.clientY);
      if (!a || !a.selector) { toast('点在某个具体内容上，便签才能钉住它', 'err'); return; }
      const m = {
        id: uid('mk'), page: ctx.editor.page, type: 'note',
        selector: a.selector, offset: a.offset, text: '', done: false,
        meta: `<${a.tag}> 第 ${a.line} 行`,
      };
      addMark(m).then(() => {
        const pin = htmlLayer.querySelector('.sk-pin:last-child');
        if (pin) openMarkCard(m, pin);
      });
      return;
    }

    if (tool === 'ghost') {
      const a = anchorAt(e.clientX, e.clientY);
      if (!a || !a.selector) { toast('虚影拖动要从一个具体元素上开始拖', 'err'); return; }
      const r = rectOf(a.selector);
      if (!r) return;
      ghost = {
        anchor: a, base: r, start: p0,
        box: el(`<div class="sk-ghostbox dragging" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><span>拖到想要的位置，松手记下</span></div>`),
      };
      htmlLayer.appendChild(ghost.box);
      window.addEventListener('mousemove', onGhostMove);
      window.addEventListener('mouseup', onGhostUp, { once: true });
      return;
    }

    // pen / arrow / rect：开始画
    drawing = { type: tool, start: p0, points: [[p0.x, p0.y]], node: null };
    if (tool === 'pen' || tool === 'arrow') {
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('class', 'sk-mark drawing');
      svgEl.appendChild(path);
      drawing.node = path;
    } else {
      const rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('class', 'sk-mark drawing');
      svgEl.appendChild(rect);
      drawing.node = rect;
    }
    window.addEventListener('mousemove', onDrawMove);
    window.addEventListener('mouseup', onDrawUp, { once: true });
  }

  function onGhostMove(e) {
    if (!ghost) return;
    const p = toLocal(e);
    const dx = p.x - ghost.start.x, dy = p.y - ghost.start.y;
    ghost.box.style.left = ghost.base.x + dx + 'px';
    ghost.box.style.top = ghost.base.y + dy + 'px';
    ghost.dx = dx;
    ghost.dy = dy;
  }
  async function onGhostUp() {
    window.removeEventListener('mousemove', onGhostMove);
    if (!ghost) return;
    const g = ghost;
    ghost = null;
    if (g.dx == null || (Math.abs(g.dx) < 4 && Math.abs(g.dy) < 4)) { g.box.remove(); return; }
    const a = g.anchor;
    await addMark({
      id: uid('mk'), page: ctx.editor.page, type: 'ghost',
      selector: a.selector, offset: { px: 0, py: 0 }, text: '', done: false,
      meta: `<${a.tag}> 第 ${a.line} 行 · 从原位向右 ${Math.round(g.dx)}、向下 ${Math.round(g.dy)}`,
      data: {
        tag: a.tag,
        fromX: 0, fromY: 0,
        toX: Math.round(g.dx), toY: Math.round(g.dy),
        w: Math.round(g.base.w), h: Math.round(g.base.h),
      },
    });
  }

  function onDrawMove(e) {
    if (!drawing) return;
    const p = toLocal(e);
    if (drawing.type === 'rect') {
      const x = Math.min(drawing.start.x, p.x), y = Math.min(drawing.start.y, p.y);
      drawing.node.setAttribute('x', x);
      drawing.node.setAttribute('y', y);
      drawing.node.setAttribute('width', Math.abs(p.x - drawing.start.x));
      drawing.node.setAttribute('height', Math.abs(p.y - drawing.start.y));
      drawing.rect = { x, y, w: Math.abs(p.x - drawing.start.x), h: Math.abs(p.y - drawing.start.y) };
    } else {
      drawing.points.push([p.x, p.y]);
      drawing.node.setAttribute('d', pointsToD(drawing.points));
    }
  }
  async function onDrawUp(e) {
    window.removeEventListener('mousemove', onDrawMove);
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (d.node) d.node.remove();
    const pEnd = toLocal(e);
    const anchor = anchorAt(e.clientX, e.clientY) || anchorAt(
      overlayRect().left + d.start.x, overlayRect().top + d.start.y
    );
    if (!anchor || !anchor.selector) {
      toast('这一笔没有落在具体内容上，没记下；请画在页面元素附近', 'err');
      return;
    }
    if (d.type === 'rect') {
      if (!d.rect || d.rect.w < 6 || d.rect.h < 6) return;
      // 框选：坐标转成相对锚点的偏移
      const base = rectOf(anchor.selector);
      const ax = base ? base.x + anchor.offset.px * base.w : d.start.x;
      const ay = base ? base.y + anchor.offset.py * base.h : d.start.y;
      await addMark({
        id: uid('mk'), page: ctx.editor.page, type: 'rect',
        selector: anchor.selector, offset: anchor.offset, text: '', done: false,
        meta: `<${anchor.tag}> 第 ${anchor.line} 行 · 框选了一块区域`,
        data: { x: Math.round(d.rect.x - ax), y: Math.round(d.rect.y - ay), w: Math.round(d.rect.w), h: Math.round(d.rect.h) },
      });
    } else {
      if (d.points.length < 3 && d.type === 'pen') return;
      if (d.type === 'arrow') d.points = [d.start ? [d.start.x, d.start.y] : d.points[0], [pEnd.x, pEnd.y]];
      const base = rectOf(anchor.selector);
      const ax = base ? base.x + anchor.offset.px * base.w : 0;
      const ay = base ? base.y + anchor.offset.py * base.h : 0;
      const rel = d.points.map(([x, y]) => [Math.round(x - ax), Math.round(y - ay)]);
      await addMark({
        id: uid('mk'), page: ctx.editor.page, type: d.type,
        selector: anchor.selector, offset: anchor.offset, text: '', done: false,
        meta: `<${anchor.tag}> 第 ${anchor.line} 行 · ${d.type === 'arrow' ? '箭头' : '画笔'}`,
        data: { d: pointsToD(rel), points: rel },
      });
    }
  }

  function pointsToD(points) {
    return points.map(([x, y], i) => (i ? 'L' : 'M') + Math.round(x) + ' ' + Math.round(y)).join(' ');
  }

  // ---------- 导出任务单 ----------
  async function exportTaskSheet() {
    const proj = ctx.project();
    const list = marks().filter((m) => !m.done);
    if (!list.length) { toast('还没有未完成的标记', 'err'); return; }
    // 逐条生成 Markdown：页面、元素描述、代码文件与行号、源码前后片段摘录、用户要求
    const pageSrcCache = new Map();
    async function srcOf(page) {
      if (!pageSrcCache.has(page)) {
        try { pageSrcCache.set(page, await ctxApi.readFile(proj.id, page)); }
        catch { pageSrcCache.set(page, ''); }
      }
      return pageSrcCache.get(page);
    }
    const { api: ctxApi } = await import('./api.js');
    const { parse } = await import('./engine/parse.js');
    const lines = [];
    lines.push(`# 任务单 · ${proj.name}`);
    lines.push('');
    lines.push(`> 由 CentDeck 草图标记生成，共 ${list.length} 条。每条都标了精确的代码位置，请按"用户要求"修改对应文件，只动相关片段，别的不动。`);
    lines.push('');
    lines.push(`项目页面：${proj.pages.map((p) => `${p.title}（${p.file}）`).join('、')}`);
    lines.push('');
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const pageTitle = (proj.pages.find((p) => p.file === m.page) || {}).title || m.page;
      lines.push(`## ${i + 1}. ${typeName(m.type)} · ${pageTitle}`);
      lines.push('');
      lines.push(`- 文件：\`${m.page}\``);
      let excerpt = '';
      if (m.selector) {
        const src = await srcOf(m.page);
        if (src) {
          const parsed = parse(src);
          const info = parsed.bySelector(m.selector);
          if (info) {
            lines.push(`- 元素：<${info.tag}>（第 ${info.line}${info.endLine > info.line ? '–' + info.endLine : ''} 行）`);
            const srcLines = src.split('\n');
            const from = Math.max(0, info.line - 2);
            const to = Math.min(srcLines.length, info.endLine + 1);
            excerpt = srcLines.slice(from, to).map((l, k) => `${from + k + 1}: ${l}`).join('\n');
          }
        }
      }
      if (m.meta) lines.push(`- 位置说明：${m.meta}`);
      if (m._drift) lines.push(`- 注意：锚点元素当前找不到，位置可能漂移，请按"位置说明"人工确认。`);
      if (excerpt) {
        lines.push('- 相关源码片段：');
        lines.push('```html');
        lines.push(excerpt);
        lines.push('```');
      }
      lines.push(`- 用户要求：${m.text ? m.text : '（没写，按图意理解）'}`);
      lines.push('');
    }
    const md = lines.join('\n');
    const body = el(`<div class="task-sheet">
      <p class="panel-note">下面这份任务单可以直接粘贴给任何 AI。位置已精确到代码行，只附相关片段。</p>
      <textarea readonly rows="16">${esc(md)}</textarea>
    </div>`);
    openModal({
      title: `任务单（${list.length} 条标记）`,
      width: 720,
      body,
      actions: [
        { label: '关闭' },
        {
          label: '复制到剪贴板', kind: 'primary', onClick: async (close) => {
            const ok = await copyText(md);
            toast(ok ? '已复制，去粘贴给你的 AI 吧' : '复制失败，请手动全选复制', ok ? 'ok' : 'err');
            if (ok) close();
          },
        },
      ],
    });
  }

  function typeName(t) {
    return { pen: '画笔圈画', arrow: '箭头', rect: '框选区域', ghost: '虚影移动', note: '文字便签', verdict: '修改受阻' }[t] || t;
  }

  // ---------- 红/黄灯转标记（内核经命令总线调用） ----------
  bus.registerCommand('sketch.markFromVerdict', async (c, result, extra = {}) => {
    const proj = c.project();
    if (!proj) return;
    const page = c.editor.page;
    const list = marks();
    const sel = result.selector || (c.editor.selection && c.editor.selection.selector) || null;
    const info = sel && c.editor.session ? c.editor.session.parsed.bySelector(sel) : null;
    const m = {
      id: uid('mk'), page, type: 'verdict',
      selector: sel, offset: { px: 0.5, py: 0 }, text: '', done: false, auto: true,
      meta: `${extra.label || '修改'}受阻：${(result.reason || '').slice(0, 80)}${info ? `（<${info.tag}> 第 ${info.line} 行）` : ''}`,
      data: { fromX: 0, fromY: 0, toX: 0, toY: 0, w: 80, h: 30, tag: info ? info.tag : '' },
    };
    await bus.doMeta({
      label: '判定转为草图标记',
      apply: () => { list.push(m); },
      revert: () => { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); },
    });
    toast('已记成草图标记，攒一批后"导出任务单"交给 AI', 'ok', 4200);
    if (active) renderMarks();
  });

  // ---------- 面板：标记列表 ----------
  bus.registerPanel({
    id: 'marks',
    title: '标记',
    icon: '📌',
    side: 'left',
    render(host) {
      const proj = ctx.project();
      if (!proj) { host.innerHTML = '<div class="panel-empty">先打开一个项目</div>'; return; }
      const list = marks();
      host.innerHTML = '';
      const bar = el(`<div class="panel-actions">
        <button class="btn small ${active ? 'on' : ''}" id="mk-toggle">${active ? '退出草图模式' : '进入草图模式'}</button>
        <button class="btn small" id="mk-export">导出任务单（${list.filter((m) => !m.done).length}）</button>
      </div>`);
      bar.querySelector('#mk-toggle').onclick = () => { setActive(!active); };
      bar.querySelector('#mk-export').onclick = exportTaskSheet;
      host.appendChild(bar);
      if (!list.length) {
        host.insertAdjacentHTML('beforeend', '<div class="panel-empty">还没有标记。<br><small>进入草图模式，用画笔/箭头/框选/虚影拖动画出来；修改遇红灯也会自动记到这里。</small></div>');
        return;
      }
      const wrap = el('<div class="mark-list"></div>');
      list.forEach((m) => {
        const pageTitle = (proj.pages.find((p) => p.file === m.page) || {}).title || m.page;
        const item = el(`<div class="mark-item ${m.done ? 'done' : ''}">
          <label class="mark-check"><input type="checkbox" ${m.done ? 'checked' : ''}></label>
          <div class="mark-main">
            <div class="mark-type">${esc(typeName(m.type))} · ${esc(pageTitle)}${m.auto ? ' · 自动' : ''}</div>
            <div class="mark-text">${esc(m.text || m.meta || '（没写要求）')}</div>
          </div>
          <button class="mark-del" title="删除">×</button>
        </div>`);
        item.querySelector('input').onchange = async (e) => {
          const v = e.target.checked;
          await bus.doMeta({
            label: v ? '标记打勾完成' : '取消标记完成',
            apply: () => { m.done = v; },
            revert: () => { m.done = !v; },
          });
          item.classList.toggle('done', v);
          if (active) renderMarks();
        };
        item.querySelector('.mark-del').onclick = async () => {
          const ok = await confirmDlg({ title: '删除标记', body: '确定删除这条标记吗？', okLabel: '删除', danger: true });
          if (!ok) return;
          const i = list.indexOf(m);
          await bus.doMeta({
            label: '删除草图标记',
            apply: () => { const j = list.indexOf(m); if (j >= 0) list.splice(j, 1); },
            revert: () => { list.splice(Math.min(i, list.length), 0, m); },
          });
          item.remove();
          if (active) renderMarks();
        };
        wrap.appendChild(item);
      });
      host.appendChild(wrap);
    },
  });

  // ---------- 工具栏开关 ----------
  bus.registerToolbarAction({
    id: 'sketch-toggle',
    title: '草图',
    icon: '✏️',
    when: (c) => c.view() === 'edit',
    onClick: () => setActive(!active),
  });

  // 视图切换/重渲染时关闭或重挂覆盖层
  bus.on('view', (v) => { if (active && v !== 'edit') setActive(false); });
  bus.on('rendered', () => {
    if (!active) return;
    // 页面重渲染后覆盖层尺寸不变，但锚点位置要重算
    renderMarks();
  });
  // iframe 滚动时标记跟着走
  setInterval(() => { if (active && overlay && ctx.view() === 'edit') renderMarks(); }, 250);
}
