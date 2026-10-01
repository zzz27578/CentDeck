/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const store=require('./store'), changes=require('./changes'), extensions=require('./extensions'), ui=require('./ui-bridge');
const str={type:'string'};
const definitions=[
  ['read_page','读取项目源码/Markdown、baseHash 和页面标题；每次提交前先读取',{path:str},['path']],
  ['project_context','读取项目页面、设计规范、草图和任务',{},[]],
  ['write_files','原子提交已读取的 HTML/CSS/JS/SVG/JSON/Markdown；title 可新增或更新页面清单名称，保留版本与锁定检查',{files:{type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{path:str,content:str,baseHash:str,title:{type:'string',minLength:1,maxLength:120}},required:['path','content','baseHash'],additionalProperties:false}}},['files'],'write'],
  ['rename_page','修改页面清单中的显示名称，不修改文件路径和 HTML title。先 read_page 获取最新 baseHash 和 title',{path:str,title:{type:'string',minLength:1,maxLength:120},baseHash:str},['path','title','baseHash'],'write'],
  ['patch_text','替换已读取源码中的唯一原文，保留其他区域的修改',{path:str,before:str,after:str},['path','before','after'],'write'],
  ['list_skills','列出已启用技能；使用 read_skill 按需加载',{},[]],
  ['read_skill','读取一个已启用技能的完整 SKILL.md',{id:str},['id']],
  ['ui_state','读取在线工作台和编辑页 iframe 的控件、页面文本、视口/溢出尺寸、连接年龄；不包含密码或文件字段的值',{clientId:str,projectId:str},[]],
  ['ui_action','先 ui_state。支持工作台/网页内部控件点击、填写、滚动与便签。多标签页请指定 clientId；控件 ID 带文档版本，刷新后重新读取。页面动作请传 projectId',{action:{type:'string',enum:['open_project','open_page','open_settings','close_settings','set_view','click','fill','scroll','add_mark','undo','refresh']},clientId:str,projectId:str,page:str,section:str,view:str,target:str,value:str,text:str,x:{type:'number'},y:{type:'number'}},['action'],'write'],
  ['capture_page','用本机 Edge/Chrome 独立渲染项目 HTML 并返回 PNG。是初始页面截图，不包含在线页面的点击/表单状态；无需工作台标签页',{path:str,width:{type:'integer',minimum:320,maximum:2560},height:{type:'integer',minimum:320,maximum:2560}},['path']],
];
function list(mode='create') {
  const all=[...definitions,...extensions.plugins().filter(p=>p.enabled).flatMap(p=>(p.manifest.tools||[]).map(t=>['plugin_'+p.manifest.id.replaceAll('-','_')+'_'+t.name,t.description,{},[]]))];
  return all.filter(d=>d[4]!=='write'||mode==='create').map(([name,description,properties,required,access])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:access!=='write',destructiveHint:access==='write',openWorldHint:false}}));
}
function has(name){return list().some(x=>x.name===name);}
function check(name,a,mode){const d=list(mode).find(x=>x.name===name);if(!d)throw new store.ApiError(403,'当前模式不提供此工具');for(const k of d.inputSchema.required)if(a[k]===undefined)throw new store.ApiError(400,'缺少参数 '+k);}
async function execute(name,a,c){
  check(name,a,c.mode);
  if(name==='list_skills')return extensions.skills().filter(s=>s.enabled).map(({content,...s})=>s);
  if(name==='read_skill'){const s=extensions.skills().find(s=>s.enabled&&s.id===a.id);if(!s)throw new store.ApiError(404,'技能不存在或已停用');return s;}
  if(name==='ui_state')return ui.snapshot(a);
  if(name==='capture_page')return require('./capture').capture(c.project,a);
  if(name==='ui_action'){c.guard?.();return ui.send({...a,projectId:a.projectId||c.project});}
  if(name.startsWith('plugin_')) {const p=store.getProject(c.project);return {name:p.name,pages:p.pages.length,openMarks:(p.marks||[]).filter(x=>!x.done).length,locks:p.locks};}
  if(name==='project_context'){
    const {assistantChats,conversations,conversationDrafts,activeConversations,...project}=store.getProject(c.project);
    const tasks=require('./tasks').list(c.project).slice(-30).map(({id,parent,assistantId,name,goal,status,commits})=>({id,parent,assistantId,name,goal,status,commits}));
    return {project,tasks};
  }
  if(name==='read_page'){const content=changes.read(c.project,a.path),baseHash=changes.hash(content),title=store.getProject(c.project).pages.find(p=>p.file===a.path)?.title;c.readSet[a.path]={content,hash:baseHash,title};return {path:a.path,content,baseHash,...(title!==undefined?{title}:{})};}
  if(name==='write_files') {
    for(const f of a.files||[])if(c.readSet[f.path]?.hash!==f.baseHash)throw new store.ApiError(409,'提交前必须读取文件版本');
    return c.commit(a.files.map(f=>({...f,...(f.title!==undefined?{baseTitle:c.readSet[f.path]?.title}:{})})));
  }
  if(name==='rename_page'){
    const read=c.readSet[a.path];if(!read||read.hash!==a.baseHash||read.title===undefined)throw new store.ApiError(409,'重命名前请 read_page 读取已存在的页面');
    return c.commit([{path:a.path,content:read.content,baseHash:read.hash,title:a.title,baseTitle:read.title}]);
  }
  if(name==='patch_text') {
    const base=c.readSet[a.path]?.content;
    if(typeof base!=='string'||!a.before||base.split(a.before).length!==2)throw new store.ApiError(409,'原文必须在已读取文件中唯一匹配');
    const now=changes.read(c.project,a.path);
    if(typeof now!=='string'||now.split(a.before).length!==2)throw new store.ApiError(409,'目标已变化，请重新读取');
    return c.commit([{path:a.path,content:now.replace(a.before,()=>a.after),baseHash:changes.hash(now)}]);
  }
}
const projectTool=name=>['read_page','write_files','patch_text','rename_page','project_context','capture_page'].includes(name)||name.startsWith('plugin_');
module.exports={list,has,execute,projectTool};
