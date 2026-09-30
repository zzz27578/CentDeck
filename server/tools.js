'use strict';
const store=require('./store'), changes=require('./changes'), extensions=require('./extensions'), ui=require('./ui-bridge');
const str={type:'string'};
const definitions=[
  ['read_page','读取真实源码和 baseHash，提交之前必须读取',{path:str},['path']],
  ['project_context','读取项目页面、设计规范、草图和任务',{},[]],
  ['write_files','原子提交已读取的文件；校验版本、任务范围及锁定',{files:{type:'array',items:{type:'object',properties:{path:str,content:str,baseHash:str,title:str},required:['path','content','baseHash'],additionalProperties:false}}},['files'],'write'],
  ['patch_text','替换已读取源码中的唯一原文，保留其他区域的修改',{path:str,before:str,after:str},['path','before','after'],'write'],
  ['list_skills','列出已启用技能；使用 read_skill 按需加载',{},[]],
  ['read_skill','读取一个已启用技能的完整 SKILL.md',{id:str},['id']],
  ['ui_state','读取已连接浏览器的视图、页面和可操作控件',{},[]],
  ['ui_action','操作工作台并等待真实页面回执。先 ui_state 查看控件。支持打开项目/页面/设置、切换视图、按 DOM 控件编号点击/输入、草图、撤销',{action:{type:'string',enum:['open_project','open_page','open_settings','close_settings','set_view','click','fill','add_mark','undo','refresh']},clientId:str,projectId:str,page:str,section:str,view:str,target:str,value:str,text:str,x:{type:'number'},y:{type:'number'}},['action'],'write'],
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
  if(name==='ui_state')return ui.snapshot();
  if(name==='ui_action'){c.guard?.();return ui.send({...a,projectId:a.projectId||c.project});}
  if(name.startsWith('plugin_')) {const p=store.getProject(c.project);return {name:p.name,pages:p.pages.length,openMarks:(p.marks||[]).filter(x=>!x.done).length,locks:p.locks};}
  if(name==='project_context')return {project:store.getProject(c.project),tasks:require('./tasks').list(c.project)};
  if(name==='read_page'){const content=changes.read(c.project,a.path),baseHash=changes.hash(content);c.readSet[a.path]={content,hash:baseHash};return {path:a.path,content,baseHash};}
  if(name==='write_files') {
    for(const f of a.files||[])if(c.readSet[f.path]?.hash!==f.baseHash)throw new store.ApiError(409,'提交前必须读取文件版本');
    return c.commit(a.files);
  }
  if(name==='patch_text') {
    const base=c.readSet[a.path]?.content;
    if(typeof base!=='string'||!a.before||base.split(a.before).length!==2)throw new store.ApiError(409,'原文必须在已读取文件中唯一匹配');
    const now=changes.read(c.project,a.path);
    if(typeof now!=='string'||now.split(a.before).length!==2)throw new store.ApiError(409,'目标已变化，请重新读取');
    return c.commit([{path:a.path,content:now.replace(a.before,()=>a.after),baseHash:changes.hash(now)}]);
  }
}
module.exports={list,has,execute};
