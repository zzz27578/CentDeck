'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, CONFIG_DIR, ApiError } = require('./store');
const stateFile = path.join(CONFIG_DIR, 'extensions.json');
const builtin = path.join(ROOT, 'plugins');
function read(file, fallback) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
function state() { return read(stateFile, { plugins: {}, skills: {}, preferences: { maxSteps: 24, budget: 100000, collaboration: 'off' }, mcp: { enabled: true, mode: 'create' } }); }
function save(s) { fs.mkdirSync(CONFIG_DIR,{recursive:true}); fs.writeFileSync(stateFile+'.tmp', JSON.stringify(s,null,2)); fs.renameSync(stateFile+'.tmp',stateFile); }
function id(value) { if(typeof value!=='string'||! /^[a-z][a-z0-9-]{1,79}$/.test(value)) throw new ApiError(400,'编号仅支持小写英文、数字、短横线'); return value; }
function validate(bundle) {
  const m = bundle?.manifest;
  if(!m || m.apiVersion!==1) throw new ApiError(400,'需要 apiVersion: 1 的插件 manifest');
  id(m.id);
  for(const key of ['permissions','themes','panels','skills','tools'])if(m[key]!==undefined&&(!Array.isArray(m[key])||m[key].length>50))throw new ApiError(400,'插件扩展项必须是数组，最多 50 项');
  if(typeof m.name!=='string'||m.name.length>100||typeof (m.description||'')!=='string')throw new ApiError(400,'插件名称或说明格式不正确');
  m.permissions||=[];
  if(!m.name || !/^\d+\.\d+\.\d+$/.test(m.version)) throw new ApiError(400,'插件需要名称与 x.y.z 版本');
  if((m.permissions||[]).some(x=>!['themes','panels','skills','tools'].includes(x))) throw new ApiError(400,'包含尚未开放的插件权限');
  const files = bundle.files || {};
  if(JSON.stringify(bundle).length>8*1024*1024) throw new ApiError(413,'插件不得超过 8 MB');
  for(const [name, content] of Object.entries(files)) {
    if(!/^[\w./-]+\.(html|css|js|json|md|svg)$/i.test(name)||name.split('/').some(x=>!x||x==='.'||x==='..')||typeof content!=='string') throw new ApiError(400,'插件文件名或类型无效');
  }
  for(const t of m.themes||[]) {
    id(t.id);
    if(t.home && !files[t.home]) throw new ApiError(400,'缺少主页 HTML');
    for(const [key,value] of Object.entries(t.tokens||{})) {
      if(!/^--[a-z0-9-]+$/.test(key)||typeof value!=='string'|| !/^[#\w\s.,%()-]{1,100}$/.test(value)||/url|expression|var\(/i.test(value)) throw new ApiError(400,'主题仅接受颜色、尺寸、字体等设计变量');
    }
  }
  for(const p of m.panels||[]) if(!files[p.file]||!p.name) throw new ApiError(400,'面板缺少文件或名称');
  for(const s of m.skills||[]) { id(s.id); if(!files[s.file]?.startsWith('---')) throw new ApiError(400,'技能需要带 frontmatter 的 SKILL.md'); }
  for(const t of m.tools||[]) if(!/^[a-z][a-z0-9_]{1,60}$/.test(t.name)||t.handler!=='project_summary') throw new ApiError(400,'插件工具目前支持受管 project_summary 处理器');
  const needed = [['themes','themes'],['panels','panels'],['skills','skills'],['tools','tools']];
  for(const [key,perm] of needed) if(m[key]?.length&&!m.permissions?.includes(perm)) throw new ApiError(400,'未声明权限：'+perm);
  const fields=m.settingsSchema||{};
  if(typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length>20)throw new ApiError(400,'插件设置字段格式无效');
  for(const [key,f]of Object.entries(fields))if(!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key)||!f||!['string','boolean','number'].includes(f.type)||typeof f.label!=='string')throw new ApiError(400,'插件设置只支持文本、布尔和数字');
  return {manifest:m,files};
}
function official() { return fs.existsSync(builtin) ? fs.readdirSync(builtin).filter(x=>x.endsWith('.json')).map(x=>validate(read(path.join(builtin,x)))) : []; }
function plugins() {
  const s=state();
  return [...official().map(b=>({...b,official:true})),...Object.values(s.plugins).filter(x=>x.bundle).map(x=>({...x.bundle,official:false}))].map(b=>({...b,enabled:s.plugins[b.manifest.id]?.enabled ?? b.official,settings:{...Object.fromEntries(Object.entries(b.manifest.settingsSchema||{}).map(([k,v])=>[k,v.default])),...s.plugins[b.manifest.id]?.settings}}));
}
function install(bundle) {
  const b=validate(bundle), s=state();
  if(official().some(x=>x.manifest.id===b.manifest.id)) throw new ApiError(409,'不能覆盖官方插件');
  if(Object.keys(s.plugins).length>=100&&!s.plugins[b.manifest.id]) throw new ApiError(400,'插件数量已达上限');
  s.plugins[b.manifest.id]={bundle:b,enabled:false}; save(s); return plugins();
}
function updatePlugin(pid, action, settings) {
  if(!['enable','disable','remove','configure'].includes(action))throw new ApiError(400,'插件操作无效');
  const p=plugins().find(x=>x.manifest.id===pid); if(!p) throw new ApiError(404,'插件不存在');
  const s=state();
  if(action==='configure') {
    const values={};for(const [key,field]of Object.entries(p.manifest.settingsSchema||{})) {const value=settings?.[key]??field.default;if(typeof value!==field.type||(field.type==='string'&&value.length>1000)||(field.type==='number'&&!Number.isFinite(value)))throw new ApiError(400,'设置字段无效：'+key);values[key]=value;}
    s.plugins[pid]={...s.plugins[pid],settings:values};
  }
  else if(action==='remove') { if(p.official) throw new ApiError(403,'官方插件可关闭但不可删除'); delete s.plugins[pid]; }
  else { s.plugins[pid]={...s.plugins[pid],enabled:action==='enable'}; }
  save(s); return plugins();
}
function skills() {
  const s=state();
  const core=read(path.join(ROOT,'app/skills/index.json'),[]).map(x=>({...x,source:'builtin',content:fs.readFileSync(path.join(ROOT,'app/skills',x.file),'utf8')}));
  const custom=Object.values(s.skills).filter(x=>x.content).map(x=>({...x,source:'local'}));
  const packaged=plugins().filter(p=>p.enabled).flatMap(p=>(p.manifest.skills||[]).map(x=>({...x,id:p.manifest.id+'--'+x.id,content:p.files[x.file],source:p.manifest.name})));
  return [...core,...custom,...packaged].map(x=>({...x,enabled:s.skills[x.id]?.enabled!==false,desc:x.desc||x.description||'',icon:x.icon||'book'}));
}
function updateSkill(b) {
  const s=state(); id(b.id);
  if(b.action==='remove') { if(!s.skills[b.id]?.content) throw new ApiError(403,'内置技能只能停用'); delete s.skills[b.id]; }
  else if(b.content!=null) {
    if(skills().some(x=>x.id===b.id&&x.source!=='local')) throw new ApiError(409,'不能覆盖内置技能');
    if(typeof b.content!=='string'||b.content.length>60000||!/^---\r?\n[\s\S]*?\r?\n---/.test(b.content)) throw new ApiError(400,'需要标准 SKILL.md（含 YAML frontmatter），最多 60000 字');
    s.skills[b.id]={id:b.id,name:String(b.name||b.id).slice(0,100),desc:String(b.desc||'').slice(0,300),content:b.content,enabled:b.enabled!==false};
  } else { if(!skills().some(x=>x.id===b.id)) throw new ApiError(404,'技能不存在'); s.skills[b.id]={...s.skills[b.id],enabled:!!b.enabled}; }
  save(s); return skills();
}
function preferences(b) {
  const s=state();
  if(b) { s.preferences={maxSteps:Math.min(40,Math.max(1,Number(b.maxSteps)||24)),budget:Math.min(500000,Math.max(1000,Number(b.budget)||100000)),collaboration:['off','confirm','auto'].includes(b.collaboration)?b.collaboration:'off'}; save(s); }
  return s.preferences;
}
function mcpConfig(b) {
  const s=state(); s.mcp||={enabled:true,mode:'create'};
  const dirty=!s.mcp.token||!!b;
  if(!s.mcp.token||b?.rotate) s.mcp.token=crypto.randomBytes(32).toString('hex');
  if(b) { if('enabled' in b)s.mcp.enabled=!!b.enabled; if('mode' in b)s.mcp.mode=b.mode==='create'?'create':'plan'; }
  if(dirty)save(s); return s.mcp;
}
module.exports={state,plugins,official,install,updatePlugin,skills,updateSkill,preferences,mcpConfig,validate};
