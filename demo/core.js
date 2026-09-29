(function () {
  var WB = window.WB = window.WB || {};
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var NO_LOC = { html: 1, head: 1, body: 1, meta: 1, title: 1, style: 1, script: 1, link: 1 };
  var TAG_RE = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

  WB.state = { page: 'simple', source: '', history: [], mode: 'direct', writeMode: 'safe', device: 'desktop', selected: null, selGen: null, changed: null, marks: [], tool: 'ghost', adding: false };
  WB.onRender = [];

  function $(s) { return document.querySelector(s); }
  WB.$ = $;

  WB.esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  WB.attr = function (attrs, name) {
    var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(attrs || '');
    return m ? (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : null;
  };

  // 把代码拆成一个个元素，记下每个元素在代码里的起止位置和行号
  WB.parse = function (src) {
    var elements = [], stack = [], scripts = [], style = null, m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(src))) {
      if (!m[2]) continue;
      var tag = m[2].toLowerCase();
      if (m[1]) {
        for (var k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === tag) {
            stack[k].closeStart = m.index;
            stack[k].closeEnd = TAG_RE.lastIndex;
            stack.length = k;
            break;
          }
        }
        continue;
      }
      var info = { tag: tag, openStart: m.index, openEnd: TAG_RE.lastIndex, attrs: m[3] || '' };
      if (tag === 'script' || tag === 'style') {
        var end = src.indexOf('</' + tag, info.openEnd);
        if (end < 0) end = src.length;
        if (tag === 'script') scripts.push([info.openEnd, end]); else style = [info.openEnd, end];
        TAG_RE.lastIndex = end;
        continue;
      }
      if (VOID[tag] || m[4]) { info.closeStart = info.closeEnd = info.openEnd; info.isVoid = true; }
      else stack.push(info);
      if (!NO_LOC[tag]) { info.i = elements.length; elements.push(info); }
    }
    var lineStarts = [0];
    for (var p = 0; p < src.length; p++) if (src.charCodeAt(p) === 10) lineStarts.push(p + 1);
    function lineOf(off) {
      var lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
      return lo + 1;
    }
    elements.forEach(function (el) {
      if (el.closeStart == null) el.closeStart = el.closeEnd = el.openEnd;
      el.text = src.slice(el.openEnd, el.closeStart);
      el.textOnly = !el.isVoid && el.text.indexOf('<') < 0;
      el.line = lineOf(el.openStart);
      el.endLine = lineOf(Math.max(el.openStart, el.closeEnd - 1));
      el.classes = (WB.attr(el.attrs, 'class') || '').split(/\s+/).filter(Boolean);
      el.style = WB.attr(el.attrs, 'style') || '';
    });
    return { src: src, elements: elements, scripts: scripts, style: style, lineStarts: lineStarts, lineOf: lineOf };
  };

  WB.setSource = function (src) { WB.state.source = src; WB.parsed = WB.parse(src); };

  WB.parseStyle = function (str) {
    return (str || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var i = s.indexOf(':');
      return [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
    });
  };

  function applyProps(pairs, props) {
    Object.keys(props).forEach(function (k) {
      var idx = -1, v = props[k];
      pairs.forEach(function (p, j) { if (p[0] === k) idx = j; });
      if (v == null || v === '') { if (idx >= 0) pairs.splice(idx, 1); }
      else if (idx >= 0) pairs[idx][1] = v;
      else pairs.push([k, v]);
    });
    return pairs;
  }
  function joinPairs(pairs) { return pairs.map(function (p) { return p[0] + ': ' + p[1] + ';'; }).join(' '); }

  WB.getStyleProp = function (info, prop) {
    var v = null;
    WB.parseStyle(info.style).forEach(function (p) { if (p[0] === prop) v = p[1]; });
    return v;
  };

  // 只改这一个元素开头那一小段里的 style="..."，其余代码原样保留
  WB.setInlineStyle = function (src, info, props) {
    var styleStr = joinPairs(applyProps(WB.parseStyle(info.style), props));
    var open = src.slice(info.openStart, info.openEnd), out;
    var re = /\sstyle\s*=\s*("[^"]*"|'[^']*')/i;
    if (re.test(open)) {
      out = open.replace(re, function () { return styleStr ? ' style="' + styleStr + '"' : ''; });
    } else if (styleStr) {
      out = open.replace(/\s*(\/?)>$/, function (all, slash) { return ' style="' + styleStr + '"' + (slash ? ' /' : '') + '>'; });
    } else {
      out = open;
    }
    return { src: src.slice(0, info.openStart) + out + src.slice(info.openEnd), style: styleStr };
  };

  // 错误示范 B 用：改的是 <style> 里的共用规则
  WB.setCssRule = function (src, selector, props) {
    var p = WB.parse(src);
    if (!p.style) return null;
    var css = src.slice(p.style[0], p.style[1]);
    var escSel = selector.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
    var m = new RegExp('(\\n[ \\t]*)' + escSel + '\\s*\\{([^}]*)\\}').exec(css), out;
    if (m) {
      var body = joinPairs(applyProps(WB.parseStyle(m[2]), props));
      out = css.slice(0, m.index) + m[1] + selector + ' { ' + body + ' }' + css.slice(m.index + m[0].length);
    } else {
      var nb = joinPairs(applyProps([], props));
      out = css.replace(/(\n[ \t]*)$/, function (all, tail) { return '\n    ' + selector + ' { ' + nb + ' }' + tail; });
    }
    return src.slice(0, p.style[0]) + out + src.slice(p.style[1]);
  };

  WB.cssText = function (src) {
    var p = WB.parse(src);
    return p.style ? src.slice(p.style[0], p.style[1]) : '';
  };

  WB.diffLines = function (a, b) {
    var A = a.split('\n'), B = b.split('\n'), p = 0, s = 0;
    while (p < A.length && p < B.length && A[p] === B[p]) p++;
    while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    return { start: p + 1, end: B.length - s, removed: A.length - s - p, added: B.length - s - p, total: B.length };
  };

  // 给每个元素挂上看不见的门牌号 data-loc，只存在于预览里，右边显示的代码里没有
  WB.instrument = function (parsed) {
    var out = parsed.src;
    for (var k = parsed.elements.length - 1; k >= 0; k--) {
      var el = parsed.elements[k], pos = el.openEnd - 1;
      if (out.charAt(pos - 1) === '/') pos--;
      out = out.slice(0, pos) + ' data-loc="' + el.i + '"' + out.slice(pos);
    }
    return out;
  };

  WB.render = function (after) {
    var frame = WB.frame, y = 0;
    try { y = WB._resetScroll ? 0 : (frame.contentWindow.scrollY || 0); } catch (e) {}
    WB._resetScroll = false;
    frame.onload = function () {
      WB.win = frame.contentWindow;
      WB.doc = frame.contentDocument;
      try { WB.win.scrollTo(0, y); } catch (e) {}
      WB.ensureUi();
      WB.onRender.forEach(function (fn) { fn(WB.doc); });
      WB.refreshSelection();
      if (after) setTimeout(after, 60);
    };
    frame.srcdoc = WB.instrument(WB.parsed);
  };

  WB.ensureUi = function () {
    var d = WB.doc, st = d.createElement('style'), root = d.createElement('div');
    st.id = '__wb_ui_style';
    st.textContent =
      '#__wb_ui{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;font:12px/20px "Microsoft YaHei",sans-serif}' +
      '#__wb_ui .h{position:absolute;display:none;border:1px dashed #4c7dff}' +
      '#__wb_ui .s{position:absolute;display:none;border:2px solid #4c7dff;border-radius:3px}' +
      '#__wb_ui .s span{position:absolute;left:-2px;top:-22px;padding:0 6px;background:#4c7dff;color:#fff;border-radius:4px 4px 0 0;white-space:nowrap}' +
      '#__wb_ui .g i{position:absolute;background:#ff3b7f}' +
      '#__wb_ui .f i{position:absolute;border:2px solid #ff9f1a;background:rgba(255,159,26,.14);border-radius:3px;animation:__wbfade 2.6s forwards}' +
      '#__wb_ui .lb{position:absolute;display:none;padding:2px 8px;background:#1f2430;color:#fff;border-radius:4px;white-space:nowrap}' +
      '@keyframes __wbfade{0%,70%{opacity:1}100%{opacity:0}}';
    root.id = '__wb_ui';
    root.innerHTML = '<div class="h"></div><div class="s"><span></span></div><div class="g"></div><div class="f"></div><div class="lb"></div>';
    d.head.appendChild(st);
    d.body.appendChild(root);
    var c = root.children;
    WB.ui = { root: root, hover: c[0], sel: c[1], selTag: c[1].firstChild, guides: c[2], flash: c[3], label: c[4] };
  };

  WB.pageRect = function (el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + WB.win.scrollX, y: r.top + WB.win.scrollY, w: r.width, h: r.height };
  };
  WB.place = function (box, r, pad) {
    pad = pad || 0;
    box.style.left = (r.x - pad) + 'px';
    box.style.top = (r.y - pad) + 'px';
    box.style.width = (r.w + pad * 2) + 'px';
    box.style.height = (r.h + pad * 2) + 'px';
  };

  WB.isUi = function (node) {
    for (var n = node; n && n.nodeType === 1; n = n.parentElement) if (n.id && n.id.indexOf('__wb') === 0) return true;
    return false;
  };
  // 点到的元素：有门牌号就用它；没有门牌号的是程序运行时生成的
  WB.pick = function (node) {
    if (!node || node.nodeType !== 1 || WB.isUi(node)) return null;
    if (node.tagName === 'BODY' || node.tagName === 'HTML') return null;
    return node;
  };
  WB.infoOf = function (el) {
    return el && el.hasAttribute && el.hasAttribute('data-loc') ? WB.parsed.elements[+el.getAttribute('data-loc')] : null;
  };
  WB.byLoc = function (i) { return WB.doc ? WB.doc.querySelector('[data-loc="' + i + '"]') : null; };

  WB.describe = function (el) {
    var info = WB.infoOf(el), t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length > 16) t = t.slice(0, 16) + '…';
    var cls = el.getAttribute('class');
    return '<' + el.tagName.toLowerCase() + (cls ? ' class="' + cls + '"' : '') + '>' +
      (info ? '（第 ' + info.line + ' 行）' : '（程序生成，代码里没有直接对应的一行）') + (t ? '「' + t + '」' : '');
  };

  WB.selectedNode = function () {
    if (!WB.doc) return null;
    if (WB.state.selected != null) return WB.byLoc(WB.state.selected);
    return WB.state.selGen && WB.state.selGen.isConnected ? WB.state.selGen : null;
  };
  WB.select = function (el) {
    WB.state.selected = null;
    WB.state.selGen = null;
    if (el) {
      if (el.hasAttribute('data-loc')) WB.state.selected = +el.getAttribute('data-loc');
      else WB.state.selGen = el;
    }
    WB.refreshSelection();
    WB.renderCode('sel');
    if (WB.updateProps) WB.updateProps();
  };
  WB.refreshSelection = function () {
    var el = WB.selectedNode(), info = WB.infoOf(el);
    if (WB.ui) WB.ui.selTag.textContent = !el ? '' : info ? '<' + info.tag + '> 第 ' + info.line + ' 行' : '<' + el.tagName.toLowerCase() + '> 无门牌号';
  };

  function hl(line) {
    var out = '', re = /("[^"]*"|'[^']*')|(<\/?[a-zA-Z][\w-]*|\/?>)/g, last = 0, m;
    while ((m = re.exec(line))) {
      out += WB.esc(line.slice(last, m.index)) + '<span class="' + (m[1] ? 'cs' : 'ct') + '">' + WB.esc(m[0]) + '</span>';
      last = re.lastIndex;
    }
    return out + WB.esc(line.slice(last));
  }

  WB.renderCode = function (scroll) {
    var lines = WB.state.source.split('\n'), sel = WB.infoOf(WB.selectedNode()), ch = WB.state.changed, html = [];
    for (var i = 0; i < lines.length; i++) {
      var n = i + 1, cls = 'ln';
      if (sel && n >= sel.line && n <= sel.endLine) cls += ' sel';
      if (ch && n >= ch.start && n <= ch.end) cls += ' chg';
      html.push('<div class="' + cls + '"><span class="no">' + n + '</span><span class="tx">' + (hl(lines[i]) || ' ') + '</span></div>');
    }
    WB.codeEl.innerHTML = html.join('');
    var sum = [];
    if (ch) {
      if (ch.added > 0) sum.push('上一步改动：第 ' + ch.start + (ch.end > ch.start ? '–' + ch.end : '') + ' 行（绿色）');
      else if (ch.removed > 0) sum.push('上一步删除了原第 ' + ch.start + ' 行起的 ' + ch.removed + ' 行');
    }
    if (sel) sum.push('选中：第 ' + sel.line + (sel.endLine > sel.line ? '–' + sel.endLine : '') + ' 行（蓝色）');
    sum.push('共 ' + lines.length + ' 行');
    $('#codeSummary').textContent = sum.join(' · ');
    var target = scroll === 'change' && ch && ch.added > 0 ? ch.start : scroll === 'sel' && sel ? sel.line : 0;
    var row = target && WB.codeEl.children[target - 1];
    if (row) WB.codeEl.scrollTop = row.offsetTop - WB.codeEl.clientHeight / 2;
  };

  WB.commit = function (newSrc, opt) {
    var old = WB.state.source;
    if (newSrc === old) return false;
    WB.state.history.push(old);
    WB.setSource(newSrc);
    WB.state.changed = WB.diffLines(old, newSrc);
    if (opt.desc) WB.log(opt.desc, WB.state.changed);
    if (opt.rerender) WB.render(opt.after);
    else {
      if (opt.hot) opt.hot(WB.doc);
      if (opt.after) setTimeout(opt.after, 30);
    }
    WB.renderCode('change');
    if (WB.updateProps) WB.updateProps();
    return true;
  };

  WB.undo = function () {
    var h = WB.state.history;
    if (!h.length) { WB.verdict('gray', '没有可以撤销的了'); return; }
    var old = WB.state.source, prev = h.pop();
    WB.setSource(prev);
    WB.state.changed = WB.diffLines(old, prev);
    WB.state.selected = null;
    WB.state.selGen = null;
    WB.render();
    WB.renderCode('change');
    WB.log('撤销上一步');
    WB.verdict('gray', '已撤销上一步', '页面按撤销后的代码重新画了一遍。');
    if (WB.updateProps) WB.updateProps();
  };

  WB.log = function (text, ch) {
    var li = document.createElement('li'), d = new Date();
    var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    li.innerHTML = '<b>' + t + '</b> ' + WB.esc(text) + (ch && ch.added + ch.removed > 0 ? ' <em>改动 ' + Math.max(ch.added, ch.removed) + ' 行</em>' : '');
    WB.logEl.insertBefore(li, WB.logEl.firstChild);
  };

  var LEVEL = { green: '绿灯 · 已直接写回', yellow: '黄灯 · 已写回，注意连带影响', red: '红灯 · 不宜直接写回', bad: '错误示范', gray: '提示' };
  WB.verdict = function (level, title, detail, actions) {
    var v = WB.verdictEl;
    v.className = 'verdict v-' + level;
    v.innerHTML = '<div class="v-head"><i></i>' + LEVEL[level] + '</div><div class="v-title">' + WB.esc(title) + '</div>' +
      (detail ? '<div class="v-detail">' + WB.esc(detail) + '</div>' : '') + '<div class="v-actions"></div>';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.textContent = a.label;
      b.onclick = a.fn;
      v.lastChild.appendChild(b);
    });
  };

  function running(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.getAnimations && n.getAnimations().some(function (a) { return a.playState === 'running'; })) return true;
    }
    return false;
  }
  WB.snap = function () {
    var map = {};
    if (!WB.doc) return map;
    WB.doc.querySelectorAll('[data-loc]').forEach(function (el) {
      if (!running(el)) map[el.getAttribute('data-loc')] = WB.pageRect(el);
    });
    return map;
  };
  // 波及检测：对比改动前后，除了你动的那个（和它的外框、里面的东西），还有谁被挪了
  WB.running = running;
  WB.collateral = function (before, target, remap, skip) {
    var after = WB.snap(), moved = [];
    Object.keys(before).forEach(function (k) {
      var nk = remap ? remap(+k) : +k;
      if (nk == null || !after[nk] || (skip && skip.indexOf(nk) >= 0)) return;
      var el = WB.byLoc(nk);
      if (!el || (target && (el === target || el.contains(target) || target.contains(el)))) return;
      var a = before[k], b = after[nk];
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1 || Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1) moved.push(el);
    });
    return moved.filter(function (el) { return !moved.some(function (o) { return o !== el && o.contains(el); }); });
  };

  WB.flash = function (els, color) {
    if (!WB.ui) return;
    var f = WB.ui.flash;
    f.innerHTML = '';
    els.forEach(function (el) {
      var i = WB.doc.createElement('i');
      WB.place(i, WB.pageRect(el), 1);
      if (color) i.style.borderColor = color;
      f.appendChild(i);
    });
    clearTimeout(WB._ft);
    WB._ft = setTimeout(function () { f.innerHTML = ''; }, 2600);
  };

  function activate(groupSel, attr, value) {
    document.querySelectorAll(groupSel + ' button').forEach(function (b) { b.classList.toggle('on', b.dataset[attr] === value); });
  }

  var TIPS = {
    simple: '试试：单击选中标题 → 再按住拖动 → 双击改字 → 方向键微调。然后把上方“写回方式”换成错误示范 A，再拖一次标题。',
    complex: '试试：拖「今日上新」和大标题（都带动画）、改卡片标题字号、双击改商品名和价格。再换成错误示范 B / C 对比。'
  };
  WB.loadPage = function (key) {
    var s = WB.state;
    s.page = key; s.history = []; s.changed = null; s.selected = null; s.selGen = null; s.marks = [];
    WB.setSource(WB.pages[key].source);
    WB._resetScroll = true;
    WB.render();
    WB.renderCode();
    WB.logEl.innerHTML = '';
    activate('#pageTabs', 'page', key);
    WB.verdict('gray', '已打开「' + WB.pages[key].name + '」', TIPS[key]);
    if (WB.updateProps) WB.updateProps();
    if (WB.renderMarks) WB.renderMarks();
  };

  var MODE_TIPS = {
    safe: ['安全写回（推荐）', '只改你动的那个元素的那一项；挪位走单独的 translate 通道，不碰动画，也不挤别人。'],
    absolute: ['错误示范 A：拔出队伍', '挪动时改成绝对定位（position: absolute）。试试把标题往下拖一点，看下面的内容怎么往上补位；再切到“手机”看看。'],
    shared: ['错误示范 B：改共用样式', '改字号、颜色或挪动时，写进大家共用的 class 规则。试试改复杂页任意一张卡片标题的字号。'],
    transform: ['错误示范 C：和动画抢通道', '挪动写进 transform，而动画也在用 transform。试试拖复杂页的「今日上新」或大标题，松手看它还在不在你放的位置。']
  };
  WB.setWriteMode = function (m) {
    WB.state.writeMode = m;
    WB.verdict(m === 'safe' ? 'gray' : 'bad', MODE_TIPS[m][0], MODE_TIPS[m][1]);
  };

  WB.setMode = function (mode) {
    WB.state.mode = mode;
    WB.state.adding = false;
    activate('#modeTabs', 'mode', mode);
    $('#paneDirect').hidden = mode !== 'direct';
    $('#paneSketch').hidden = mode !== 'sketch';
    $('#writeModeWrap').style.visibility = mode === 'direct' ? 'visible' : 'hidden';
    document.body.dataset.mode = mode;
    if (WB.ui) WB.ui.hover.style.display = 'none';
    if (WB.onModeChange) WB.onModeChange(mode);
    if (mode === 'sketch') WB.verdict('gray', '草图模式：随便摆、随便画，代码一行都不会变', '选好左边的工具，在页面上操作。每个标记都能写一句要求，攒够了点“生成交给 AI 的任务单”。');
  };

  WB.setDevice = function (d) {
    WB.state.device = d;
    WB.frame.style.width = d === 'mobile' ? '390px' : '100%';
    WB.frame.parentElement.classList.toggle('mobile', d === 'mobile');
    activate('#deviceTabs', 'device', d);
  };

  function loop() {
    try {
      var el = WB.selectedNode(), s = WB.ui && WB.ui.sel;
      if (s) {
        if (el && WB.state.mode === 'direct') { s.style.display = 'block'; WB.place(s, WB.pageRect(el), 2); }
        else s.style.display = 'none';
      }
    } catch (e) {}
    requestAnimationFrame(loop);
  }

  WB.init = function () {
    WB.frame = $('#frame');
    WB.codeEl = $('#code');
    WB.verdictEl = $('#verdict');
    WB.logEl = $('#log');
    document.querySelectorAll('#pageTabs button').forEach(function (b) { b.onclick = function () { WB.loadPage(b.dataset.page); }; });
    document.querySelectorAll('#modeTabs button').forEach(function (b) { b.onclick = function () { WB.setMode(b.dataset.mode); }; });
    document.querySelectorAll('#deviceTabs button').forEach(function (b) { b.onclick = function () { WB.setDevice(b.dataset.device); }; });
    $('#writeMode').onchange = function () { WB.setWriteMode(this.value); };
    $('#btnUndo').onclick = WB.undo;
    $('#btnRerender').onclick = function () {
      WB.render(function () { WB.verdict('gray', '已完全按右边的代码重新画了一遍', '和刚才看到的一样，说明画面和代码是一致的。'); });
    };
    $('#btnReset').onclick = function () { WB.loadPage(WB.state.page); };
    $('#btnHelp').onclick = function () { $('#helpModal').hidden = false; };
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('.modal').hidden = true; }; });
    document.addEventListener('keydown', function (e) { if (WB.onKey) WB.onKey(e); });
    WB.setMode('direct');
    WB.setDevice('desktop');
    WB.loadPage('simple');
    requestAnimationFrame(loop);
  };
})();
