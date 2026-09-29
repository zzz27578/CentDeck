(function () {
  var WB = window.WB, $ = WB.$;
  var CONTAINER = 'section, header, footer, nav, .card, .marquee, .product';
  var drag = null, editing = null;

  function short(s) { s = String(s).trim().replace(/\s+/g, ' '); return s.length > 12 ? s.slice(0, 12) + '…' : s; }
  function undoBtn() { return { label: '撤销这一步', fn: WB.undo }; }
  function sketchBtn() { return { label: '去草图模式查看', fn: function () { WB.setMode('sketch'); } }; }
  function arrowText(dx, dy) { return (dx >= 0 ? '→ ' : '← ') + Math.abs(dx) + '  ' + (dy >= 0 ? '↓ ' : '↑ ') + Math.abs(dy); }

  function curTranslate(info) {
    var v = info ? WB.getStyleProp(info, 'translate') : null;
    if (!v) return [0, 0];
    var p = v.split(/\s+/).map(parseFloat);
    return [p[0] || 0, p[1] || 0];
  }
  function curScale(info) {
    var v = info ? WB.getStyleProp(info, 'scale') : null;
    return v ? parseFloat(v) : 1;
  }
  function usesTransformAnim(el) {
    return el.getAnimations().some(function (a) {
      try { return a.effect.getKeyframes().some(function (k) { return 'transform' in k; }); } catch (e) { return false; }
    });
  }
  function containerOf(el) { return el.parentElement ? el.parentElement.closest(CONTAINER) : null; }

  // ---------- 悬停 / 选中 / 拖动 ----------
  function onMove(e) {
    if (drag) { dragMove(e); return; }
    var h = WB.ui.hover;
    if (WB.state.mode !== 'direct' || editing) { h.style.display = 'none'; return; }
    var el = WB.pick(e.target);
    if (!el || el === WB.selectedNode()) { h.style.display = 'none'; return; }
    h.style.display = 'block';
    h.style.borderColor = el.hasAttribute('data-loc') ? '#4c7dff' : '#999999';
    WB.place(h, WB.pageRect(el), 1);
  }

  function onDown(e) {
    if (WB.state.mode !== 'direct' || e.button !== 0) return;
    if (editing) {
      if (editing.el.contains(e.target)) return;
      editing.el.blur();
    }
    if (WB.state.adding) { e.preventDefault(); addTextBox(e); return; }
    var el = WB.pick(e.target);
    if (!el) { WB.select(null); return; }
    e.preventDefault();
    if (el !== WB.selectedNode()) {
      WB.select(el);
      WB.verdict('gray', '已选中 ' + WB.describe(el), '再按住它就能拖动（按住 Alt 可关闭自动对齐）；双击改字；方向键微调 1 像素，Shift+方向键 10 像素；Delete 删除。');
      return;
    }
    startDrag(el, e);
  }

  function startDrag(el, e) {
    var cont = containerOf(el), cands = { x: [], y: [] };
    (cont || WB.doc.body).querySelectorAll('[data-loc]').forEach(function (o) {
      if (o === el || el.contains(o) || o.contains(el) || WB.running(o)) return;
      var q = WB.pageRect(o);
      if (!q.w || !q.h) return;
      cands.x.push([q.x, o], [q.x + q.w / 2, o], [q.x + q.w, o]);
      cands.y.push([q.y, o], [q.y + q.h / 2, o], [q.y + q.h, o]);
    });
    if (cont) { var c = WB.pageRect(cont); cands.x.push([c.x + c.w / 2, cont]); }
    drag = {
      el: el, info: WB.infoOf(el), sx: e.clientX, sy: e.clientY, r: WB.pageRect(el),
      base: curTranslate(WB.infoOf(el)), inline0: el.style.translate, cont: cont, cands: cands,
      before: WB.snap(), moved: false, dx: 0, dy: 0, lastE: e
    };
  }

  function snap1(edges, cands) {
    var best = null;
    edges.forEach(function (v) {
      cands.forEach(function (c) {
        var d = c[0] - v;
        if (Math.abs(d) <= 6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: c[0] };
      });
    });
    return best;
  }

  function drawGuides(sx, sy) {
    var g = WB.ui.guides, de = WB.doc.documentElement;
    g.innerHTML = '';
    if (sx) { var i = WB.doc.createElement('i'); i.style.cssText = 'left:' + sx.at + 'px;top:0;width:1px;height:' + de.scrollHeight + 'px'; g.appendChild(i); }
    if (sy) { var j = WB.doc.createElement('i'); j.style.cssText = 'top:' + sy.at + 'px;left:0;height:1px;width:' + de.scrollWidth + 'px'; g.appendChild(j); }
  }

  // 看元素落点的中心落在哪个区域里（最小的那个），和原来的区域比较
  function containerAt(px, py, self) {
    var best = null, area = Infinity;
    WB.doc.querySelectorAll(CONTAINER).forEach(function (c) {
      if (c === self || self.contains(c)) return;
      var q = WB.pageRect(c);
      if (px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h && q.w * q.h < area) { best = c; area = q.w * q.h; }
    });
    return best;
  }
  function crossed(d) {
    return containerAt(d.r.x + d.dx + d.r.w / 2, d.r.y + d.dy + d.r.h / 2, d.el) !== (d.cont || null);
  }

  function dragMove(e) {
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, r = drag.r;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    drag.lastE = e;
    var sx = e.altKey ? null : snap1([r.x + dx, r.x + r.w / 2 + dx, r.x + r.w + dx], drag.cands.x);
    var sy = e.altKey ? null : snap1([r.y + dy, r.y + r.h / 2 + dy, r.y + r.h + dy], drag.cands.y);
    if (sx) dx += sx.d;
    if (sy) dy += sy.d;
    drag.dx = Math.round(dx);
    drag.dy = Math.round(dy);
    drag.el.style.translate = (drag.base[0] + drag.dx) + 'px ' + (drag.base[1] + drag.dy) + 'px';
    drawGuides(sx, sy);
    var lb = WB.ui.label, cross = crossed(drag);
    lb.style.display = 'block';
    lb.style.background = cross ? '#d63031' : '#1f2430';
    lb.style.left = (r.x + drag.dx) + 'px';
    lb.style.top = (r.y + drag.dy + r.h + 6) + 'px';
    lb.textContent = arrowText(drag.dx, drag.dy) + (sx || sy ? '  · 已对齐' : '') + (cross ? '  · 跨出了所在区域，松手后转为草图标记' : '');
  }

  function finishDrag(e) {
    var d = drag;
    drag = null;
    WB.ui.guides.innerHTML = '';
    WB.ui.label.style.display = 'none';
    if (!d.moved) return;
    WB.applyMove(d.el, d.dx, d.dy, { before: d.before, crossed: crossed(d), inline0: d.inline0, from: d.r });
  }
  function onUp(e) { if (drag) finishDrag(e); }
  window.addEventListener('mouseup', function () { if (drag) finishDrag(null); });

  // ---------- 挪动写回 ----------
  WB.applyMove = function (el, dx, dy, meta) {
    var info = WB.infoOf(el), before = meta.before || WB.snap(), mode = WB.state.writeMode, res, desc;
    function revert() { el.style.translate = meta.inline0 || ''; }
    if (!info) {
      revert();
      var m1 = WB.markFromMove(el, meta.from, dx, dy, '程序运行时生成的元素，代码里没有它自己的一行');
      var sl = WB.parsed.scripts.length ? WB.parsed.lineOf(WB.parsed.scripts[0][0]) : '?';
      WB.verdict('red', '这块是程序运行时生成的，代码里没有它的门牌号，没法直接写回', '它是第 ' + sl + ' 行附近的脚本照着清单“循环”出来的。已恢复原位，并转成草图标记 #' + m1.n + '，攒好后统一交给 AI。代码一行没变。', [sketchBtn()]);
      return;
    }
    if (meta.crossed) {
      revert();
      var m2 = WB.markFromMove(el, meta.from, dx, dy, '跨区域移动，需要改结构');
      WB.verdict('red', '跨区域移动属于“改结构”，已转为草图标记 #' + m2.n, '把它从一个区域搬进另一个区域，要把整段代码剪切到新位置，还要适应新区域的排版规则，交给 AI 更稳。已恢复原位，记下了原位置和目标位置，代码一行没变。', [sketchBtn()]);
      return;
    }
    var base = curTranslate(info), nx = base[0] + dx, ny = base[1] + dy;
    var where = '第 ' + info.line + ' 行 <' + info.tag + '>';
    if (mode === 'shared') {
      var sel = info.classes.length ? '.' + info.classes[0] : info.tag;
      revert();
      commitShared(WB.setCssRule(WB.state.source, sel, { translate: nx + 'px ' + ny + 'px' }), sel, where + '：挪动写进了共用规则 ' + sel + '（错误示范 B）', before, el);
      return;
    }
    if (mode === 'absolute') {
      revert();
      var cs = WB.win.getComputedStyle(el);
      var left = el.offsetLeft - (parseFloat(cs.marginLeft) || 0) + nx;
      var top = el.offsetTop - (parseFloat(cs.marginTop) || 0) + ny;
      res = WB.setInlineStyle(WB.state.source, info, { position: 'absolute', left: Math.round(left) + 'px', top: Math.round(top) + 'px', translate: null });
      desc = where + '：改成绝对定位 left/top（错误示范 A）';
    } else if (mode === 'transform') {
      res = WB.setInlineStyle(WB.state.source, info, { transform: 'translate(' + nx + 'px, ' + ny + 'px)', translate: null });
      desc = where + '：挪动写进 transform（错误示范 C）';
    } else {
      res = WB.setInlineStyle(WB.state.source, info, { translate: nx || ny ? nx + 'px ' + ny + 'px' : null });
      desc = where + '：视觉位置 ' + arrowText(dx, dy) + '（只加 translate）';
    }
    var changed = WB.commit(res.src, {
      desc: desc,
      hot: function () { if (res.style) el.setAttribute('style', res.style); else el.removeAttribute('style'); },
      after: function () { judgeMove(el, dx, dy, before, mode, meta.from); }
    });
    if (!changed) revert();
  };

  function overlaps(el) {
    var r = WB.pageRect(el), hit = null;
    WB.doc.querySelectorAll('[data-loc]').forEach(function (o) {
      if (hit || o === el || o.contains(el) || el.contains(o) || o.querySelector('[data-loc]') || WB.running(o)) return;
      var q = WB.pageRect(o);
      var ix = Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x), iy = Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y);
      if (ix > 4 && iy > 4 && ix * iy > 0.15 * Math.min(r.w * r.h, q.w * q.h)) hit = o;
    });
    return hit;
  }
  function outOfContainer(el) {
    var c = containerOf(el);
    if (!c) return false;
    var r = WB.pageRect(el), q = WB.pageRect(c);
    return r.x < q.x - 2 || r.y < q.y - 2 || r.x + r.w > q.x + q.w + 2 || r.y + r.h > q.y + q.h + 2;
  }

  function judgeMove(el, dx, dy, before, mode, from) {
    var moved = WB.collateral(before, el);
    if (mode === 'absolute') {
      WB.flash(moved);
      WB.verdict('bad', '错误示范 A：它被“拔出队伍”，' + moved.length + ' 块内容跟着乱动了（橙色框）',
        '右边只改了一行，但它原来的座位空了，后面的内容往上补位，它自己的宽度也可能变了。问题不在改了几行，而在改法。切到“手机”看看更明显。', [undoBtn()]);
      return;
    }
    if (mode === 'transform') {
      var anim = usesTransformAnim(el);
      WB.verdict('bad', anim ? '错误示范 C：代码里写了挪动，画面上却弹回去了' : '错误示范 C：这个元素没有动画，所以暂时看不出问题',
        anim ? '挪动写进了 transform，而它身上的动画也在用 transform。动画优先级更高，把你的挪动盖掉了。安全写法用单独的 translate，两者互不干扰。'
          : '试试复杂页的「今日上新」或大标题，它们带动画。另外，这种写法下挪完再调“视觉缩放”，挪动也会被冲掉。', [undoBtn()]);
      return;
    }
    var issues = [], dist = Math.max(Math.abs(dx), Math.abs(dy)), ov = overlaps(el);
    if (moved.length) issues.push('有 ' + moved.length + ' 块内容被挤动了（橙色框）');
    if (ov) issues.push('盖住了 ' + WB.describe(ov));
    if (outOfContainer(el)) issues.push('跑出了所在区域的边界');
    if (dist > 80) issues.push('挪得比较远（' + dist + ' 像素）：原位置会留空，换屏幕后可能错位');
    WB.flash(moved.concat(ov ? [ov] : []));
    if (!issues.length) {
      WB.verdict('green', '已写回：只在第 ' + WB.infoOf(el).line + ' 行加了 translate，别的元素一个没动',
        '挪位走的是单独的“视觉偏移”通道：不挤别人，也不影响它身上的动画。', [undoBtn()]);
      return;
    }
    WB.verdict('yellow', '已写回，但有 ' + issues.length + ' 处需要你看一眼', issues.join('\n') +
      '\n如果这就是你想要的效果，保留即可；如果其实是想让它“换个位置排队”，建议撤销并交给 AI 改排版。', [
      undoBtn(),
      { label: '撤销并转为草图标记', fn: function () { var m = WB.markFromMove(el, from, dx, dy, '挪动较大，可能需要改排版'); WB.undo(); WB.verdict('gray', '已撤销，并记成草图标记 #' + m.n, '切到草图模式可以看到它，攒好后统一交给 AI。', [sketchBtn()]); } }
    ]);
  }

  function commitShared(newSrc, sel, desc, before, el) {
    if (!newSrc) return;
    WB.commit(newSrc, {
      desc: desc,
      hot: function (doc) { var st = doc.querySelector('style:not([id])'); if (st) st.textContent = WB.cssText(newSrc); },
      after: function () {
        var all = Array.prototype.slice.call(WB.doc.querySelectorAll(sel));
        WB.flash(all.filter(function (x) { return x !== el; }), '#ff3b7f');
        WB.verdict('bad', '错误示范 B：你只想改这一个，但页面上 ' + all.length + ' 个用 ' + sel + ' 的元素一起变了（粉色框）',
          '右边绿色那一行是共用规则，它管着所有用这个 class 的元素，就像在 Word 里改了“标题 1”样式。安全写法只改被选中元素自己那一行。', [undoBtn()]);
      }
    });
  }

  // ---------- 字号 / 字体 / 颜色 / 缩放 ----------
  WB.applyStyle = function (el, props, desc) {
    var info = WB.infoOf(el), before = WB.snap(), mode = WB.state.writeMode, where = '第 ' + info.line + ' 行 <' + info.tag + '>';
    if (mode === 'shared') {
      var sel = info.classes.length ? '.' + info.classes[0] : info.tag;
      commitShared(WB.setCssRule(WB.state.source, sel, props), sel, where + '：' + desc + '，写进了共用规则 ' + sel + '（错误示范 B）', before, el);
      return;
    }
    var viaTransform = mode === 'transform' && props.scale !== undefined;
    if (viaTransform) {
      props = { transform: props.scale ? 'scale(' + props.scale + ')' : null, scale: null };
      desc += '（写进 transform，错误示范 C）';
    }
    var res = WB.setInlineStyle(WB.state.source, info, props);
    WB.commit(res.src, {
      desc: where + '：' + desc,
      hot: function () { if (res.style) el.setAttribute('style', res.style); else el.removeAttribute('style'); },
      after: function () {
        var moved = WB.collateral(before, el);
        WB.flash(moved);
        if (viaTransform) {
          WB.verdict('bad', '错误示范 C：缩放写进了 transform', '挪动和缩放挤在同一个 transform 里，后写的会覆盖先写的；如果它身上还有动画，动画又会把两者都盖掉。安全写法用独立的 translate 和 scale。', [undoBtn()]);
        } else if (!moved.length) {
          WB.verdict('green', '已写回：只改了第 ' + info.line + ' 行的 ' + Object.keys(props).join('、'), '别的元素一个没动。', [undoBtn()]);
        } else {
          WB.verdict('yellow', '已写回：' + desc + '，' + moved.length + ' 块内容跟着让位（橙色框）', '字变大或换了字体，占的地方变了，下面的内容往下让，这是网页“排队”的正常现象。', [undoBtn()]);
        }
      }
    });
  };

  // ---------- 双击改字 ----------
  function onDbl(e) {
    if (WB.state.mode !== 'direct') return;
    var el = WB.pick(e.target);
    if (el) { e.preventDefault(); startEdit(el); }
  }
  function startEdit(el) {
    var info = WB.infoOf(el);
    if ((info && !info.textOnly) || (!info && el.children.length)) {
      WB.verdict('gray', '这是一个“外框”，里面还套着别的元素', '请双击里面具体的那一行字来修改。');
      return;
    }
    if (!el.textContent.trim()) { WB.verdict('gray', '这个元素里没有文字（比如色块、图片）'); return; }
    var s = WB.win.getSelection(), range = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    WB.select(el);
    editing = { el: el, old: el.textContent, before: WB.snap(), info: info };
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.focus();
    if (range) { s.removeAllRanges(); s.addRange(range); }
    el.addEventListener('keydown', editKey);
    el.addEventListener('blur', endEdit, { once: true });
    WB.verdict('gray', '正在改字：直接打字，回车确认，Esc 取消', '改字不会动它的样式和动画，只替换代码里夹在标签中间的那段文字。');
  }
  function editKey(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); editing.el.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); editing.el.textContent = editing.old; editing.el.blur(); }
  }
  function endEdit() {
    var ed = editing;
    editing = null;
    if (!ed) return;
    var el = ed.el, nt = el.textContent;
    el.removeAttribute('contenteditable');
    el.removeEventListener('keydown', editKey);
    if (nt === ed.old) { WB.verdict('gray', '文字没有变化'); return; }
    if (!nt.trim()) { el.textContent = ed.old; WB.verdict('gray', '文字不能清空', '想删掉整个元素，请选中后按 Delete。'); return; }
    if (ed.info) commitText(el, ed, nt.trim()); else commitGenText(el, ed, nt.trim());
  }
  function escText(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function commitText(el, ed, nt) {
    var info = ed.info, raw = info.text, src = WB.state.source;
    var lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
    WB.commit(src.slice(0, info.openEnd) + lead + escText(nt) + trail + src.slice(info.closeStart), {
      desc: '第 ' + info.line + ' 行 <' + info.tag + '>：文字「' + short(ed.old) + '」改为「' + short(nt) + '」',
      hot: function () { el.textContent = nt; },
      after: function () {
        var moved = WB.collateral(ed.before, el);
        WB.flash(moved);
        if (!moved.length) WB.verdict('green', '已写回：只替换了第 ' + info.line + ' 行标签中间的文字', '它的 class、样式、动画一个字没动，右边绿色行就是改动。', [undoBtn()]);
        else WB.verdict('yellow', '已写回：字数变了，' + moved.length + ' 块内容跟着让位（橙色框）', '这是网页“排队”的正常现象，就像 Word 里多打一行字，后面的段落往下走。不想让别人动，可以改短一点或调小字号。', [undoBtn()]);
      }
    });
  }

  function commitGenText(el, ed, nt) {
    var src = WB.state.source, old = ed.old.trim(), hits = [];
    WB.parsed.scripts.forEach(function (r) {
      ["'", '"'].forEach(function (q) {
        var needle = q + old + q, from = r[0], idx;
        while ((idx = src.indexOf(needle, from)) >= 0 && idx < r[1]) { hits.push({ at: idx + 1, q: q }); from = idx + 1; }
      });
    });
    if (hits.length === 1) {
      var h = hits[0], line = WB.parsed.lineOf(h.at), val = nt.split(h.q).join('\\' + h.q);
      WB.commit(src.slice(0, h.at) + val + src.slice(h.at + old.length), {
        desc: '第 ' + line + ' 行（数据清单）：「' + short(old) + '」改为「' + short(nt) + '」',
        rerender: true,
        after: function () {
          WB.verdict('yellow', '已写回：这段字来自第 ' + line + ' 行的数据清单，改的是清单里的这一项',
            '这块是程序照着清单“循环生成”的，代码里没有它自己的一行。工具在清单里找到了唯一一处一模一样的文字，就直接改了。所有用到这一项的地方都会一起变。', [undoBtn()]);
        }
      });
      return;
    }
    el.textContent = ed.old;
    var m = WB.markText(el, ed.old, nt, hits.length ? '代码里有 ' + hits.length + ' 处相同的文字，不确定该改哪一处' : '这段字是程序拼出来的（比如“¥”加上价格数字），代码里找不到原样的文字');
    WB.verdict('red', hits.length ? '代码里有多处一样的文字，不确定该改哪一处' : '这段字是程序临时拼出来的，代码里找不到原文',
      '已恢复原样，并转成草图标记 #' + m.n + '：「' + short(ed.old) + '」→「' + short(nt) + '」。这类改动交给 AI，它能看懂拼接逻辑。', [sketchBtn()]);
  }

  // ---------- 新增文本框 / 删除 ----------
  function addTextBox(e) {
    WB.state.adding = false;
    $('#btnAddText').classList.remove('on');
    var t = WB.pick(e.target), cont = t && t.closest('section, header, footer');
    if (!cont || !cont.hasAttribute('data-loc')) { WB.verdict('gray', '请点在页面的某个区域里（比如标题所在的那一块）'); return; }
    var info = WB.infoOf(cont), cr = cont.getBoundingClientRect(), cs = WB.win.getComputedStyle(cont);
    var x = Math.round(e.clientX - cr.left - (parseFloat(cs.borderLeftWidth) || 0));
    var y = Math.round(e.clientY - cr.top - (parseFloat(cs.borderTopWidth) || 0));
    var src = WB.state.source, ls = src.lastIndexOf('\n', info.closeStart - 1) + 1, indent = src.slice(ls, info.closeStart);
    if (/\S/.test(indent)) { ls = info.closeStart; indent = ''; }
    var html = '<p style="position: absolute; left: ' + x + 'px; top: ' + y + 'px; margin: 0; font-size: 18px; color: #e17055;">新文本框，双击改字</p>';
    var pos = ls + indent.length + 2, before = WB.snap();
    WB.commit(src.slice(0, ls) + indent + '  ' + html + '\n' + src.slice(ls), {
      desc: '新增一行：浮动文本框',
      rerender: true,
      after: function () {
        var nel = null;
        WB.parsed.elements.forEach(function (x2) { if (x2.openStart === pos) nel = x2; });
        if (!nel) return;
        WB.select(WB.byLoc(nel.i));
        var moved = WB.collateral(before, WB.selectedNode(), function (k) { return k < nel.i ? k : k + 1; });
        WB.flash(moved);
        WB.verdict('yellow', '已写回：新增了一行代码（第 ' + nel.line + ' 行，浮动文本框）',
          '它“浮”在区域上方、不参与排队，所以挤动了 ' + moved.length + ' 块内容；但它可能盖住别人，换成手机宽度后位置也可能不合适。双击它就能改字。', [undoBtn()]);
      }
    });
  }

  function deleteSel() {
    var el = WB.selectedNode(), info = WB.infoOf(el);
    if (!el) return;
    if (!info) {
      var m = WB.markText(el, el.textContent, '', '想删除一块程序生成的内容');
      WB.verdict('red', '这块是程序生成的，代码里没有它自己的一行，没法直接删', '已转成草图标记 #' + m.n + '，交给 AI 去改生成它的清单或脚本。', [sketchBtn()]);
      return;
    }
    var src = WB.state.source, s = info.openStart, e2 = info.closeEnd;
    var ls = src.lastIndexOf('\n', s - 1) + 1, le = src.indexOf('\n', e2);
    if (le < 0) le = src.length;
    if (!/\S/.test(src.slice(ls, s)) && !/\S/.test(src.slice(e2, le))) { s = ls; e2 = Math.min(le + 1, src.length); }
    var count = WB.parsed.elements.filter(function (x) { return x.openStart >= info.openStart && x.closeEnd <= info.closeEnd; }).length;
    var anc = [], idx = info.i, before = WB.snap();
    for (var n = el.parentElement; n; n = n.parentElement) if (n.hasAttribute && n.hasAttribute('data-loc')) anc.push(+n.getAttribute('data-loc'));
    WB.state.selected = null;
    WB.commit(src.slice(0, s) + src.slice(e2), {
      desc: '删除第 ' + info.line + (info.endLine > info.line ? '–' + info.endLine : '') + ' 行 <' + info.tag + '>',
      rerender: true,
      after: function () {
        var moved = WB.collateral(before, null, function (k) { return k < idx ? k : k < idx + count ? null : k - count; }, anc);
        WB.flash(moved);
        if (moved.length) WB.verdict('yellow', '已删除：后面 ' + moved.length + ' 块内容往上补位了（橙色框）', '和 Word 里删掉一段一样，后面的内容会往上走，这是正常的。', [undoBtn()]);
        else WB.verdict('green', '已删除，没有影响到别的元素', '', [undoBtn()]);
      }
    });
  }

  // ---------- 键盘 ----------
  WB.onKey = function (e) {
    if (editing) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); WB.undo(); return; }
    if (WB.state.mode !== 'direct') return;
    var el = WB.selectedNode();
    if (!el) return;
    if (e.key === 'Escape') { WB.select(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    var st = e.shiftKey ? 10 : 1;
    var d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (d) { e.preventDefault(); WB.applyMove(el, d[0], d[1], { from: WB.pageRect(el), inline0: el.style.translate }); }
  };

  // ---------- 属性面板 ----------
  function toHex(c) {
    var m = String(c).match(/\d+(\.\d+)?/g);
    if (!m) return '#000000';
    return '#' + m.slice(0, 3).map(function (v) { return ('0' + Math.round(+v).toString(16)).slice(-2); }).join('');
  }
  WB.updateProps = function () {
    var el = WB.selectedNode(), body = $('#propBody'), empty = $('#propEmpty');
    if (!el || !WB.win) { body.hidden = true; empty.hidden = false; return; }
    body.hidden = false;
    empty.hidden = true;
    var info = WB.infoOf(el), cs = WB.win.getComputedStyle(el), t = curTranslate(info), sc = Math.round(curScale(info) * 100);
    $('#propTarget').textContent = WB.describe(el);
    $('#propGen').hidden = !!info;
    $('#pFontSize').value = Math.round(parseFloat(cs.fontSize));
    $('#pColor').value = toHex(cs.color);
    $('#pFontFamily').value = (info && WB.getStyleProp(info, 'font-family')) || '';
    $('#pX').value = t[0];
    $('#pY').value = t[1];
    $('#pScale').value = sc;
    $('#pScaleVal').textContent = sc + '%';
    $('#pBold').classList.toggle('on', parseInt(cs.fontWeight, 10) >= 600);
    body.querySelectorAll('input, select, button').forEach(function (x) { x.disabled = !info && x.id !== 'pDelete'; });
  };

  function sel() { var el = WB.selectedNode(); return WB.infoOf(el) ? el : null; }
  function setSize(v) {
    var el = sel();
    if (!el || !(v > 0)) return;
    WB.applyStyle(el, { 'font-size': v + 'px' }, '字号改为 ' + v);
  }
  $('#pFontSize').onchange = function () { setSize(Math.round(+this.value)); };
  $('#pFontMinus').onclick = function () { setSize(Math.max(8, +$('#pFontSize').value - 2)); };
  $('#pFontPlus').onclick = function () { setSize(+$('#pFontSize').value + 2); };
  $('#pFontFamily').onchange = function () {
    var el = sel();
    if (el) WB.applyStyle(el, { 'font-family': this.value || null }, '字体改为 ' + this.options[this.selectedIndex].text);
  };
  $('#pColor').oninput = function () { var el = sel(); if (el) el.style.color = this.value; };
  $('#pColor').onchange = function () { var el = sel(); if (el) WB.applyStyle(el, { color: this.value }, '颜色改为 ' + this.value); };
  $('#pBold').onclick = function () {
    var el = sel();
    if (!el) return;
    var bold = parseInt(WB.win.getComputedStyle(el).fontWeight, 10) >= 600;
    WB.applyStyle(el, { 'font-weight': bold ? '400' : '700' }, bold ? '取消加粗' : '加粗');
  };
  $('#pScale').oninput = function () { var el = sel(); $('#pScaleVal').textContent = this.value + '%'; if (el) el.style.scale = this.value / 100; };
  $('#pScale').onchange = function () {
    var el = sel(), v = +this.value;
    if (el) WB.applyStyle(el, { scale: v === 100 ? null : String(v / 100) }, '视觉缩放到 ' + v + '%');
  };
  function setOffset() {
    var el = sel();
    if (!el) return;
    var t = curTranslate(WB.infoOf(el));
    WB.applyMove(el, Math.round(+$('#pX').value) - t[0], Math.round(+$('#pY').value) - t[1], { from: WB.pageRect(el), inline0: el.style.translate });
  }
  $('#pX').onchange = setOffset;
  $('#pY').onchange = setOffset;
  $('#pDelete').onclick = deleteSel;
  $('#btnAddText').onclick = function () {
    WB.state.adding = !WB.state.adding;
    this.classList.toggle('on', WB.state.adding);
    if (WB.state.adding) WB.verdict('gray', '点一下页面上想放文本框的位置', '文本框会浮在那一块区域上方，像 PPT 里插入的文本框。');
  };

  WB.onRender.push(function (doc) {
    drag = null;
    editing = null;
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('mouseup', onUp);
    doc.addEventListener('dblclick', onDbl);
    doc.addEventListener('keydown', function (e) { WB.onKey(e); });
    doc.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) e.preventDefault(); });
    doc.addEventListener('mouseleave', function () { if (WB.ui) WB.ui.hover.style.display = 'none'; });
  });
})();
