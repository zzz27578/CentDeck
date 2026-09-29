// 设计规范（手动版）：颜色、字号 / 间距 / 圆角阶梯、预设风格；"应用到全站"一次改所有页面
import { el, esc, toast, confirmDlg } from '../core/ui.js';
import { icon } from '../core/icons.js';

export const PRESETS = {
  科技蓝: { colors: { brand: '#3d5af1', brandDeep: '#2b3fbf', accent: '#7c5cff', bg: '#f6f7fb', text: '#1b2233', muted: '#5b6478', card: '#ffffff', border: '#e6e9f2' }, fontSizes: ['12px', '14px', '16px', '20px', '28px', '44px'], spacing: ['8px', '16px', '24px', '40px', '64px'], radius: ['8px', '14px', '24px'] },
  暖纸橘: { colors: { brand: '#e0703a', brandDeep: '#c4521f', accent: '#3a7d6b', bg: '#faf6f0', text: '#2e2620', muted: '#7d7268', card: '#fffdf9', border: '#ece2d4' }, fontSizes: ['12px', '14px', '17px', '22px', '30px', '46px'], spacing: ['10px', '18px', '28px', '44px', '72px'], radius: ['10px', '18px', '28px'] },
  墨绿: { colors: { brand: '#1f6f50', brandDeep: '#14503a', accent: '#c9a227', bg: '#f4f7f4', text: '#1c2a24', muted: '#5f7168', card: '#ffffff', border: '#dde7e0' }, fontSizes: ['12px', '14px', '16px', '21px', '30px', '42px'], spacing: ['8px', '16px', '26px', '42px', '68px'], radius: ['6px', '12px', '20px'] },
  暗夜紫: { colors: { brand: '#9d7bff', brandDeep: '#7a5ae0', accent: '#4cc9f0', bg: '#14121c', text: '#eceaf4', muted: '#9a94b0', card: '#1e1b2a', border: '#332e48' }, fontSizes: ['12px', '14px', '16px', '20px', '28px', '46px'], spacing: ['8px', '16px', '24px', '40px', '64px'], radius: ['10px', '16px', '26px'] },
};
const VAR = { brand: 'brand', brandDeep: 'brand-deep', accent: 'accent', bg: 'bg', text: 'text', muted: 'muted', card: 'card', border: 'border' };
function toCss(t) {
  const L = [':root{'];
  Object.entries(t.colors || {}).forEach(([k, v]) => L.push(`  --${VAR[k] || k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v};`));
  ['fs-s', 'fs-m', 'fs-body', 'fs-h3', 'fs-h2', 'fs-h1'].forEach((n, i) => { if ((t.fontSizes || [])[i]) L.push(`  --${n}:${t.fontSizes[i]};`); });
  (t.spacing || []).forEach((v, i) => L.push(`  --sp-${i + 1}:${v};`));
  ['radius-s', 'radius', 'radius-l'].forEach((n, i) => { if ((t.radius || [])[i]) L.push(`  --${n}:${t.radius[i]};`); });
  L.push('}');
  return L.join('\n');
}

