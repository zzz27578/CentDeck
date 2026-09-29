// tokens.js —— 内置插件：设计规范（手动版）
// 面板编辑 tokens：颜色（可增删改色）、字号阶梯、间距阶梯、圆角；4 套预设一键套用。
// "应用到全站"：按 tokens 重生成每个页面 <style id="cd-tokens"> 的内容（GET 每页源码→替换块→PUT），
// 并 PUT design/tokens.json（走 /file 接口）。导入（.json 覆盖）、导出（下载当前 tokens.json）。

import { api } from './api.js';
import { el, esc, toast, confirmDlg } from './ui.js';

// 4 套预设（与模板 tokens.json 同构）
export const PRESETS = {
  '科技蓝': {
    colors: { brand: '#3d5af1', brandDeep: '#2b3fbf', accent: '#7c5cff', bg: '#f6f7fb', text: '#1b2233', muted: '#5b6478', card: '#ffffff', border: '#e6e9f2' },
    fontSizes: ['12px', '14px', '16px', '20px', '28px', '44px'],
    spacing: ['8px', '16px', '24px', '40px', '64px'],
    radius: ['8px', '14px', '24px'],
  },
  '暖纸橘': {
    colors: { brand: '#e0703a', brandDeep: '#c4521f', accent: '#3a7d6b', bg: '#faf6f0', text: '#2e2620', muted: '#7d7268', card: '#fffdf9', border: '#ece2d4' },
    fontSizes: ['12px', '14px', '17px', '22px', '30px', '46px'],
    spacing: ['10px', '18px', '28px', '44px', '72px'],
    radius: ['10px', '18px', '28px'],
  },
  '墨绿': {
    colors: { brand: '#1f6f50', brandDeep: '#14503a', accent: '#c9a227', bg: '#f4f7f4', text: '#1c2a24', muted: '#5f7168', card: '#ffffff', border: '#dde7e0' },
    fontSizes: ['12px', '14px', '16px', '21px', '30px', '42px'],
    spacing: ['8px', '16px', '26px', '42px', '68px'],
    radius: ['6px', '12px', '20px'],
  },
  '暗夜紫': {
    colors: { brand: '#9d7bff', brandDeep: '#7a5ae0', accent: '#4cc9f0', bg: '#14121c', text: '#eceaf4', muted: '#9a94b0', card: '#1e1b2a', border: '#332e48' },
    fontSizes: ['12px', '14px', '16px', '20px', '28px', '46px'],
    spacing: ['8px', '16px', '24px', '40px', '64px'],
    radius: ['10px', '16px', '26px'],
  },
};

// tokens → <style id="cd-tokens"> 里的 :root CSS（变量名与模板约定一致）
function tokensToCss(t) {
  const c = t.colors || {};
  const fs = t.fontSizes || [];
  const sp = t.spacing || [];
  const rd = t.radius || [];
  const lines = [':root{'];
  const colorVar = { brand: 'brand', brandDeep: 'brand-deep', accent: 'accent', bg: 'bg', text: 'text', muted: 'muted', card: 'card', border: 'border' };
  Object.keys(c).forEach((k) => {
    lines.push(`  --${colorVar[k] || k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${c[k]};`);
  });
  const fsNames = ['fs-s', 'fs-m', 'fs-body', 'fs-h3', 'fs-h2', 'fs-h1'];
  fs.forEach((v, i) => lines.push(`  --${fsNames[i] || 'fs-x' + i}:${v};`));
  sp.forEach((v, i) => lines.push(`  --sp-${i + 1}:${v};`));
  if (rd[0]) lines.push(`  --radius-s:${rd[0]};`);
  if (rd[1]) lines.push(`  --radius:${rd[1]};`);
  if (rd[2]) lines.push(`  --radius-l:${rd[2]};`);
  lines.push('}');
  return lines.join('\n');
}

function cur() {
  const p = ctxOf().project();
  if (!p) return null;
  if (!p.tokens) p.tokens = { colors: {}, fontSizes: [], spacing: [], radius: [] };
  return p.tokens;
}
let ctxRef = null;
function ctxOf() { return ctxRef; }

