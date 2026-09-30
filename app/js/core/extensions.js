import { esc, el, toast, openModal } from './ui.js';
let appearance={plugins:[],styleEnabled:true};
const applied=new Set();
export async function refreshAppearance(){
  const r=await fetch('/api/appearance');const payload=await r.json();if(!payload.ok)throw Error(payload.error);appearance=payload.data;
  applyStyle(localStorage.getItem('cd.style')||'original');
  document.querySelectorAll('button[data-style]').forEach(b=>b.hidden=!appearance.styleEnabled);
  dispatchEvent(new CustomEvent('centdeck-appearance'));
  return appearance;
}
export function styles(){return [{id:'original',name:'原版绿色'},...(appearance.styleEnabled?appearance.plugins.flatMap(p=>(p.manifest.themes||[]).map(t=>({...t,plugin:p}))):[])];}
export function styleEnabled(){return appearance.styleEnabled;}
export function applyStyle(id){
  const selected=styles().find(t=>t.id===id)||styles()[0];
  const root=document.documentElement;
  for(const key of applied)root.style.removeProperty(key);applied.clear();
  for(const [key,value]of Object.entries(selected.tokens||{})){root.style.setProperty(key,value);applied.add(key);}
  root.dataset.style=selected.id;document.querySelectorAll('button[data-style]').forEach(b=>{b.setAttribute('aria-label','切换风格，当前：'+selected.name);b.setAttribute('aria-pressed',String(selected.id!=='original'));});localStorage.setItem('cd.style',selected.id);
  return selected;
}
export function chooseStyle(){
  if(!styleEnabled())return;
  const body=el('<div class="extension-style-list"></div>');
  const close=openModal({title:'选择主页风格',body,width:520});
  for(const t of styles()){
    const button=el(`<button class="extension-style-option ${document.documentElement.dataset.style===t.id?'on':''}"><span class="style-swatch" style="background:${esc(t.tokens?.['--accent']||(t.id==='noir'?'#2458ff':'#65784e'))}"></span><span><b>${esc(t.name)}</b><small>${esc(t.plugin?.manifest.id||'内置默认')}</small></span><span>↗</span></button>`);
    button.onclick=()=>{applyStyle(t.id);close();dispatchEvent(new CustomEvent('centdeck-appearance'));};body.append(button);
  }
}
export function sandboxDocument(plugin,file){
  let html=plugin.files[file]||'';
  const resolve=rel=>{const parts=file.split('/').slice(0,-1);for(const x of rel.replace(/^\.\//,'').split('/')){if(x==='..')parts.pop();else if(x!=='.')parts.push(x);}return parts.join('/');};
  html=html.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,(tag,url)=>plugin.files[resolve(url)]!=null?`<style>${plugin.files[resolve(url)].replace(/<\/style/gi,'')}</style>`:tag);
  html=html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,(tag,url)=>plugin.files[resolve(url)]!=null?`<script>${plugin.files[resolve(url)].replace(/<\/script/gi,'<\\/script')}</script>`:tag);
  return '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'+html;
}
export function mountPluginFrame(host,plugin,file,app){
  const frame=document.createElement('iframe');frame.className='plugin-frame';frame.title=plugin.manifest.name||plugin.manifest.id;frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=sandboxDocument(plugin,file);host.append(frame);
  const onMessage=async e=>{
    if(e.source!==frame.contentWindow||e.data?.type!=='centdeck-plugin'||!frame.isConnected)return;
    let result;
    if(e.data.action==='project_summary'&&plugin.manifest.permissions?.includes('tools')){const p=app.project();result=p?{name:p.name,pages:p.pages.length,openMarks:(p.marks||[]).filter(m=>!m.done).length,locks:p.locks}:{message:'请先打开项目'};}
    else if(e.data.action==='get_settings')result=plugin.settings||{};
    else if(e.data.action==='open_settings') {await app.openSettings('plugins');result={opened:true};}
    else result={error:'该消息不在插件权限范围内'};
    if(e.data.action==='project_summary'&&plugin.settings?.showLocks===false&&result)delete result.locks;
    frame.contentWindow?.postMessage({type:'centdeck-result',requestId:e.data.requestId,result},'*');
  };
  addEventListener('message',onMessage);
  const observer=new MutationObserver(()=>{if(!frame.isConnected){removeEventListener('message',onMessage);observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
  return frame;
}
export function mountCustomHome(root,app){
  const hero=root.querySelector('.home-hero'),entries=root.querySelector('.entry-row');if(hero&&entries)hero.append(entries);
  root.querySelector('.custom-home-actions')?.remove();
  root.querySelector('.custom-home')?.remove();
  const chosen=styles().find(s=>s.id===document.documentElement.dataset.style);
  if(hero)hero.hidden=!!chosen?.home;
  if(chosen?.home){const host=el('<section class="custom-home"></section>');root.querySelector('.home-bar').after(host);mountPluginFrame(host,chosen.plugin,chosen.home,app);if(entries){const actions=el('<section class="custom-home-actions"></section>');actions.append(entries);host.after(actions);}}
}
