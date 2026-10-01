// Real Chromium + disposable app server + local streaming model. No user credentials or paid API.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {browser} from './browser-driver.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-chat-qa-'));
process.env.CENTDECK_CONFIG_DIR=path.join(temp,'config');process.env.CENTDECK_PROJECTS_DIR=path.join(temp,'projects');
fs.mkdirSync(process.env.CENTDECK_CONFIG_DIR);fs.mkdirSync(process.env.CENTDECK_PROJECTS_DIR);
fs.writeFileSync(path.join(process.env.CENTDECK_CONFIG_DIR,'account.json'),JSON.stringify({username:'tester',password:'test-only-password',mustChange:false}));
const require=createRequire(import.meta.url),store=require('../server/store');
const requests=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const upstream=http.createServer(async(req,res)=>{
  if(req.url.endsWith('/models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'chat-test'}]}));return;}
  let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);requests.push(b);
  const goal=b.messages.filter(m=>m.role==='user').at(-1)?.content||'';
  res.setHeader('Content-Type','text/event-stream');
  const packet=j=>res.write('data: '+JSON.stringify(j)+'\n\n');
  await sleep(180);
  if(goal==='READ'&&!b.messages.some(m=>m.role==='tool')){
    packet({choices:[{delta:{tool_calls:[{index:0,id:'read-1',type:'function',function:{name:'read_page',arguments:'{"path":"index.html"}'}}]},finish_reason:'tool_calls'}]});
  }else{
    const text=/111/.test(goal)?'111':'已回复：'+goal;
    packet({choices:[{delta:{content:text.slice(0,1)}}]});
    await sleep(goal==='slow'?1500:180);
    packet({choices:[{delta:{content:text.slice(1)},finish_reason:'stop'}]});
  }
  packet({choices:[],usage:{total_tokens:80}});res.end('data: [DONE]\n\n');
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
store.saveAssistants([{id:'cent',name:'Cent',role:'设计师',model:'fixture:chat-test',think:'medium'},{id:'echo',name:'Echo',role:'审查员',model:'fixture:chat-test',think:'medium'}]);
store.saveSettings({providers:[{id:'fixture',name:'本地测试接口',protocol:'openai',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,apiKey:'test-key-only',enabled:true,models:['chat-test'],tools:true}],defaultModel:'fixture:chat-test'});
const project=store.createProject({blank:true,name:'Chat QA'}),dir=store.projectDir(project.id);
fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta charset="utf-8"><title>QA</title><style>body{margin:0;background:#eee}main{padding:60px;min-height:800px}h1{font:50px system-ui}</style><main><h1>Conversation QA</h1></main>');
project.pages=[{file:'index.html',title:'测试首页'}];project.marks=[{id:'note-one',type:'note',no:1,page:'index.html',pts:[[220,220]],text:'拖动中可见',color:'#e5484d',done:false}];
project.assistantChats={cent:{msgs:[{role:'user',text:'保留的旧对话'}],draft:''}};store.saveProject(project.id,project);
const changes=require('../server/changes'),source=changes.read(project.id,'index.html');
const previousCommit=changes.commit(project.id,[{path:'index.html',content:source+'\n<!-- Previously saved -->',baseHash:changes.hash(source)}],{scope:'all'});
fs.writeFileSync(path.join(dir,'.centdeck','tasks.json'),JSON.stringify([{id:'historical',project:project.id,assistantId:'cent',name:'Cent',goal:'已保存的旧修改',status:'completed',commits:[previousCommit],messages:[],events:[],answers:[],dependencies:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]));
let server,ui,port;
const screenshots=path.resolve('docs/screenshots');
try{
  server=spawn(process.execPath,['server/server.js'],{env:{...process.env,PORT:'8496',CENTDECK_NO_OPEN:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stderr.on('data',x=>process.stderr.write(x));
  port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.on('data',x=>{const m=String(x).match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(+m[1]);}});});
  const origin='http://127.0.0.1:'+port;
  const login=await fetch(origin+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json','X-CentDeck':'1'},body:JSON.stringify({username:'tester',password:'test-only-password'})});assert(login.ok);
  const cookie=login.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
  ui=await browser(path.join(temp,'browser'));
  await ui.call('Network.setCookie',{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin});
  await ui.call('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('cd.agentOpen','1');localStorage.setItem('cd.style','original');localStorage.setItem('cd.theme','light');"});
  const navigate=async()=>{await ui.call('Page.navigate',{url:origin+'/?project='+project.id+'&view=edit&page=index.html'});await ui.until("!!document.querySelector('.sk-pin') && !!document.querySelector('.agent .ag-conversations')");};
  await navigate();
  const click=async selector=>{await ui.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const fill=async(selector,value)=>ui.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const send=async text=>{await fill('.agent .agent-composer textarea',text);await click('.agent [data-a=send]');};
  assert.match(await ui.evaluate("document.querySelector('.agent .ag-msgs').textContent"),/保留的旧对话/);
  // Actual pointer coordinates: assert the visible pin moves before pointerup.
  const pin=await ui.evaluate("(()=>{const r=document.querySelector('.sk-pin').getBoundingClientRect();return {x:r.x+10,y:r.y+10};})()");
  await ui.call('Input.dispatchMouseEvent',{type:'mousePressed',x:pin.x,y:pin.y,button:'left',clickCount:1});
  await ui.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:pin.x+65,y:pin.y+40,button:'left',buttons:1});
  const moving=await ui.evaluate("(()=>{const n=document.querySelector('.sk-pin'),r=n.getBoundingClientRect();return {visibility:getComputedStyle(n).visibility,x:r.x+10,y:r.y+10};})()");
  assert.equal(moving.visibility,'visible');assert(Math.abs(moving.x-pin.x-65)<3,JSON.stringify({pin,moving}));
  await ui.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:pin.x+65,y:pin.y+40,button:'left',clickCount:1});
  await sleep(250);
  await click('.agent [data-a=new-chat]');assert(!/保留的旧对话/.test(await ui.evaluate("document.querySelector('.agent .ag-msgs').textContent")));
  await ui.evaluate("window.qaFrame=document.querySelector('.stage-wrap iframe')||document.querySelector('iframe')");
  await send('收到请回复111');
  await ui.until("document.querySelector('.agent .response-phase')?.textContent==='正在输出'");
  assert(await ui.evaluate("!!document.querySelector('.agent .msg-author .responding')"));
  await ui.until("document.querySelector('.agent .msg.sys .msg-body')?.textContent==='111' && !document.querySelector('.agent .ag-response')");
  assert.equal(requests.length,1);assert(!requests[0].tools?.length);assert.equal(requests[0].messages.filter(m=>m.role==='user').length,1);
  assert(await ui.evaluate("qaFrame===(document.querySelector('.stage-wrap iframe')||document.querySelector('iframe'))"),'read-only chat keeps preview iframe');
  await click('.agent .msg.user [data-edit]');await fill('.agent .msg-edit textarea','请回复222');await ui.evaluate("document.querySelector('.agent .msg-edit').requestSubmit()");
  await ui.until("document.querySelector('.agent .msg.sys .msg-body')?.textContent.includes('222') && !document.querySelector('.agent .ag-response')");
  await click('.agent [data-a=conversations]');assert.equal(await ui.evaluate("document.querySelectorAll('.conversation-row').length"),4);
  await click('.agent [data-a=conversations]');
  await click('.agent [data-a=new]');await ui.until("!!document.querySelector('.agent-float .ag')");
  assert.equal(await ui.evaluate("document.querySelector('.agent-float .ag-name').textContent"),'Cent');assert.equal(await ui.evaluate("document.querySelectorAll('.agent-float .msg').length"),0);
  await click('.agent-float [data-a=close]');
  await click('.agent [data-a=new-chat]');await send('slow');await ui.until("document.querySelector('.agent .response-phase')?.textContent==='正在输出'");
  await click('.agent [data-a=send]');await ui.until("document.querySelector('.agent .response-phase')?.textContent==='已停止'");
  await sleep(1600);assert.equal(await ui.evaluate("document.querySelector('.agent .msg.sys .msg-body').textContent"),'已');
  await click('.agent [data-a=new-chat]');await click('.agent [data-a=at]');await ui.evaluate("[...document.querySelectorAll('.menu-item')].find(n=>n.textContent.includes('Echo')).click()");
  await send('请回复333');await ui.until("document.querySelector('.agent .msg.sys .msg-author b')?.textContent==='Echo' && document.querySelector('.agent .msg.sys .msg-body')?.textContent.includes('333')");
  assert.match(requests.at(-1).messages[0].content,/Echo/);
  await click('.agent [data-a=new-chat]');await send('READ');
  await ui.until("document.querySelector('.agent .msg.sys .msg-body')?.textContent.includes('READ') && !document.querySelector('.agent .ag-response')");
  const readTask=JSON.parse(fs.readFileSync(path.join(dir,'.centdeck','tasks.json'),'utf8')).find(t=>t.goal==='READ');
  assert.equal(readTask.messages.find(m=>m.tool_calls?.length)?.tool_calls[0].function.name,'read_page','executed calls remain in transcript');
  assert.equal(readTask.toolCalls,1);assert.equal(readTask.timings.length,2);
  await click('.agent [data-a=new-chat]');await send('slow');await ui.until("document.querySelector('.agent .response-phase')?.textContent==='正在输出'");await click('.agent [data-a=new-chat]');await sleep(1800);
  assert.equal(await ui.evaluate("document.querySelectorAll('.agent .msg').length"),0,'background reply cannot leak into new chat');
  // Compact dock layout and avatar switch menu.
  await ui.evaluate("document.querySelector('.agent').style.setProperty('--agent-w','320px')");await click('.agent [data-a=switch]');
  assert.equal(await ui.evaluate("document.querySelectorAll('.assistant-picker-row .picker-avatar').length"),2);
  await click('.agent [data-a=switch]');
  const layout=await ui.evaluate("(()=>{const b=document.querySelector('.agent .comp-bar'),send=b.querySelector('[data-a=send]').getBoundingClientRect(),model=b.querySelector('[data-a=model]').getBoundingClientRect();return {overflow:b.scrollWidth>b.clientWidth,delta:Math.abs(send.top-model.top)};})()");assert(!layout.overflow);assert(layout.delta<5,JSON.stringify(layout));
  fs.mkdirSync(screenshots,{recursive:true});fs.writeFileSync(path.join(screenshots,'chat-conversations-light.png'),Buffer.from((await ui.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await sleep(550);await navigate();assert(!ui.errors.length,ui.errors.join('\n'));
  // Settings opened through the actual toolbar button.
  const settings=await ui.evaluate("[...document.querySelectorAll('button')].filter(n=>/设置|工作台/.test((n.getAttribute('data-tip')||'')+(n.getAttribute('aria-label')||''))).map(n=>({id:n.id,text:n.textContent,tip:n.getAttribute('data-tip')}))");
  const settingsId=settings.find(x=>x.id)?.id;assert(settingsId,JSON.stringify(settings));await click('#'+settingsId);
  await ui.until("!!document.querySelector('[data-tab=history]')");await click('[data-tab=history]');assert(await ui.evaluate("document.querySelectorAll('.history-card').length>=5"));
  assert(await ui.evaluate("[...document.querySelectorAll('.history-card')].some(n=>n.querySelector('h2').textContent==='slow' && n.querySelector('p').textContent.includes('已回复：slow'))"),'archive receives background completion');
  await ui.evaluate("[...document.querySelectorAll('.history-card')].find(n=>n.querySelector('h2').textContent==='READ').querySelector('[data-rename]').click()");
  await ui.until("!!document.querySelector('.modal-mask.show input')");await fill('.modal-mask.show input','读取测试归档');await click('.modal-mask.show .modal-foot .primary');await sleep(200);
  assert(await ui.evaluate("[...document.querySelectorAll('.history-card h2')].some(n=>n.textContent==='读取测试归档')"));
  await ui.evaluate("[...document.querySelectorAll('.history-card')].find(n=>n.querySelector('h2').textContent==='读取测试归档').querySelector('[data-delete]').click()");await ui.until("!!document.querySelector('.modal-mask.show .modal-foot .danger')");await click('.modal-mask.show .modal-foot .danger');await sleep(220);
  assert(!await ui.evaluate("[...document.querySelectorAll('.history-card h2')].some(n=>n.textContent==='读取测试归档')"));
  await sleep(500);await click('.studio [data-close]');await navigate();await click('#'+settingsId);await ui.until("!!document.querySelector('[data-tab=history]')");await click('[data-tab=history]');
  assert(!await ui.evaluate("[...document.querySelectorAll('.history-card h2')].some(n=>n.textContent==='读取测试归档'||n.textContent==='READ')"),'deleted chat stays deleted after reload');
  await sleep(300);fs.writeFileSync(path.join(screenshots,'conversation-history-light.png'),Buffer.from((await ui.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('[data-tab=providers]');await click('.provider-row');
  await fill('#provider-credential','fixture-entered-key');assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('#provider-credential')).webkitTextSecurity"),'disc');
  await click('[data-reveal]');assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('#provider-credential')).webkitTextSecurity"),'none');
  await click('[data-reveal]');assert.equal(await ui.evaluate("document.querySelector('#provider-credential').type"),'text');assert.equal(await ui.evaluate("document.querySelector('.provider-editor').autocomplete"),'off');
  await fill('#provider-credential','');
  await sleep(350);fs.writeFileSync(path.join(screenshots,'provider-editor-light.png'),Buffer.from((await ui.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await ui.evaluate("document.documentElement.dataset.theme='dark'");await sleep(350);fs.writeFileSync(path.join(screenshots,'provider-editor-dark.png'),Buffer.from((await ui.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert(!ui.errors.length,ui.errors.join('\n'));
  console.log('Browser: continuous note drag, migration, independent chats, streaming, commit-aware preview stability, edit branches, multiple windows, stop/late result, @ routing, retained tool transcript, background completion, 320px layout, archive rename/delete/reload and credential reveal passed');
}finally{
  await ui?.close();if(server&&server.exitCode===null)await new Promise(r=>{server.once('exit',r);server.kill();});
  upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
  if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('centdeck-chat-qa-'))try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:150});}catch{}
}