export function setup(ctx) {
  ctxRef = ctx;
  const { bus } = ctx;

  // ---------- 保存 tokens 到 design/tokens.json（file 接口） ----------
  async function saveTokensFile() {
    const proj = ctx.project();
    await api.writeFile(proj.id, 'design/tokens.json', JSON.stringify(cur(), null, 2) + '\n');
    bus.emit('tokens');
  }

  // ---------- 应用到全站 ----------
  async function applyToSite() {
    const proj = ctx.project();
    const t = cur();
    const css = tokensToCss(t);
    const block = `<style id="cd-tokens">${css}</style>`;
    const ok = await confirmDlg({
      title: '应用到全站',
      okLabel: '应用',
      body: `将按当前规范重写 <b>${proj.pages.length} 个页面</b>的 &lt;style id="cd-tokens"&gt; 块，<br>并保存 design/tokens.json。改一次规范，全站生效。继续吗？`,
    });
    if (!ok) return;
    try {
      await saveTokensFile();
      let done = 0;
      for (const pg of proj.pages) {
        const src = await api.readFile(proj.id, pg.file);
        let next;
        if (/<style\s+id="cd-tokens"[^>]*>[\s\S]*?<\/style>/i.test(src)) {
          next = src.replace(/<style\s+id="cd-tokens"[^>]*>[\s\S]*?<\/style>/i, () => block);
        } else {
          // 没有 tokens 块：插到 </head> 前
          const hi = src.indexOf('</head>');
          next = hi < 0 ? src : src.slice(0, hi) + block + '\n' + src.slice(hi);
        }
        if (next !== src) await api.writeFile(proj.id, pg.file, next);
        done++;
      }
      toast(`已应用到 ${done} 个页面`, 'ok');
      await ctx.reloadCurrentPage();
    } catch { /* api 已提示 */ }
  }

  function applyPreset(name) {
    const t = cur();
    const p = PRESETS[name];
    const old = JSON.parse(JSON.stringify(t));
    bus.doMeta({
      label: `套用预设「${name}」`,
      apply: () => { Object.keys(t).forEach((k) => delete t[k]); Object.assign(t, JSON.parse(JSON.stringify(p))); },
      revert: () => { Object.keys(t).forEach((k) => delete t[k]); Object.assign(t, old); },
    }).then(() => paintAll && paintAll());
    toast(`已套用「${name}」，点"应用到全站"让页面生效`, 'ok');
    bus.emit('tokens');
  }

  // ---------- 面板 ----------
  let paintAll = null;
  bus.registerPanel({
    id: 'tokens',
    title: '规范',
    icon: '🎨',
    side: 'left',
    render(host) {
      const proj = ctx.project();
      if (!proj) { host.innerHTML = '<div class="panel-empty">先打开一个项目</div>'; return; }

      const paint = () => {
        const t = cur();
        host.innerHTML = '';
        // 预设
        const pres = el('<div class="panel-actions preset-row"></div>');
        Object.keys(PRESETS).forEach((name) => {
          const b = el(`<button class="btn small" title="一键套用">${esc(name)}</button>`);
          b.onclick = () => applyPreset(name);
          pres.appendChild(b);
        });
        host.appendChild(pres);

        // 颜色
        const colorBox = el('<div class="prop-group"><div class="prop-title">颜色</div></div>');
        Object.keys(t.colors).forEach((k) => {
          const row = el(`<div class="prop-row color-row">
            <span class="color-key">${esc(k)}</span>
            <input type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(t.colors[k]) ? t.colors[k] : '#000000')}">
            <input type="text" class="ipt small" value="${esc(t.colors[k])}">
            <button class="mini-x" title="删除这个颜色">×</button>
          </div>`);
          const [picker, text] = row.querySelectorAll('input');
          picker.onchange = async () => {
            const old = t.colors[k];
            await bus.doMeta({ label: `改规范色 ${k}`, apply: () => { t.colors[k] = picker.value; }, revert: () => { t.colors[k] = old; } });
            text.value = picker.value;
          };
          text.onchange = async () => {
            const v = text.value.trim();
            if (!/^#[0-9a-fA-F]{3,8}$/.test(v)) { toast('颜色格式像 #3d5af1', 'err'); text.value = t.colors[k]; return; }
            const old = t.colors[k];
            await bus.doMeta({ label: `改规范色 ${k}`, apply: () => { t.colors[k] = v; }, revert: () => { t.colors[k] = old; } });
            picker.value = v.length === 7 ? v : '#000000';
          };
          row.querySelector('.mini-x').onclick = async () => {
            const old = t.colors[k];
            await bus.doMeta({ label: `删除规范色 ${k}`, apply: () => { delete t.colors[k]; }, revert: () => { t.colors[k] = old; } });
            paint();
          };
          colorBox.appendChild(row);
        });
        const addColor = el('<button class="btn small">＋ 加颜色</button>');
        addColor.onclick = async () => {
          const key = 'color' + (Object.keys(t.colors).length + 1);
          await bus.doMeta({ label: '新增规范色', apply: () => { t.colors[key] = '#888888'; }, revert: () => { delete t.colors[key]; } });
          paint();
        };
        colorBox.appendChild(addColor);
        host.appendChild(colorBox);

        // 阶梯（字号/间距/圆角）：逗号分隔编辑
        const ladder = (label, key, hint) => {
          const g = el(`<div class="prop-group"><div class="prop-title">${esc(label)}</div>
            <div class="prop-row"><input type="text" class="ipt" value="${esc((t[key] || []).join(', '))}"></div>
            <div class="form-hint">${esc(hint)}</div></div>`);
          const inp = g.querySelector('input');
          inp.onchange = async () => {
            const arr = inp.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
            if (!arr.every((v) => /^\d+(\.\d+)?(px|rem|em|%)$/.test(v))) { toast('每一项要像 16px / 1rem 这样', 'err'); return; }
            const old = (t[key] || []).slice();
            await bus.doMeta({ label: `改${label}`, apply: () => { t[key] = arr; }, revert: () => { t[key] = old; } });
          };
          return g;
        };
        host.appendChild(ladder('字号阶梯', 'fontSizes', '从小到大，逗号分隔；依次对应 --fs-s … --fs-h1'));
        host.appendChild(ladder('间距阶梯', 'spacing', '从小到大，逗号分隔；依次对应 --sp-1 … --sp-5'));
        host.appendChild(ladder('圆角', 'radius', '小 / 中 / 大 三档，对应 --radius-s / --radius / --radius-l'));

        // 动作行
        const acts = el(`<div class="panel-actions stacked">
          <button class="btn primary" id="tk-apply">应用到全站</button>
          <div class="row2"><button class="btn small" id="tk-import">导入 .json</button>
          <button class="btn small" id="tk-export">导出 .json</button></div>
        </div>`);
        acts.querySelector('#tk-apply').onclick = applyToSite;
        acts.querySelector('#tk-export').onclick = () => {
          const blob = new Blob([JSON.stringify(cur(), null, 2) + '\n'], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'tokens.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        };
        acts.querySelector('#tk-import').onclick = () => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = '.json,application/json';
          inp.onchange = async () => {
            const f = inp.files[0];
            if (!f) return;
            try {
              const text = await f.text();
              const data = JSON.parse(text);
              if (!data || typeof data !== 'object') throw new Error('bad');
              const t2 = cur();
              const old = JSON.parse(JSON.stringify(t2));
              await bus.doMeta({
                label: '导入设计规范',
                apply: () => { Object.keys(t2).forEach((k) => delete t2[k]); Object.assign(t2, data); },
                revert: () => { Object.keys(t2).forEach((k) => delete t2[k]); Object.assign(t2, old); },
              });
              toast('已导入，点"应用到全站"让页面生效', 'ok');
              paint();
            } catch {
              toast('文件不是合法的 tokens.json', 'err');
            }
          };
          inp.click();
        };
        host.appendChild(acts);
      };
      paintAll = paint;
      paint();
      this._off = bus.on('tokens', () => { if (host.isConnected) paint(); });
    },
    onHide() { if (this._off) this._off(); paintAll = null; },
  });
}
