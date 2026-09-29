(function () {
  var WB = window.WB, $ = WB.$;
  var cur = null;

  function esc(s) { return WB.esc(s == null ? '' : s); }
  function short(s) { s = String(s || '').trim().replace(/\s+/g, ' '); return s.length > 10 ? s.slice(0, 10) + '…' : s; }
  function arrowWords(dx, dy) {
    var a = [];
    if (dx) a.push((dx > 0 ? '向右 ' : '向左 ') + Math.abs(dx));
    if (dy) a.push((dy > 0 ? '向下 ' : '向上 ') + Math.abs(dy));
    return (a.join('、') || '原地') + ' 像素';
  }
  function rectStr(r) { return '(' + Math.round(r.x) + ', ' + Math.round(r.y) + ') 宽 ' + Math.round(r.w) + ' 高 ' + Math.round(r.h); }

  function snippetOf(info) {
    if (!info) return null;
    var lines = WB.state.source.split('\n'), out = [];
    for (var n = info.line; n <= Math.min(info.endLine, info.line + 4); n++) out.push(n + ' | ' + lines[n - 1].trim());
    if (info.endLine > info.line + 4) out.push('……');
    return out;
  }
  function targetInfo(el) {
    var info = WB.infoOf(el), t = short(el.textContent);
    return {
      desc: WB.describe(el),
      short: '<' + el.tagName.toLowerCase() + '>' + (t ? '「' + t + '」' : '') + (info ? ' 第 ' + info.line + ' 行' : ' 程序生成'),
      line: info ? info.line : null,
      snippet: snippetOf(info),
      rect: WB.pageRect(el)
    };
  }

  function makeGhost(el) {
    var c = el.cloneNode(true), cs = WB.win.getComputedStyle(el), r = WB.pageRect(el);
    c.removeAttribute('data-loc');
    c.querySelectorAll('[data-loc]').forEach(function (x) { x.removeAttribute('data-loc'); });
    ['fontSize', 'fontFamily', 'fontWeight', 'color', 'lineHeight', 'letterSpacing', 'textAlign', 'backgroundColor', 'backgroundImage', 'padding', 'borderRadius', 'border', 'boxShadow', 'whiteSpace'].forEach(function (p) { c.style[p] = cs[p]; });
    c.style.cssText += ';position:absolute;left:0;top:0;margin:0;box-sizing:border-box;width:' + r.w + 'px;height:' + r.h + 'px;animation:none;transform:none;translate:none;scale:none;opacity:.9;outline:2px dashed #e17055;outline-offset:2px;pointer-events:none;';
    return c.outerHTML;
  }

  WB.addMark = function (m, focus) {
    m.n = WB.state.marks.length + 1;
    WB.state.marks.push(m);
    WB.renderMarks();
    WB.drawMarks();
    if (focus) {
      var ins = document.querySelectorAll('#marksList input');
      if (ins.length) ins[ins.length - 1].focus();
    }
    return m;
  };
  WB.markFromMove = function (el, from, dx, dy, reason) {
    var t = targetInfo(el);
    from = from || t.rect;
    return WB.addMark({ type: 'move', auto: true, desc: t.desc, short: t.short, snippet: t.snippet, from: from, to: { x: from.x + dx, y: from.y + dy }, dx: dx, dy: dy, reason: reason, ghost: makeGhost(el), note: '' });
  };
  WB.markText = function (el, oldText, newText, reason) {
    var t = targetInfo(el);
    return WB.addMark({ type: 'text', auto: true, desc: t.desc, short: t.short, snippet: t.snippet, rect: t.rect, oldText: String(oldText).trim(), newText: newText, reason: reason, note: '' });
  };

  function layer() { return WB.doc && WB.doc.getElementById('__wb_sketch'); }

  WB.drawMarks = function () {
    var L = layer();
    if (!L) return;
    var de = WB.doc.documentElement, W = de.scrollWidth, H = Math.max(de.scrollHeight, WB.doc.body.scrollHeight);
    L.style.width = W + 'px';
    L.style.height = H + 'px';
    var svg = ['<svg class="art" width="' + W + '" height="' + H + '"><defs><marker id="__wb_ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#e17055"/></marker></defs>'];
    var items = [];
    function line(a, b, dashed) {
      return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#e17055" stroke-width="3"' + (dashed ? ' stroke-dasharray="7 5"' : '') + ' marker-end="url(#__wb_ah)"/>';
    }
    function box(r) { return 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px'; }
    WB.state.marks.forEach(function (m) {
      var bx, by;
      if (m.type === 'move') {
        items.push('<div class="src" style="' + box(m.from) + '"></div>');
        if (m.ghost) items.push('<div class="gw" style="left:' + m.to.x + 'px;top:' + m.to.y + 'px">' + m.ghost + '</div>');
        svg.push(line({ x: m.from.x + m.from.w / 2, y: m.from.y + m.from.h / 2 }, { x: m.to.x + m.from.w / 2, y: m.to.y + m.from.h / 2 }, true));
        bx = m.to.x; by = m.to.y;
      } else if (m.type === 'text') {
        items.push('<div class="src" style="' + box(m.rect) + '"></div>');
        items.push('<div class="nt" style="left:' + m.rect.x + 'px;top:' + (m.rect.y + m.rect.h + 6) + 'px">' + (m.newText ? '改为「' + esc(m.newText) + '」' : '删除这一块') + '</div>');
        bx = m.rect.x; by = m.rect.y;
      } else if (m.type === 'box') {
        svg.push('<rect x="' + m.rect.x + '" y="' + m.rect.y + '" width="' + m.rect.w + '" height="' + m.rect.h + '" rx="6" fill="rgba(225,112,85,.08)" stroke="#e17055" stroke-width="2.5" stroke-dasharray="8 5"/>');
        bx = m.rect.x; by = m.rect.y;
      } else if (m.type === 'arrow') {
        svg.push(line(m.a, m.b, false));
        bx = m.a.x; by = m.a.y;
      } else if (m.type === 'pen') {
        svg.push('<polyline points="' + m.points.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '" fill="none" stroke="#d63031" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>');
        bx = m.points[0][0]; by = m.points[0][1];
      } else if (m.type === 'note') {
        items.push('<div class="nt" style="left:' + m.at.x + 'px;top:' + m.at.y + 'px">' + (esc(m.note) || '（在下方面板里写便签内容）') + '</div>');
        bx = m.at.x; by = m.at.y;
      }
      if (m.note && m.type !== 'note') items.push('<div class="nt sm" style="left:' + (bx + 16) + 'px;top:' + (by - 30) + 'px">' + esc(m.note) + '</div>');
      items.push('<div class="bd" style="left:' + (bx - 11) + 'px;top:' + (by - 11) + 'px">' + m.n + '</div>');
    });
    svg.push('</svg>');
    L.innerHTML = svg.join('') + items.join('') + '<svg class="live" width="' + W + '" height="' + H + '"></svg><div class="lg"></div>';
  };

  function pt(e) { return { x: e.pageX, y: e.pageY }; }
  function under(e) {
    var L = layer();
    L.style.pointerEvents = 'none';
    var t = WB.doc.elementFromPoint(e.clientX, e.clientY);
    L.style.pointerEvents = '';
    return WB.pick(t);
  }
  function norm(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
  function targetsIn(r) {
    var out = [];
    WB.doc.querySelectorAll('body *').forEach(function (el) {
      if (WB.isUi(el) || el.children.length || /^(SCRIPT|STYLE)$/.test(el.tagName)) return;
      var hasText = !!el.textContent.trim();
      if (!hasText && (!el.hasAttribute('data-loc') || WB.running(el))) return;
      var q = WB.pageRect(el), cx = q.x + q.w / 2, cy = q.y + q.h / 2;
      if (q.w && q.h && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) out.push(targetInfo(el));
    });
    return out.slice(0, 8);
  }

  function onDown(e) {
    if (WB.state.mode !== 'sketch' || e.button !== 0) return;
    e.preventDefault();
    var p = pt(e), tool = WB.state.tool, L = layer();
    if (tool === 'note') {
      var t0 = under(e);
      WB.addMark({ type: 'note', at: p, target: t0 ? targetInfo(t0) : null, note: '' }, true);
      return;
    }
    if (tool === 'ghost') {
      var el = under(e);
      if (!el) return;
      cur = { tool: tool, el: el, target: targetInfo(el), start: p, ghost: makeGhost(el) };
      cur.from = cur.target.rect;
      var lg = L.querySelector('.lg');
      lg.innerHTML = '<div class="gw" style="left:' + cur.from.x + 'px;top:' + cur.from.y + 'px">' + cur.ghost + '</div>';
    } else {
      cur = { tool: tool, start: p, points: [[p.x, p.y]] };
    }
    L.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!cur) return;
    var p = pt(e), L = layer(), live = L.querySelector('.live'), s = cur.start;
    cur.end = p;
    if (cur.tool === 'ghost') {
      var g = L.querySelector('.lg .gw');
      if (g) { g.style.left = (cur.from.x + p.x - s.x) + 'px'; g.style.top = (cur.from.y + p.y - s.y) + 'px'; }
    } else if (cur.tool === 'pen') {
      cur.points.push([p.x, p.y]);
      live.innerHTML = '<polyline points="' + cur.points.map(function (q) { return q[0] + ',' + q[1]; }).join(' ') + '" fill="none" stroke="#d63031" stroke-width="3" stroke-linecap="round"/>';
    } else if (cur.tool === 'arrow') {
      live.innerHTML = '<line x1="' + s.x + '" y1="' + s.y + '" x2="' + p.x + '" y2="' + p.y + '" stroke="#e17055" stroke-width="3" marker-end="url(#__wb_ah)"/>';
    } else if (cur.tool === 'box') {
      var r = norm(s, p);
      live.innerHTML = '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="6" fill="rgba(225,112,85,.08)" stroke="#e17055" stroke-width="2.5" stroke-dasharray="8 5"/>';
    }
  }

  function onUp(e) {
    if (!cur) return;
    var c = cur, s = c.start, p = c.end || s;
    cur = null;
    var dist = Math.abs(p.x - s.x) + Math.abs(p.y - s.y);
    if (c.tool === 'ghost' && dist >= 4) {
      var dx = Math.round(p.x - s.x), dy = Math.round(p.y - s.y);
      WB.addMark({ type: 'move', desc: c.target.desc, short: c.target.short, snippet: c.target.snippet, from: c.from, to: { x: c.from.x + dx, y: c.from.y + dy }, dx: dx, dy: dy, ghost: c.ghost, note: '' }, true);
    } else if (c.tool === 'pen' && c.points.length > 2) {
      var xs = c.points.map(function (q) { return q[0]; }), ys = c.points.map(function (q) { return q[1]; });
      var bb = { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys) };
      bb.w = Math.max.apply(null, xs) - bb.x;
      bb.h = Math.max.apply(null, ys) - bb.y;
      WB.addMark({ type: 'pen', points: c.points, rect: bb, targets: targetsIn(bb), note: '' }, true);
    } else if (c.tool === 'arrow' && dist > 10) {
      WB.addMark({ type: 'arrow', a: s, b: p, fromT: pickAt(s), toT: pickAt(p), note: '' }, true);
    } else if (c.tool === 'box' && dist > 16) {
      var r = norm(s, p);
      WB.addMark({ type: 'box', rect: r, targets: targetsIn(r), note: '' }, true);
    } else {
      WB.drawMarks();
    }
  }
  function pickAt(p) {
    var L = layer();
    L.style.pointerEvents = 'none';
    var t = WB.pick(WB.doc.elementFromPoint(p.x - WB.win.scrollX, p.y - WB.win.scrollY));
    L.style.pointerEvents = '';
    return t ? targetInfo(t) : null;
  }

  function describeMark(m) {
    var head = m.auto ? '[自动转入] ' : '';
    if (m.type === 'move') return head + '移动 ' + m.short + '：' + arrowWords(m.dx, m.dy) + (m.reason ? '（' + m.reason + '）' : '');
    if (m.type === 'text') return head + (m.newText ? '改字 ' + m.short + ' →「' + short(m.newText) + '」' : '删除 ' + m.short) + '（' + m.reason + '）';
    if (m.type === 'box') return '圈选：' + (m.targets.length ? m.targets.map(function (t) { return t.short; }).join('、') : '一块空白区域');
    if (m.type === 'arrow') return '箭头：从 ' + (m.fromT ? m.fromT.short : '空白处') + ' 指向 ' + (m.toT ? m.toT.short : '空白处');
    if (m.type === 'pen') return '画笔：圈到了 ' + (m.targets.length ? m.targets.map(function (t) { return t.short; }).join('、') : '空白区域');
    return '便签' + (m.target ? '，贴在 ' + m.target.short : '');
  }

  WB.updateMarkCount = function () {
    var n = WB.state.marks.length, b = $('#markCount');
    b.textContent = n;
    b.hidden = !n;
  };

  WB.renderMarks = function () {
    var box = $('#marksList'), ms = WB.state.marks;
    WB.updateMarkCount();
    if (!ms.length) {
      box.innerHTML = '<p class="empty">还没有标记。选一个工具在页面上画；直接修改时遇到“红灯”，也会自动记到这里。</p>';
      return;
    }
    box.innerHTML = '';
    ms.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'mark' + (m.auto ? ' auto' : '');
      row.innerHTML = '<span class="bd">' + m.n + '</span><div class="mk-body"><div class="mk-desc"></div><input placeholder="写一句要求（可不填），比如：和上面的按钮左对齐"></div><button title="删除这条">×</button>';
      row.querySelector('.mk-desc').textContent = describeMark(m);
      var inp = row.querySelector('input');
      inp.value = m.note || '';
      inp.oninput = function () { m.note = inp.value; WB.drawMarks(); };
      row.querySelector('button').onclick = function () {
        ms.splice(ms.indexOf(m), 1);
        ms.forEach(function (x, i) { x.n = i + 1; });
        WB.renderMarks();
        WB.drawMarks();
      };
      box.appendChild(row);
    });
  };

  WB.buildTask = function () {
    var ms = WB.state.marks, L = [], eco = $('#tier').value === 'eco';
    L.push('【任务单】页面：' + WB.pages[WB.state.page].name + '（index.html），共 ' + ms.length + ' 条');
    L.push('【规矩】只改下面提到的元素；其他代码一律不动；保留原有的 class 和动画；改完列出改了哪几行。');
    function code(list) {
      var rows = [];
      list.forEach(function (t) { if (t && t.snippet) rows = rows.concat(t.snippet); });
      if (rows.length) { L.push('相关代码：'); rows.forEach(function (s) { L.push('    ' + s); }); }
    }
    ms.forEach(function (m) {
      L.push('');
      L.push('—— 第 ' + m.n + ' 条 ——');
      if (m.type === 'move') {
        L.push('对象：' + m.desc);
        L.push('要求：视觉上' + arrowWords(m.dx, m.dy) + '（页面坐标从 ' + rectStr(m.from) + ' 移到左上角 (' + Math.round(m.to.x) + ', ' + Math.round(m.to.y) + ')）');
        if (m.reason) L.push('为什么没直接改：' + m.reason);
        code([m]);
      } else if (m.type === 'text') {
        L.push('对象：' + m.desc);
        L.push('要求：' + (m.newText ? '把文字「' + m.oldText + '」改为「' + m.newText + '」' : '删除这一块'));
        L.push('为什么没直接改：' + m.reason);
      } else if (m.type === 'box' || m.type === 'pen') {
        L.push((m.type === 'box' ? '圈选范围：' : '手绘圈画范围：') + rectStr(m.rect));
        L.push('范围内的元素：' + (m.targets.length ? '' : '无（空白区域）'));
        m.targets.forEach(function (t) { L.push('  - ' + t.desc); });
        code(m.targets.slice(0, 3));
      } else if (m.type === 'arrow') {
        L.push('箭头起点：' + (m.fromT ? m.fromT.desc : '空白处 (' + Math.round(m.a.x) + ', ' + Math.round(m.a.y) + ')'));
        L.push('箭头终点：' + (m.toT ? m.toT.desc : '空白处 (' + Math.round(m.b.x) + ', ' + Math.round(m.b.y) + ')'));
        code([m.fromT, m.toT]);
      } else {
        L.push('便签位置：' + (m.target ? m.target.desc : '(' + Math.round(m.at.x) + ', ' + Math.round(m.at.y) + ')'));
        code([m.target]);
      }
      if (m.note) L.push('用户要求：' + m.note);
    });
    L.push('');
    L.push('【附件】带标记的页面截图 1 张（演示版未生成）');
    L.push('【模型】' + (eco ? '经济档：位置已精确到行，任务小，小模型就够' : '专家档：涉及整体排版或多处联动'));
    return L.join('\n');
  };

  function openTask() {
    if (!WB.state.marks.length) { WB.verdict('gray', '还没有标记，先在页面上画几笔'); return; }
    var text = WB.buildTask(), a = text.length, b = WB.state.source.length;
    $('#taskText').value = text;
    $('#taskStats').textContent = a < b
      ? '这份任务单约 ' + a + ' 字，比整页代码（约 ' + b + ' 字）少 ' + Math.round((1 - a / b) * 100) + '%。直接发整页代码加一句口述，不但字多，AI 还得自己猜位置。'
      : '这份任务单约 ' + a + ' 字，整页代码约 ' + b + ' 字。标记多的时候字数会接近整页，但每条都精确到行，AI 不用猜位置。';
    $('#taskModal').hidden = false;
  }

  WB.onModeChange = function (mode) {
    var L = layer();
    if (L) L.className = mode === 'sketch' ? 'on' : 'off';
    cur = null;
  };

  document.querySelectorAll('#sketchTools button').forEach(function (b) {
    b.onclick = function () {
      WB.state.tool = b.dataset.tool;
      document.querySelectorAll('#sketchTools button').forEach(function (x) { x.classList.toggle('on', x === b); });
    };
  });
  $('#btnTask').onclick = openTask;
  $('#btnClearMarks').onclick = function () {
    if (!WB.state.marks.length || !confirm('清空全部草图标记？')) return;
    WB.state.marks = [];
    WB.renderMarks();
    WB.drawMarks();
  };
  $('#btnCopyTask').onclick = function () {
    var ta = $('#taskText'), btn = this;
    function done() { btn.textContent = '已复制'; setTimeout(function () { btn.textContent = '复制任务单'; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
    else { ta.select(); document.execCommand('copy'); done(); }
  };

  WB.onRender.push(function (doc) {
    cur = null;
    var st = doc.createElement('style'), L = doc.createElement('div');
    st.id = '__wb_sketch_style';
    st.textContent =
      '#__wb_sketch{position:absolute;left:0;top:0;z-index:2147483645;font:13px/1.5 "Microsoft YaHei",sans-serif}' +
      '#__wb_sketch.off{pointer-events:none;opacity:.45}' +
      '#__wb_sketch.on{cursor:crosshair}' +
      '#__wb_sketch svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}' +
      '#__wb_sketch .src{position:absolute;border:2px dashed #e17055;border-radius:4px;pointer-events:none}' +
      '#__wb_sketch .gw{position:absolute;width:0;height:0;pointer-events:none}' +
      '#__wb_sketch .nt{position:absolute;max-width:220px;padding:6px 10px;background:#fff3b0;color:#5a4a00;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.18);pointer-events:none;white-space:pre-wrap}' +
      '#__wb_sketch .nt.sm{padding:3px 8px;font-size:12px}' +
      '#__wb_sketch .bd{position:absolute;width:22px;height:22px;border-radius:50%;background:#e17055;color:#fff;text-align:center;font:700 12px/22px sans-serif;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.25)}';
    L.id = '__wb_sketch';
    L.className = WB.state.mode === 'sketch' ? 'on' : 'off';
    doc.head.appendChild(st);
    doc.body.appendChild(L);
    L.addEventListener('pointerdown', onDown);
    L.addEventListener('pointermove', onMove);
    L.addEventListener('pointerup', onUp);
    WB.drawMarks();
  });
})();
