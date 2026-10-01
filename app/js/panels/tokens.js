// 设计规范（手动版）：颜色、字号 / 间距 / 圆角阶梯、预设风格；"应用到全站"一次改所有页面
import { el, esc, toast, promptDlg } from '../core/ui.js';
import { injectTokens } from './token-source.js';
import { icon } from '../core/icons.js';

export const PRESETS = {
  科技蓝: { colors: { brand: '#3d5af1', brandDeep: '#2b3fbf', accent: '#7c5cff', bg: '#f6f7fb', text: '#1b2233', muted: '#5b6478', card: '#ffffff', border: '#e6e9f2' }, fontSizes: ['12px', '14px', '16px', '20px', '28px', '44px'], spacing: ['8px', '16px', '24px', '40px', '64px'], radius: ['8px', '14px', '24px'] },
  暖纸橘: { colors: { brand: '#e0703a', brandDeep: '#c4521f', accent: '#3a7d6b', bg: '#faf6f0', text: '#2e2620', muted: '#7d7268', card: '#fffdf9', border: '#ece2d4' }, fontSizes: ['12px', '14px', '17px', '22px', '30px', '46px'], spacing: ['10px', '18px', '28px', '44px', '72px'], radius: ['10px', '18px', '28px'] },
  墨绿: { colors: { brand: '#1f6f50', brandDeep: '#14503a', accent: '#c9a227', bg: '#f4f7f4', text: '#1c2a24', muted: '#5f7168', card: '#ffffff', border: '#dde7e0' }, fontSizes: ['12px', '14px', '16px', '21px', '30px', '42px'], spacing: ['8px', '16px', '26px', '42px', '68px'], radius: ['6px', '12px', '20px'] },
  暗夜紫: { colors: { brand: '#9d7bff', brandDeep: '#7a5ae0', accent: '#4cc9f0', bg: '#14121c', text: '#eceaf4', muted: '#9a94b0', card: '#1e1b2a', border: '#332e48' }, fontSizes: ['12px', '14px', '16px', '20px', '28px', '46px'], spacing: ['8px', '16px', '24px', '40px', '64px'], radius: ['10px', '16px', '26px'] },
};
PRESETS.极简黑白 = {colors:{brand:'#202020',accent:'#757575',bg:'#f7f7f7',text:'#151515',card:'#ffffff',border:'#dddddd'},fontSizes:['12px','14px','16px','24px','36px','56px'],spacing:['8px','16px','24px','48px','80px'],radius:['0px','4px','8px']};
PRESETS.柔和沙岩 = {colors:{brand:'#7b6650',accent:'#788c82',bg:'#f5f1ea',text:'#302c27',card:'#fffdf9',border:'#ddd4c6'},fontSizes:['12px','14px','17px','24px','34px','52px'],spacing:['8px','16px','28px','44px','72px'],radius:['8px','16px','24px']};
const VAR = { brand: 'brand', brandDeep: 'brand-deep', accent: 'accent', bg: 'bg', text: 'text', muted: 'muted', card: 'card', border: 'border' };
export function toCss(t) {
  t=structuredClone(t);
  for(const k of ['fontSizes','spacing','radius'])if(Array.isArray(t[k]))t[k]=t[k].map(v=>typeof v==='number'?v+'px':v);
  const L = [':root{'];
  Object.entries(t.colors || {}).forEach(([k, v]) => L.push(`  --${VAR[k] || k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v};`));
  ['fs-s', 'fs-m', 'fs-body', 'fs-h3', 'fs-h2', 'fs-h1'].forEach((n, i) => { if ((t.fontSizes || [])[i]) L.push(`  --${n}:${t.fontSizes[i]};`); });
  (t.spacing || []).forEach((v, i) => L.push(`  --sp-${i + 1}:${v};`));
  ['radius-s', 'radius', 'radius-l'].forEach((n, i) => { if ((t.radius || [])[i]) L.push(`  --${n}:${t.radius[i]};`); });
  if (t.fontFamily) L.push(`  --font-body:${t.fontFamily};`);
  L.push('}');
  if (t.fontFamily) L.push('body{font-family:var(--font-body)}');
  return L.join('\n');
}

