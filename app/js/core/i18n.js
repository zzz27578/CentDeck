/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
// Localize application-owned literals before inserting user data. This module
// never walks the DOM, translates project documents, or changes message text.
import english from './locales/en.js';
export function language(){try{return globalThis.localStorage?.getItem('cd.language')==='en'?'en':'zh-CN';}catch{return 'zh-CN';}}
export const locale=()=>language()==='en'?'en-US':'zh-CN';
const marker=/\uE000(\d+)\uE001/g;
function phrase(value){
  const leading=value.match(/^\s*/)[0],trailing=value.match(/\s*$/)[0],source=value.trim(),bindings=[];
  const key=source.replace(marker,token=>{bindings.push(token);return '{'+(bindings.length-1)+'}';});
  const translated=english[key];if(translated===undefined)return value;
  return leading+translated.replace(/\{(\d+)\}/g,(token,index)=>bindings[Number(index)]??token)+trailing;
}
export function text(value){
  value=String(value??'');if(language()!=='en')return value;
  if(Object.hasOwn(english,value.trim()))return phrase(value);
  if(!/<\/?[A-Za-z][^>]*>/.test(value))return phrase(value);
  return value.split(/(<[^>]*>)/g).map(part=>part.startsWith('<')
    ?part.replace(/\b(title|placeholder|aria-label|data-tip|alt)=(["'])([^"']*)\2/g,(_,name,quote,label)=>name+'='+quote+phrase(label).replaceAll(quote,quote==='"'?'&quot;':'&#39;')+quote)
    :phrase(part)).join('');
}
export function template(parts,...values){
  if(language()!=='en')return parts.reduce((s,p,i)=>s+p+(i<values.length?String(values[i]):''),'');
  const source=parts.reduce((s,p,i)=>s+p+(i<values.length?'\uE000'+i+'\uE001':''),'');
  return text(source).replace(marker,(_,i)=>String(values[Number(i)]));
}
const patterns=Object.entries(english).filter(([key])=>/\{\d+\}/.test(key)).map(([key,value])=>{
  const ids=[];const pattern=key.split(/(\{\d+\})/g).map(part=>/^\{\d+\}$/.test(part)?(ids.push(Number(part.slice(1,-1))),'([\\s\\S]*?)'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
  return {regex:new RegExp('^'+pattern+'$'),value,ids};
});
const prefixes=Object.entries(english).filter(([key])=>key.length>=8&&!key.includes('{')).sort((a,b)=>b[0].length-a[0].length);
export function errorText(value){
  const source=String(value??'');if(language()!=='en')return source;
  const suffix='（内置 Agent 任务专用）';if(source.endsWith(suffix))return errorText(source.slice(0,-suffix.length))+english[suffix];
  const direct=text(source);if(direct!==source)return direct;
  for(const p of patterns){const match=source.match(p.regex);if(match){const args={};p.ids.forEach((id,i)=>args[id]=match[i+1]);return p.value.replace(/\{(\d+)\}/g,(_,id)=>args[id]??'');}}
  for(const [key,value]of prefixes)if(source.startsWith(key))return value+source.slice(key.length);
  return source;
}
export async function changeLanguage(value,app){
  const next=value==='en'?'en':'zh-CN';if(next===language())return;
  if(app.project()&&await app.bus.flushMeta()===false)return false;
  localStorage.setItem('cd.language',next);
  const url=new URL(location.href);url.search='';
  if(app.project()){url.searchParams.set('project',app.project().id);if(app.view()==='edit'){url.searchParams.set('view','edit');url.searchParams.set('page',app.state.page);}}
  url.searchParams.set('settings','general');location.assign(url.href);return true;
}
