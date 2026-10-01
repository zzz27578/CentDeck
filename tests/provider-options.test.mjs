import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-provider-options-'));process.env.CENTDECK_CONFIG_DIR=path.join(temp,'config');
const require=createRequire(import.meta.url),providers=require('../server/providers'),compact=require('../server/conversation-context').compact,requests=[];let release;
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const x of req)raw+=x;const body=raw?JSON.parse(raw):null;requests.push({url:req.url,body,headers:req.headers});res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'model',context_window:128000}]}));
  if(body?.model==='fail'){res.statusCode=429;res.end('{}');return;}
  if(body?.model==='slow')await new Promise(r=>release=r);
  if(req.url.includes('generateContent'))return res.end(JSON.stringify({candidates:[{content:{parts:[{text:'OK'}]},finishReason:'STOP'}]}));
  res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Keep the agreed layout and colors.'},finish_reason:body?.model==='truncated'?'length':'stop'}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}}));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
  const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const draft={id:'fixture',name:'Fixture',protocol:'openai',enabled:true,baseUrl,apiKey:'fixture-secret',models:['model','truncated'],timeoutSeconds:120,customHeaders:{'User-Agent':'CentDeck-Test'},modelCapabilities:{model:{text:true,vision:true,audio:true,tools:true,contextWindow:128000,bodyParams:{temperature:.3,max_tokens:30,reasoning_effort:'low'}},disabled:{text:true,contextWindow:4096}}};
  providers.saveSettings({providers:[draft]});assert(!JSON.stringify(providers.getSettings()).includes('fixture-secret'));assert.equal(providers.getSettings().providers[0].modelCapabilities.disabled.contextWindow,4096);
  assert.equal((await providers.discover('fixture')).metadata.model.contextWindow,128000);
  await providers.complete('fixture:model',[{role:'user',content:'Hello'}],[],'high',null,100);
  assert.equal(requests.at(-1).body.temperature,.3);assert.equal(requests.at(-1).body.max_tokens,30);assert.equal(requests.at(-1).body.reasoning_effort,'low');assert.equal(requests.at(-1).headers['user-agent'],'CentDeck-Test');
  let count=requests.length;const response=await providers.testModel({provider:{...draft,apiKey:''},model:'model'});assert.equal(requests.length-count,1);assert.equal(response.requests,1);assert.equal(requests.at(-1).headers.authorization,'Bearer fixture-secret');assert(!requests.at(-1).body.tools);assert.equal(requests.at(-1).body.messages.length,1);
  count=requests.length;await assert.rejects(providers.testModel({provider:draft,model:'fail'}),/429/);assert.equal(requests.length-count,1,'failure never retries or enumerates models');
  count=requests.length;const pending=providers.testModel({provider:draft,model:'slow'});while(!release)await new Promise(r=>setTimeout(r,5));await assert.rejects(providers.testModel({provider:draft,model:'slow'}),/正在测试/);release();await pending;assert.equal(requests.length-count,1);
  count=requests.length;await providers.testModel({provider:{...draft,protocol:'gemini'},model:'gemini-fixture'});assert.equal(requests.length-count,1);assert(!requests.at(-1).body.tools);
  const history=[{role:'user',content:'Keep the requested layout. '.repeat(200)},{role:'assistant',content:'Changes saved and verified. '.repeat(100)}];
  count=requests.length;const summary=await compact({model:'fixture:model',history});assert(summary.reduced);assert(summary.afterTokens<summary.beforeTokens);assert.equal(requests.length-count,1);assert(!requests.at(-1).body.tools);
  count=requests.length;assert.equal((await compact({model:'fixture:model',history:[{role:'user',content:'Hi'}]})).reduced,false);assert.equal(requests.length,count);
  await assert.rejects(compact({model:'fixture:truncated',history}),/未完整生成/);
  assert.throws(()=>providers.saveSettings({providers:[{id:'fixture',modelCapabilities:{model:{bodyParams:{tools:[]}}}}]}),/不能覆盖/);
  assert.throws(()=>providers.saveSettings({providers:[{id:'fixture',timeoutSeconds:1}]}),/5–600/);
  assert.throws(()=>providers.saveSettings({providers:[{id:'fixture',customHeaders:{'X-Test':'bad\r\nheader'}}]}),/请求头/);
  console.log('Provider options: metadata/capacity, disabled models, custom parameters/headers, saved-key reuse, one-shot success/failure/Gemini tests, concurrent-test rejection, real summary generation and truncation preservation passed');
}finally{release?.();server.closeAllConnections();await new Promise(r=>server.close(r));if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('centdeck-provider-options-'))fs.rmSync(temp,{recursive:true,force:true});}
