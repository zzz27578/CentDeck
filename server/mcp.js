/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
'use strict';
const crypto=require('node:crypto');
const store=require('./store'), extensions=require('./extensions'), registry=require('./tools'), changes=require('./changes');
const sessions=new Map();
const str={type:'string'};
const extra=[
  {name:'external_requests',description:'列出选择 mcp:external 的内置 Agent 等待请求。外部助手负责推理，内置运行时执行工具。',inputSchema:{type:'object',properties:{}}},
  {name:'external_claim',description:'接管一个请求，读取上下文和可用工具；租约三分钟，可重新接管续期。',inputSchema:{type:'object',properties:{id:str},required:['id']}},
  {name:'external_respond',description:'提交真实外部助手回复或工具调用。必须使用同会话最新租约；model 仅自行报告。',inputSchema:{type:'object',properties:{id:str,lease:str,model:str,message:{type:'object',properties:{role:{const:'assistant'},content:{type:['string','null']},tool_calls:{type:'array',items:{type:'object'}}},required:['role']}},required:['id','lease','message']}},
  {name:'list_projects',description:'列出本机项目',inputSchema:{type:'object',properties:{}}},
  {name:'create_project',description:'新建空白项目',inputSchema:{type:'object',properties:{name:str},required:['name']}},
  {name:'list_assistants',description:'列出内置 Agent 及模型配置（不含密钥）',inputSchema:{type:'object',properties:{}}},
  {name:'start_agent',description:'启动内置 Agent，必须明确 plan/create 模式；返回任务 ID',inputSchema:{type:'object',properties:{projectId:str,assistantId:str,text:str,mode:{type:'string',enum:['plan','create']},think:str,model:str},required:['projectId','assistantId','text','mode']}},
  {name:'agent_status',description:'读取任务结果、思考强度和已保存变更',inputSchema:{type:'object',properties:{projectId:str},required:['projectId']}},
  {name:'agent_action',description:'停止、暂停或继续内置任务；更改思考强度',inputSchema:{type:'object',properties:{projectId:str,taskId:str,action:{type:'string',enum:['cancel','pause','resume','think']},think:str},required:['projectId','taskId','action']}},
];
function catalog(mode){return [...extra.filter(t=>mode==='create'||!['external_requests','external_claim','external_respond','create_project','start_agent','agent_action'].includes(t.name)),...registry.list(mode).map(t=>({...t,inputSchema:{...t.inputSchema,properties:{...(registry.projectTool(t.name)?{projectId:str}:{}),...t.inputSchema.properties},required:[...new Set([...(registry.projectTool(t.name)?['projectId']:[]),...(t.inputSchema.required||[])])]}}))];}
async function dispatch(body,sessionId){
  const config=extensions.mcpConfig();
  if(!config.enabled)throw new store.ApiError(403,'MCP 已停用');
  const {id,method,params={}}=body;
  if(method==='initialize') {
    const sid=crypto.randomUUID();
    sessions.set(sid,{reads:{},at:Date.now()});
    return {sid,result:{protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(params.protocolVersion)?params.protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false},resources:{}},serverInfo:{name:'centdeck',version:'1.0.0'},instructions:'Use list_skills/read_skill (platform-guide) before editing. Tools share the built-in Agent write guards. Supply projectId on project tools. Use ui_state then ui_action for real browser operations; file writes alone are not visual tests.'}};
  }
  const s=sessions.get(sessionId);if(!s)throw new store.ApiError(404,'MCP 会话已过期，请重新 initialize');
  s.at=Date.now(); for(const [key,v]of sessions)if(Date.now()-v.at>3600000)sessions.delete(key);
  if(method==='notifications/initialized'||method==='notifications/cancelled')return {notification:true};
  if(method==='ping')return {result:{}};
  if(method==='tools/list')return {result:{tools:catalog(config.mode)}};
  if(method==='resources/list')return {result:{resources:extensions.skills().filter(x=>x.enabled).map(x=>({uri:'centdeck://skills/'+x.id,name:x.name,mimeType:'text/markdown'}))}};
  if(method==='resources/read'){const skill=extensions.skills().find(x=>x.enabled&&'centdeck://skills/'+x.id===params.uri);if(!skill)throw new store.ApiError(404,'技能资源不存在');return {result:{contents:[{uri:params.uri,mimeType:'text/markdown',text:skill.content}]}};}
  if(method!=='tools/call')return {error:{code:-32601,message:'Method not found'}};
  try {
    const a=params.arguments||{}, name=params.name;
    const definition=catalog(config.mode).find(t=>t.name===name);
    if(!definition)throw new store.ApiError(403,'工具不可用或 MCP 处于只读模式');
    for(const key of definition.inputSchema.required||[])if(a[key]===undefined||a[key]===null||a[key]==='')throw new store.ApiError(400,'缺少必填参数：'+key);
    if(registry.projectTool(name))store.projectDir(a.projectId);
    let result;
    if(name==='list_projects')result=store.listProjects();
    else if(name==='external_requests')result=require('./external-agent').list();
    else if(name==='external_claim')result=require('./external-agent').claim(a.id,sessionId);
    else if(name==='external_respond')result=require('./external-agent').respond(a,sessionId);
    else if(name==='create_project')result=store.createProject({blank:true,name:a.name});
    else if(name==='list_assistants')result=store.getAssistants();
    else if(name==='start_agent')result=require('./tasks').start(a.projectId,{...a,...extensions.preferences(),collaboration:'off'});
    else if(name==='agent_status')result=require('./tasks').list(a.projectId);
    else if(name==='agent_action')result=require('./tasks').action(a.projectId,a.taskId,a);
    else {
      s.reads[a.projectId]||={};
      const guard=()=>{const current=extensions.mcpConfig();if(!current.enabled||current.mode!=='create')throw new store.ApiError(403,'MCP 写入已停用');};
      result=await registry.execute(name,a,{project:a.projectId,mode:config.mode,readSet:s.reads[a.projectId],guard,commit:files=>changes.commit(a.projectId,files,{guard,task:'mcp:'+sessionId})});
    }
    if(name==='capture_page')return {result:{content:[{type:'text',text:JSON.stringify(result.info)},{type:'image',mimeType:'image/png',data:result.data}],isError:false}};
    return {result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}};
  } catch(e){return {result:{content:[{type:'text',text:e.message}],isError:true}};}
}
module.exports={dispatch,catalog};
