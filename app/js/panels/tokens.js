/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 总览选择风格；编辑模式维护独立的页面规范，只应用到当前页。
import { el, esc, toast, promptDlg } from '../core/ui.js';
import { injectTokens } from './token-source.js';
import { icon } from '../core/icons.js';

import { PRESETS } from './style-presets.js';
export { PRESETS };
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
  const cur = () => {
    const p=app.project(),base=p.tokens||{colors:{},fontSizes:[],spacing:[],radius:[]};
    if(app.view()==='edit'&&app.state.page){p.pageTokens||={};return p.pageTokens[app.state.page] ||= structuredClone(base);}
    return p.tokens ||= base;
  };
  const replaceAll = (t, next) => { Object.keys(t).forEach((k) => delete t[k]); Object.assign(t, JSON.parse(JSON.stringify(next))); };

  async function applyToSite(options={}) {
    const proj = app.project();
    const pages = proj.pages.filter(p => (!options.files||options.files.includes(p.file))&&!app.pageLocked(p.file) && !(proj.locks?.elements || []).some(l => l.page === p.file));
    if (!pages.length) { toast(i18nText('没有可应用的页面：先创建页面或解除锁定')); return; }
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
      if(await app.bus.flushMeta()===false)return;
      await bus.do({label:options.files?.length===1?i18nText('应用设计规范到当前页'):i18nText('应用设计规范'),apply:()=>write('after'),revert:()=>write('before')});
      toast(i18nTpl`已应用到 ${pages.length} 页${proj.pages.filter(p=>!options.files||options.files.includes(p.file)).length > pages.length ? i18nText('，已跳过有锁定内容的页面') : ''}，可撤销`, 'ok');
    } catch { /* API 已提示 */ }
  }
  let personal=[];
  const loadPresets=async()=>{personal=await app.api.extension('design-presets');return personal;};
  async function savePreset(tokens,name) {
    const title=await promptDlg({title:i18nText('保存为我的预设'),label:i18nText('预设名称'),value:name||i18nText('我的风格'),okLabel:i18nText('保存')});
    if(!title)return;
    personal=await app.api.extension('design-presets',{name:title,tokens},'PUT');bus.emit('presets');toast(i18nText('已保存，可在其他项目复用'),'ok');
  }
  app.tokens = { applyToSite, savePreset };


  bus.registerPanel({
    id: 'tokens', title: i18nText('设计规范'), icon: 'palette', views: ['edit','overview'],
    async render(host) {
      const generation=Symbol();this._generation=generation;
      if(app.view()==='overview')await loadPresets();
      if(!host.isConnected||this._generation!==generation)return;
      let presetsOpen=false;
      const paint = () => {
        const t = cur();
        host.innerHTML = '';
        const overview=app.view()==='overview';
        if(overview){
          const pre=el(i18nTpl`<details class="preset-disclosure" ${presetsOpen?'open':''}><summary><span>${icon('palette',17)}预设风格</span><small>${Object.keys(PRESETS).length+personal.length} 套</small>${icon('chevDown',16)}</summary><div class="preset-library"></div></details>`);
          pre.ontoggle=()=>{presetsOpen=pre.open;};
          const body=pre.querySelector('.preset-library');
          for(const [title,list] of [[i18nText('官方预设'),Object.entries(PRESETS).map(([name,tokens])=>({name,tokens}))],[i18nText('我的预设'),personal]]){
            const group=el(`<section><div class="p-sec-title">${title}</div><div class="preset-list"></div></section>`);body.append(group);
            if(!list.length)group.querySelector('.preset-list').append(el(i18nText('<p class="hint">从方案卡的菜单保存你的风格，可跨项目使用。</p>')));
            for(const preset of list){
              const row=el(i18nTpl`<div class="preset-option"><button class="preset-pick"><span class="preset-swatches">${Object.values(preset.tokens.colors).slice(0,4).map(v=>`<i style="background:${v}"></i>`).join('')}</span><b>${esc(preset.id?preset.name:i18nText(preset.name))}</b><small>添加到画布</small></button>${preset.id?i18nTpl`<button class="icon-btn sm" data-remove aria-label="删除个人预设">${icon('trash',14)}</button>`:''}</div>`);
              row.querySelector('.preset-pick').onclick=async()=>{await app.designBoards?.add(preset.tokens,preset.id?preset.name:i18nText(preset.name));toast(i18nText('已添加到总览画布'),'ok');};
              row.querySelector('[data-remove]')?.addEventListener('click',async()=>{personal=await app.api.extension('design-presets',{id:preset.id,action:'remove'},'PUT');paint();});
              group.querySelector('.preset-list').append(row);
            }
          }
          host.append(pre);
          const ai=el(i18nTpl`<div class="p-sec"><p class="hint">展开预设选择风格，或让助手为项目设计。方案卡可以编辑、关联页面和保存为个人预设。</p><button class="btn block">${icon('sparkle',15)}让助手设计风格</button></div>`);
          ai.querySelector('button').onclick=()=>app.agent.prefill(i18nText('请为项目设计一套风格，发布可比较的设计规范卡。'));host.append(ai);return;
        }
        host.append(el(i18nText('<div class="p-sec"><p class="hint">调整当前页的配色、字体和间距，应用时只影响当前页。</p></div>')));
        const shapes = el(i18nTpl`<div class="p-sec"><div class="p-sec-title">按钮形状</div><div class="seg" data-shape style="width:100%">
          <button data-v="4px" style="flex:1">方角</button><button data-v="10px" style="flex:1">圆角</button><button data-v="999px" style="flex:1">胶囊</button></div>
          <button class="btn small block" data-ai style="margin-top:10px">${icon('sparkle', 14)}让助手优化当前页样式</button></div>`);
        shapes.querySelectorAll('[data-v]').forEach((b) => {
          b.classList.toggle('on', (t.radius || [])[0] === b.dataset.v);
          b.onclick = async () => {
            const old = (t.radius || []).slice();
            const next = [b.dataset.v, ...(old.length ? old.slice(1) : ['14px', '24px'])];
            await bus.doMeta({ label: i18nText('改按钮形状'), apply: () => { t.radius = next; }, revert: () => { t.radius = old; } });
            paint();
            toast(i18nText('按钮形状已改，点"应用到当前页"让页面生效'), 'ok');
          };
        });
        shapes.querySelector('[data-ai]').onclick = () => app.agent.prefill(i18nTpl`请优化当前页面 ${app.state.page} 的配色、字体和按钮样式，保留内容和交互，不修改其他页面。`, { skill: 'design-system' });
        host.appendChild(shapes);
        const colors = el(i18nText('<div class="p-sec"><div class="p-sec-title">颜色</div></div>'));
        Object.entries(t.colors || {}).forEach(([k, v]) => {
          const row = el(`<div class="p-row"><label style="width:76px">${esc(k)}</label><input type="color" class="color-ipt" value="${/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}"><input class="ipt" value="${esc(v)}" style="flex:1"></div>`);
          const [pick, txt] = row.querySelectorAll('input');
          const set = async (nv) => { const old = t.colors[k]; await bus.doMeta({ label: i18nTpl`改规范色 ${k}`, apply: () => { t.colors[k] = nv; }, revert: () => { t.colors[k] = old; } }); };
          pick.onchange = () => { txt.value = pick.value; set(pick.value); };
          txt.onchange = () => { if (/^#[0-9a-f]{3,8}$/i.test(txt.value.trim())) set(txt.value.trim()); else { toast(i18nText('颜色写成 #3d5af1 这样'), 'err'); txt.value = t.colors[k]; } };
          colors.appendChild(row);
        });
        host.appendChild(colors);
        const font = el(i18nTpl`<label class="p-sec set-field">字体<input class="ipt" value="${esc(t.fontFamily || '')}" placeholder="例如 Microsoft YaHei, sans-serif"></label>`);
        font.querySelector('input').onchange = e => { const value = e.target.value.trim(); if (/[;{}<>]/.test(value)) { toast(i18nText('请填写有效字体名称'), 'err'); return; } const old=t.fontFamily; bus.doMeta({label:i18nText('修改规范字体'),apply:()=>{t.fontFamily=value;},revert:()=>{t.fontFamily=old;}}); };
        host.appendChild(font);
        [[i18nText('字号阶梯'), 'fontSizes'], [i18nText('间距阶梯'), 'spacing'], [i18nText('圆角'), 'radius']].forEach(([label, key]) => {
          const g = el(`<div class="p-sec"><div class="p-sec-title">${label}</div><input class="ipt" value="${esc((t[key] || []).join(', '))}"></div>`);
          const i = g.querySelector('input');
          i.onchange = async () => {
            const arr = i.value.split(/[,，\s]+/).filter(Boolean);
            if (!arr.every((v) => /^\d+(\.\d+)?(px|rem|em|%)$/.test(v))) { toast(i18nText('每一项写成 16px 这样'), 'err'); return; }
            const old = (t[key] || []).slice();
            await bus.doMeta({ label: i18nTpl`改${label}`, apply: () => { t[key] = arr; }, revert: () => { t[key] = old; } });
          };
          host.appendChild(g);
        });
        const acts = el(i18nTpl`<div class="p-sec"><p class="hint" style="margin-bottom:10px">应用配色、字号和圆角规范。页面中单独写死的样式需手动调整，或交给助手统一。</p><button class="btn primary block" data-apply>${icon('check', 15)}应用到当前页</button>
          <div class="p-actions" style="margin-top:8px"><button class="btn small" data-exp>导出 tokens.json</button><button class="btn small" data-imp>导入</button></div></div>`);
        acts.querySelector('[data-apply]').onclick = () => applyToSite({tokens:t,files:[app.state.page]});
        acts.querySelector('[data-exp]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(cur(), null, 2)], { type: 'application/json' })); a.download = 'tokens.json'; a.click(); };
        acts.querySelector('[data-imp]').onclick = () => {
          const i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
          i.onchange = async () => { try { const d = JSON.parse(await i.files[0].text()); const old = JSON.parse(JSON.stringify(t)); await bus.doMeta({ label: i18nText('导入设计规范'), apply: () => replaceAll(t, d), revert: () => replaceAll(t, old) }); paint(); } catch { toast(i18nText('不是有效的 tokens.json'), 'err'); } };
          i.click();
        };
        host.appendChild(acts);
      };
      paint();
      if(app.view()==='overview')this._off=bus.on('presets',async()=>{await loadPresets();if(host.isConnected&&this._generation===generation)paint();});
    },
    onHide(){this._generation=null;this._off?.();},
  });
}