export function setupTokens(app) {
  const { bus } = app;
  const cur = () => { const p = app.project(); if (!p.tokens) p.tokens = { colors: {}, fontSizes: [], spacing: [], radius: [] }; return p.tokens; };
  const replaceAll = (t, next) => { Object.keys(t).forEach((k) => delete t[k]); Object.assign(t, JSON.parse(JSON.stringify(next))); };

  async function applyToSite() {
    const proj = app.project();
    const ok = await confirmDlg({ title: '应用到全站', okLabel: '应用', body: `按当前规范重写 <b>${proj.pages.length} 个页面</b>里的 &lt;style id="cd-tokens"&gt;，并保存 design/tokens.json。` });
    if (!ok) return;
    try {
      await app.api.writeFile(proj.id, 'design/tokens.json', JSON.stringify(cur(), null, 2) + '\n');
      const block = `<style id="cd-tokens">${toCss(cur())}</style>`;
      for (const pg of proj.pages) {
        const src = await app.api.readFile(proj.id, pg.file);
        const re = /<style\s+id="cd-tokens"[^>]*>[\s\S]*?<\/style>/i;
        const next = re.test(src) ? src.replace(re, () => block) : src.replace('</head>', block + '\n</head>');
        if (next !== src) await app.api.writeFile(proj.id, pg.file, next);
      }
      app.bus.clearStacks();
      toast(`已应用到 ${proj.pages.length} 个页面`, 'ok');
      await app.reloadView();
    } catch { /* api 已提示 */ }
  }

  bus.registerPanel({
    id: 'tokens', title: '设计规范', icon: 'palette', views: ['edit', 'overview'],
    render(host) {
      const paint = () => {
        const t = cur();
        host.innerHTML = '';
        const pre = el('<div class="p-sec"><div class="p-sec-title">预设风格</div><div class="p-actions"></div></div>');
        Object.keys(PRESETS).forEach((name) => {
          const b = el(`<button class="btn small"><span style="width:10px;height:10px;border-radius:50%;background:${PRESETS[name].colors.brand}"></span>${esc(name)}</button>`);
          b.onclick = async () => { const old = JSON.parse(JSON.stringify(t)); await bus.doMeta({ label: `套用预设「${name}」`, apply: () => replaceAll(t, PRESETS[name]), revert: () => replaceAll(t, old) }); paint(); toast(`已套用「${name}」，点"应用到全站"让页面生效`, 'ok'); };
          pre.querySelector('.p-actions').appendChild(b);
        });
        host.appendChild(pre);
        const colors = el('<div class="p-sec"><div class="p-sec-title">颜色</div></div>');
        Object.entries(t.colors || {}).forEach(([k, v]) => {
          const row = el(`<div class="p-row"><label style="width:76px">${esc(k)}</label><input type="color" class="color-ipt" value="${/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}"><input class="ipt" value="${esc(v)}" style="flex:1"></div>`);
          const [pick, txt] = row.querySelectorAll('input');
          const set = async (nv) => { const old = t.colors[k]; await bus.doMeta({ label: `改规范色 ${k}`, apply: () => { t.colors[k] = nv; }, revert: () => { t.colors[k] = old; } }); };
          pick.onchange = () => { txt.value = pick.value; set(pick.value); };
          txt.onchange = () => { if (/^#[0-9a-f]{3,8}$/i.test(txt.value.trim())) set(txt.value.trim()); else { toast('颜色写成 #3d5af1 这样', 'err'); txt.value = t.colors[k]; } };
          colors.appendChild(row);
        });
        host.appendChild(colors);
        [['字号阶梯', 'fontSizes'], ['间距阶梯', 'spacing'], ['圆角', 'radius']].forEach(([label, key]) => {
          const g = el(`<div class="p-sec"><div class="p-sec-title">${label}</div><input class="ipt" value="${esc((t[key] || []).join(', '))}"></div>`);
          const i = g.querySelector('input');
          i.onchange = async () => {
            const arr = i.value.split(/[,，\s]+/).filter(Boolean);
            if (!arr.every((v) => /^\d+(\.\d+)?(px|rem|em|%)$/.test(v))) { toast('每一项写成 16px 这样', 'err'); return; }
            const old = (t[key] || []).slice();
            await bus.doMeta({ label: `改${label}`, apply: () => { t[key] = arr; }, revert: () => { t[key] = old; } });
          };
          host.appendChild(g);
        });
        const acts = el(`<div class="p-sec"><button class="btn primary block" data-apply>${icon('check', 15)}应用到全站</button>
          <div class="p-actions" style="margin-top:8px"><button class="btn small" data-exp>导出 tokens.json</button><button class="btn small" data-imp>导入</button></div></div>`);
        acts.querySelector('[data-apply]').onclick = applyToSite;
        acts.querySelector('[data-exp]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(cur(), null, 2)], { type: 'application/json' })); a.download = 'tokens.json'; a.click(); };
        acts.querySelector('[data-imp]').onclick = () => {
          const i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
          i.onchange = async () => { try { const d = JSON.parse(await i.files[0].text()); const old = JSON.parse(JSON.stringify(t)); await bus.doMeta({ label: '导入设计规范', apply: () => replaceAll(t, d), revert: () => replaceAll(t, old) }); paint(); } catch { toast('不是有效的 tokens.json', 'err'); } };
          i.click();
        };
        host.appendChild(acts);
      };
      paint();
    },
  });
}