export function setupTokens(app) {
  const { bus } = app;
  const cur = () => { const p = app.project(); if (!p.tokens) p.tokens = { colors: {}, fontSizes: [], spacing: [], radius: [] }; return p.tokens; };
  const replaceAll = (t, next) => { Object.keys(t).forEach((k) => delete t[k]); Object.assign(t, JSON.parse(JSON.stringify(next))); };

  async function applyToSite(options={}) {
    const proj = app.project();
    const pages = proj.pages.filter(p => (!options.files||options.files.includes(p.file))&&!app.pageLocked(p.file) && !(proj.locks?.elements || []).some(l => l.page === p.file));
    if (!pages.length) { toast('没有可应用的页面：先创建页面或解除锁定'); return; }
    const tokens = structuredClone(options.tokens||cur());
    const edits = [];
    try {
      for (const pg of pages) {
        const before = await app.api.readFile(proj.id, pg.file);
        const after = injectTokens(before, toCss(tokens));
        if (before !== after) edits.push({file:pg.file, before, after});
      }
      const write = async direction => {
        if(edits.length)await app.api.commitFiles(proj.id,edits.map(c=>({path:c.file,content:c[direction],before:c[direction==='after'?'before':'after']})));
        if (app.project()?.id === proj.id) await app.reloadView();
      };
      await app.bus.flushMeta();
      await bus.do({label:'应用设计风格到全站',apply:()=>write('after'),revert:()=>write('before')});
      toast(`已应用到 ${pages.length} 页${proj.pages.length > pages.length ? '，已跳过有锁定内容的页面' : ''}，可撤销`, 'ok');
    } catch { /* API 已提示 */ }
  }
  let personal=[];
  const loadPresets=async()=>{personal=await app.api.extension('design-presets');return personal;};
  async function savePreset(tokens,name) {
    const title=await promptDlg({title:'保存为我的预设',label:'预设名称',value:name||'我的风格',okLabel:'保存'});
    if(!title)return;
    personal=await app.api.extension('design-presets',{name:title,tokens},'PUT');bus.emit('presets');toast('已保存，可在其他项目复用','ok');
  }
  app.tokens = { applyToSite, savePreset };


  bus.registerPanel({
    id: 'tokens', title: '设计规范', icon: 'palette', views: ['edit','overview'],
    async render(host) {
      const generation=Symbol();this._generation=generation;
      await loadPresets();if(!host.isConnected||this._generation!==generation)return;
      const paint = () => {
        const t = cur();
        host.innerHTML = '';
        const pre = el('<div class="p-sec"><div class="p-sec-title">预设风格</div><div class="p-actions"></div></div>');
        const overview=app.view()==='overview';
        pre.querySelector('.p-sec-title').textContent=overview?'选择风格 · 添加到画布':'预设风格';
        const list=[...Object.entries(PRESETS).map(([name,tokens])=>({name,tokens})),...personal];
        for(const preset of list){
          const row=el(`<div class="preset-option"><button class="preset-pick"><span class="preset-swatches">${Object.values(preset.tokens.colors).slice(0,4).map(v=>`<i style="background:${v}"></i>`).join('')}</span><b>${esc(preset.name)}</b><small>${preset.id?'我的预设':'官方预设'}</small></button>${preset.id?`<button class="icon-btn sm" data-remove aria-label="删除个人预设">${icon('trash',14)}</button>`:''}</div>`);
          row.querySelector('.preset-pick').onclick=async()=>{
            if(overview){await app.designBoards?.add(preset.tokens,preset.name);toast('已添加到总览画布','ok');return;}
            const old=structuredClone(t);await bus.doMeta({label:`套用预设「${preset.name}」`,apply:()=>replaceAll(t,preset.tokens),revert:()=>replaceAll(t,old)});paint();toast('已载入规范，应用后页面生效','ok');
          };
          row.querySelector('[data-remove]')?.addEventListener('click',async()=>{personal=await app.api.extension('design-presets',{id:preset.id,action:'remove'},'PUT');paint();});
          pre.querySelector('.p-actions').append(row);
        }
        host.appendChild(pre);
        const save=el(`<div class="p-sec"><button class="btn block">${icon('plus',15)}保存当前规范为我的预设</button></div>`);
        save.querySelector('button').onclick=()=>savePreset(t);host.append(save);
        if(overview){const ai=el('<div class="p-sec"><p class="hint">点击预设添加方案卡；从卡片可编辑规范、关联页面、选用或保存 AI 方案。</p><button class="btn block">让助手设计风格</button></div>');ai.querySelector('button').onclick=()=>app.agent.prefill('请为项目设计一套风格，发布可比较的设计规范卡。');host.append(ai);return;}

        const shapes = el(`<div class="p-sec"><div class="p-sec-title">按钮形状</div><div class="seg" data-shape style="width:100%">
          <button data-v="4px" style="flex:1">方角</button><button data-v="10px" style="flex:1">圆角</button><button data-v="999px" style="flex:1">胶囊</button></div>
          <button class="btn small block" data-ai style="margin-top:10px">${icon('sparkle', 14)}让助手出几套配色和按钮样式</button></div>`);
        shapes.querySelectorAll('[data-v]').forEach((b) => {
          b.classList.toggle('on', (t.radius || [])[0] === b.dataset.v);
          b.onclick = async () => {
            const old = (t.radius || []).slice();
            const next = [b.dataset.v, ...(old.length ? old.slice(1) : ['14px', '24px'])];
            await bus.doMeta({ label: '改按钮形状', apply: () => { t.radius = next; }, revert: () => { t.radius = old; } });
            paint();
            toast('按钮形状已改，点"应用到全站"让页面生效', 'ok');
          };
        });
        shapes.querySelector('[data-ai]').onclick = () => app.agent.prefill('请用「设计规范」技能给这个网站出 3 套配色和按钮样式（主色、强调色、背景、文字色、按钮圆角和阴影），每套说明适合什么感觉，做成可以直接应用的 tokens。', { skill: 'design-system' });
        host.appendChild(shapes);
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
        const font = el(`<label class="p-sec set-field">字体<input class="ipt" value="${esc(t.fontFamily || '')}" placeholder="例如 Microsoft YaHei, sans-serif"></label>`);
        font.querySelector('input').onchange = e => { const value = e.target.value.trim(); if (/[;{}<>]/.test(value)) { toast('请填写有效字体名称', 'err'); return; } const old=t.fontFamily; bus.doMeta({label:'修改规范字体',apply:()=>{t.fontFamily=value;},revert:()=>{t.fontFamily=old;}}); };
        host.appendChild(font);
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
        const acts = el(`<div class="p-sec"><p class="hint" style="margin-bottom:10px">应用配色、字号和圆角规范。页面中单独写死的样式需手动调整，或交给助手统一。</p><button class="btn primary block" data-apply>${icon('check', 15)}应用到全站</button>
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
      this._off=bus.on('presets',async()=>{await loadPresets();if(host.isConnected)paint();});
    },
    onHide(){this._generation=null;this._off?.();},
  });
}
