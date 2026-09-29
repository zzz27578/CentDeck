// 智能参考线（PPT 式）：边/中线对齐 + 等间距；纯计算，坐标一律用页面坐标
const R = (b) => b.x + b.w, B = (b) => b.y + b.h;

// refs：参与对齐的元素矩形；peers：同一排/列里参与等间距判断的兄弟矩形
export function buildIndex(refs) {
  const xs = [], ys = [];
  refs.forEach((b) => {
    xs.push({ v: b.x, b }, { v: b.x + b.w / 2, b }, { v: R(b), b });
    ys.push({ v: b.y, b }, { v: b.y + b.h / 2, b }, { v: B(b), b });
  });
  return { xs, ys, refs };
}

function best(edges, cands, T) {
  let hit = null;
  edges.forEach((e) => cands.forEach((c) => {
    const d = c.v - e;
    if (Math.abs(d) <= T && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, v: c.v };
  }));
  return hit;
}

const overlapY = (a, b) => Math.min(B(a), B(b)) - Math.max(a.y, b.y) > 0;
const overlapX = (a, b) => Math.min(R(a), R(b)) - Math.max(a.x, b.x) > 0;

// 等间距吸附（一个方向）：返回 { d, marks:[[a,b]...] } 或 null
function gapSnap(m, peers, T, horiz) {
  const lo = horiz ? (b) => b.x : (b) => b.y;
  const hi = horiz ? R : B;
  const row = peers.filter((p) => (horiz ? overlapY(p, m) : overlapX(p, m)));
  if (!row.length) return null;
  let L = null, Rn = null;
  row.forEach((p) => {
    if (hi(p) <= lo(m) + T && (!L || hi(p) > hi(L))) L = p;
    if (lo(p) >= hi(m) - T && (!Rn || lo(p) < lo(Rn))) Rn = p;
  });
  const cands = [];
  if (L && Rn) { // 夹在两个之间：两边间距相等
    const gl = lo(m) - hi(L), gr = lo(Rn) - hi(m);
    cands.push({ d: (gr - gl) / 2, marks: 'between', L, Rn });
  }
  const sorted = row.slice().sort((a, b) => lo(a) - lo(b));
  for (let i = 0; i + 1 < sorted.length; i++) {
    const g = lo(sorted[i + 1]) - hi(sorted[i]);
    if (g <= 0) continue;
    if (L) cands.push({ d: g - (lo(m) - hi(L)), pair: [sorted[i], sorted[i + 1]], side: 'L', L });
    if (Rn) cands.push({ d: (lo(Rn) - hi(m)) - g, pair: [sorted[i], sorted[i + 1]], side: 'R', Rn });
  }
  let pick = null;
  cands.forEach((c) => { if (Math.abs(c.d) <= T && (!pick || Math.abs(c.d) < Math.abs(pick.d))) pick = c; });
  return pick;
}

function gapMarks(m, pick, horiz) {
  const out = [];
  const mk = (a, b) => {
    if (horiz) {
      const y = (Math.max(a.y, b.y) + Math.min(B(a), B(b))) / 2;
      out.push({ x1: R(a), y1: y, x2: b.x, y2: y, label: Math.round(b.x - R(a)) });
    } else {
      const x = (Math.max(a.x, b.x) + Math.min(R(a), R(b))) / 2;
      out.push({ x1: x, y1: B(a), x2: x, y2: b.y, label: Math.round(b.y - B(a)) });
    }
  };
  if (pick.marks === 'between') { mk(pick.L, m); mk(m, pick.Rn); return out; }
  mk(pick.pair[0], pick.pair[1]);
  if (pick.side === 'L') mk(pick.L, m); else mk(m, pick.Rn);
  return out;
}

// 移动吸附：m 为"按鼠标原始位移摆好"的矩形；返回修正量 + 要画的线
export function snapMove(m, index, peers, T, { lockX = false, lockY = false } = {}) {
  let dx = 0, dy = 0, gapX = null, gapY = null;
  if (!lockX) {
    const e = best([m.x, m.x + m.w / 2, R(m)], index.xs, T);
    const g = gapSnap(m, peers, T, true);
    if (g && (!e || Math.abs(g.d) < Math.abs(e.d) - 0.01)) { dx = g.d; gapX = g; } else if (e) dx = e.d;
  }
  if (!lockY) {
    const e = best([m.y, m.y + m.h / 2, B(m)], index.ys, T);
    const g = gapSnap(m, peers, T, false);
    if (g && (!e || Math.abs(g.d) < Math.abs(e.d) - 0.01)) { dy = g.d; gapY = g; } else if (e) dy = e.d;
  }
  const f = { x: m.x + dx, y: m.y + dy, w: m.w, h: m.h };
  return { dx, dy, ...linesFor(f, index), gaps: [...(gapX ? gapMarks(f, gapX, true) : []), ...(gapY ? gapMarks(f, gapY, false) : [])], snapped: !!(dx || dy || gapX || gapY) };
}

// 当前位置和哪些参照完全对齐 → 参考线（一条线从移动框延伸到对齐的那个框）
export function linesFor(f, index) {
  const lines = [];
  const byX = new Map(), byY = new Map();
  [f.x, f.x + f.w / 2, R(f)].forEach((e) => index.xs.forEach((c) => {
    if (Math.abs(c.v - e) < 0.6) { const k = Math.round(c.v * 2) / 2; const s = byX.get(k) || { lo: f.y, hi: B(f) }; s.lo = Math.min(s.lo, c.b.y); s.hi = Math.max(s.hi, B(c.b)); byX.set(k, s); }
  }));
  [f.y, f.y + f.h / 2, B(f)].forEach((e) => index.ys.forEach((c) => {
    if (Math.abs(c.v - e) < 0.6) { const k = Math.round(c.v * 2) / 2; const s = byY.get(k) || { lo: f.x, hi: R(f) }; s.lo = Math.min(s.lo, c.b.x); s.hi = Math.max(s.hi, R(c.b)); byY.set(k, s); }
  }));
  byX.forEach((s, x) => lines.push({ x1: x, y1: s.lo, x2: x, y2: s.hi }));
  byY.forEach((s, y) => lines.push({ x1: s.lo, y1: y, x2: s.hi, y2: y }));
  return { lines };
}

// 缩放/改宽高时单条边的吸附
export function snapEdge(v, cands, T) {
  let hit = null;
  cands.forEach((c) => { const d = c.v - v; if (Math.abs(d) <= T && (!hit || Math.abs(d) < Math.abs(hit))) hit = d; });
  return hit || 0;
}
