/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-providers-'));
process.env.CENTDECK_CONFIG_DIR=path.join(tmp,'config');
const require=createRequire(import.meta.url), providers=require('../server/providers'),requests=[];
const server=http.createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;
  const body=text?JSON.parse(text):null;requests.push({body,headers:req.headers});res.setHeader('Content-Type','application/json');
  if(req.url==='/v1beta/models')return res.end(JSON.stringify({models:[{name:'models/gemini-3-flash-preview',supportedGenerationMethods:['generateContent']}]}));
  if(req.url.includes('generateContent')){
    const answered=body.contents.some(c=>c.parts.some(p=>p.functionResponse));
    return res.end(JSON.stringify({candidates:[{finishReason:'STOP',content:{role:'model',parts:answered?[{text:'Done'}]:[{functionCall:{name:'read_page',args:{path:'index.html'}},thoughtSignature:'signed-part'}]}}],usageMetadata:{totalTokenCount:15}}));
  }
  res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Done'},finish_reason:'stop'}]}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
  const origin=`http://127.0.0.1:${server.address().port}`;
  providers.saveSettings({providers:[{id:'gemini',protocol:'gemini',baseUrl:origin+'/v1beta',apiKey:'fixture-key',enabled:true,models:['gemini-3-flash-preview'],modelCapabilities:{'gemini-3-flash-preview':{vision:true,audio:true,tools:true}}},{id:'oa',protocol:'openai',baseUrl:origin+'/v1',apiKey:'fixture-key',enabled:true,models:['test-openai'],modelCapabilities:{'test-openai':{vision:false,tools:false}}}]});
  assert.equal(providers.resolve('gemini:gemini-3-flash-preview').provider.audio,true);assert.equal(providers.resolve('oa:test-openai').provider.tools,false);
  const file=path.join(process.env.CENTDECK_CONFIG_DIR,'settings.json'),before=fs.readFileSync(file,'utf8');
  assert.equal((await providers.discoverDraft({id:'gemini',name:'unsaved',baseUrl:origin+'/v1beta',protocol:'gemini',apiKey:''})).models[0],'gemini-3-flash-preview');assert.equal(fs.readFileSync(file,'utf8'),before);
  const tools=[{type:'function',function:{name:'read_page',description:'read',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}];
  const messages=[{role:'system',content:'guide'},{role:'user',content:[{type:'text',text:'inspect'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}},{type:'input_audio',input_audio:{format:'wav',data:'AA=='}}]}];
  const first=await providers.complete('gemini:gemini-3-flash-preview',messages,tools,'high',null,2048);assert.equal(first.message.tool_calls.length,1);assert.equal(first.usage.total_tokens,15);
  const call=requests.at(-1);assert.equal(call.headers['x-goog-api-key'],'fixture-key');assert(!call.headers.authorization);assert.equal(call.body.generationConfig.thinkingConfig.thinkingLevel,'high');assert.equal(call.body.contents[0].parts[2].inlineData.mimeType,'audio/wav');
  messages.push(first.message,{role:'tool',tool_call_id:first.message.tool_calls[0].id,content:'{"content":"hello"}'});
  const final=await providers.complete('gemini:gemini-3-flash-preview',messages,tools,'high');assert.equal(final.message.content,'Done');assert.equal(requests.at(-1).body.contents[1].parts[0].thoughtSignature,'signed-part');assert.equal(requests.at(-1).body.contents[2].parts[0].functionResponse.name,'read_page');
  await assert.rejects(providers.complete('gemini:gemini-3-flash-preview',messages,tools,'ultra'),/未自动降档/);
  await providers.complete('oa:test-openai',[{role:'user',content:'hi'}],tools,'ultra');assert.equal(requests.at(-1).body.reasoning_effort,'ultra');assert(!requests.at(-1).body.tools);
  console.log('Providers: unsaved discovery, model capabilities, Gemini media/tools/signatures and reasoning passed');
}finally{await new Promise(r=>server.close(r));if(path.dirname(tmp)===os.tmpdir()&&path.basename(tmp).startsWith('centdeck-providers-'))fs.rmSync(tmp,{recursive:true,force:true});}
