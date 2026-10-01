/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-external-runtime-'));
process.env.CENTDECK_CONFIG_DIR=path.join(tmp,'config');process.env.CENTDECK_PROJECTS_DIR=path.join(tmp,'projects');
const require=createRequire(import.meta.url),store=require('../server/store'),ext=require('../server/extensions'),tasks=require('../server/tasks'),external=require('../server/external-agent');
const until=async f=>{for(let i=0;i<150;i++){const result=f();if(result)return result;await new Promise(r=>setTimeout(r,20));}throw Error('external runtime timeout');};
try{
  ext.mcpConfig({enabled:true,mode:'create'});store.saveAssistants([{id:'external-test',name:'External',model:'mcp:external',think:'high',skills:[]}]);
  const p=store.createProject({name:'External runtime',blank:true});
  const t=tasks.start(p.id,{assistantId:'external-test',model:'mcp:external',mode:'create',text:'Create a test page',think:'high'});
  const request=await until(()=>external.list()[0]),claimed=external.claim(request.id,'fixture-client');
  assert(claimed.tools.some(t=>t.function.name==='publish_variant'));
  external.respond({id:request.id,lease:claimed.lease,model:'fixture-external',message:{role:'assistant',tool_calls:[{id:'publish',type:'function',function:{name:'publish_variant',arguments:JSON.stringify({name:'External style',colors:{brand:'#336699'},fontFamily:'system-ui',pages:[{file:'index.html',title:'External page',html:'<!doctype html><html><h1>External runtime works</h1></html>'}]})}}]}},'fixture-client');
  const next=await until(()=>external.list()[0]),second=external.claim(next.id,'fixture-client');
  assert(second.messages.some(m=>m.role==='tool'));
  external.respond({id:next.id,lease:second.lease,message:{role:'assistant',content:'The test page is saved.'}},'fixture-client');
  const result=await until(()=>tasks.list(p.id).find(x=>x.id===t.id&&x.status==='completed'));
  assert.equal(result.commits.length,1);assert.equal(result.toolCalls,1);assert.equal(result.think,'high');
  const project=store.getProject(p.id);assert.equal(project.designGroups.length,1);
  const file=path.join(process.env.CENTDECK_PROJECTS_DIR,p.id,project.pages[0].file);assert.match(fs.readFileSync(file,'utf8'),/External runtime works/);
  console.log('External runtime: claim → model tool call → real file commit → returned tool result → final reply passed');
}finally{for(const r of external.list())try{external.respond({...external.claim(r.id,'fixture-client'),message:{role:'assistant',content:'stopped'}},'fixture-client');}catch{}if(path.dirname(tmp)===os.tmpdir()&&path.basename(tmp).startsWith('centdeck-external-runtime-'))fs.rmSync(tmp,{recursive:true,force:true});}
