/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {browser} from './browser-driver.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-i18n-'));process.env.CENTDECK_CONFIG_DIR=path.join(temp,'config');process.env.CENTDECK_PROJECTS_DIR=path.join(temp,'projects');fs.mkdirSync(process.env.CENTDECK_CONFIG_DIR);fs.mkdirSync(process.env.CENTDECK_PROJECTS_DIR);
fs.writeFileSync(path.join(process.env.CENTDECK_CONFIG_DIR,'account.json'),JSON.stringify({username:'tester',password:'test-only-password',mustChange:false}));
const require=createRequire(import.meta.url),store=require('../server/store');store.saveAssistants([{id:'a',name:'保留的助手',role:'保留的职责',model:'auto'}]);store.saveSettings({providers:[{id:'fixture',name:'Fixture connection',baseUrl:'http://127.0.0.1:9/v1',noKey:true,enabled:false,models:['fixture-model']}]});
const p=store.createProject({blank:true,name:'保留的项目名称'}),dir=store.projectDir(p.id),source='<!doctype html><html><head><meta charset="utf-8"><title>保留的页面</title></head><body><h1>不要翻译网页</h1><p>设置</p></body></html>';
fs.writeFileSync(path.join(dir,'index.html'),source);p.pages=[{file:'index.html',title:'保留的页面'}];p.conversations=[{id:'chat-one',assistantId:'a',title:'保留的聊天',msgs:[{id:'m1',role:'user',text:'不要翻译聊天记录'}],updatedAt:new Date().toISOString(),createdAt:new Date().toISOString()}];store.saveProject(p.id,p);
let server,ui;
try{
  server=spawn(process.execPath,['server/server.js'],{env:{...process.env,PORT:'8496',CENTDECK_NO_OPEN:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stderr.on('data',d=>process.stderr.write(d));
  const port=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',d=>{const m=String(d).match(/localhost:(\d+)/);if(m){clearTimeout(timeout);resolve(+m[1]);}});});const origin='http://127.0.0.1:'+port;
  ui=await browser(path.join(temp,'browser'));await ui.call('Page.navigate',{url:origin});await ui.until("!!document.querySelector('[data-login]')");
  await ui.evaluate("localStorage.setItem('cd.language','en')");await ui.call('Page.reload');await ui.until("document.documentElement.lang==='en' && document.querySelector('.landing-copy h1')?.textContent.includes('Bring ideas')");
  const signin=await fetch(origin+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json','X-CentDeck':'1'},body:JSON.stringify({username:'tester',password:'test-only-password'})});const cookie=signin.headers.get('set-cookie').split(';')[0],n=cookie.indexOf('=');await ui.call('Network.setCookie',{url:origin,name:cookie.slice(0,n),value:cookie.slice(n+1)});
  await ui.call('Page.navigate',{url:origin});await ui.until("!!document.querySelector('.home-bar') && document.querySelector('[data-templates]')?.children.length>=4");
  const collect=`(()=>{const values=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const p=n.parentElement;if(!p||p.closest('script,style,pre,code,textarea,input,select,[inert],.msg-body,.ag-name,.ag-role,.tb-proj,.tb-page,.pc-name,.history-card,.picker-project summary,.ov-title'))continue;if(!p.getClientRects().length||getComputedStyle(p).visibility==='hidden')continue;const s=n.textContent.trim();if(/[\u3400-\u9fff]/.test(s)&&!s.includes('保留')&&!s.includes('不要翻译'))values.push(s);}return [...new Set(values)];})()`;
  let remaining=await ui.evaluate(collect);assert.deepEqual(remaining,[],JSON.stringify(remaining));
  const click=selector=>ui.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await click('[data-a=preferences]');await ui.until("!!document.querySelector('[data-language]')");assert.equal(await ui.evaluate("document.querySelector('[data-language]').value"),'en');
  const sections=['assistants','providers','history','plugins','skills','tools','mcp','general'];
  for(const section of sections){await click('[data-tab='+section+']');await new Promise(r=>setTimeout(r,250));remaining=await ui.evaluate(collect);assert.deepEqual(remaining,[],section+': '+JSON.stringify(remaining));}
  await ui.call('Page.navigate',{url:origin+'/?project='+p.id+'&view=edit&page=index.html&settings=general'});await ui.until("!!document.querySelector('[data-language]') && document.body.classList.contains('wb')");
  await ui.evaluate("const s=document.querySelector('[data-language]');s.value='zh-CN';s.dispatchEvent(new Event('change',{bubbles:true}))");await ui.until("document.documentElement.lang==='zh-CN' && document.querySelector('[data-language]')?.value==='zh-CN'");assert.equal(await ui.evaluate("document.querySelector('#tb-proj').textContent"),'保留的项目名称');
  await ui.evaluate("const s=document.querySelector('[data-language]');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}))");await ui.until("document.documentElement.lang==='en' && document.querySelector('[data-language]')?.value==='en'");await click('.studio [data-close]');await ui.until("!document.querySelector('.studio') && !!document.querySelector('.pf.on')");
  assert.equal(await ui.evaluate("document.querySelector('.pf.on').contentDocument.querySelector('h1').textContent"),'不要翻译网页');assert.equal(fs.readFileSync(path.join(dir,'index.html'),'utf8'),source);
  await click('#tb-agent');await ui.until("!!document.querySelector('.agent.open')");await ui.evaluate("document.querySelector('.agent').style.setProperty('--agent-w','320px')");
  const fit=await ui.evaluate("(()=>{const n=document.querySelector('.agent .agent-composer'),s=n.querySelector('[data-a=send]').getBoundingClientRect(),m=n.querySelector('[data-a=model]').getBoundingClientRect();return {overflow:n.scrollWidth>n.clientWidth+1,sameRow:Math.abs(s.top-m.top)<6}})()");assert(!fit.overflow,JSON.stringify(fit));assert(fit.sameRow);
  assert.match(await ui.evaluate("document.querySelector('.agent .ag-msgs').textContent"),/不要翻译聊天记录/);
  remaining=await ui.evaluate(collect);assert.deepEqual(remaining,[],JSON.stringify(remaining));
  await ui.evaluate("const t=document.querySelector('.agent textarea');t.value='Hello';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.agent [data-a=send]').click()");await ui.until("!!document.querySelector('.response-error')");assert.match(await ui.evaluate("document.querySelector('.response-error').textContent"),/Configure and select a model/);
  await click('[data-view=overview]');await ui.until("!!document.querySelector('.ov-toolbar')");remaining=await ui.evaluate(collect);assert.deepEqual(remaining,[],JSON.stringify(remaining));
  for(const title of ['Design system','Assets','Element rules','Version history']){
    await ui.evaluate(`(()=>{const b=[...document.querySelectorAll('#rail button')].find(b=>b.getAttribute('data-tip')===${JSON.stringify(title)});if(!b)throw Error('Panel not found: '+${JSON.stringify(title)});b.click();})()`);
    await new Promise(r=>setTimeout(r,180));remaining=await ui.evaluate(collect);assert.deepEqual(remaining,[],title+': '+JSON.stringify(remaining));
  }
  await click('#drawer-close');await click('[data-view=edit]');await ui.until("!!document.querySelector('.pf.on')");
  const point=await ui.evaluate("(()=>{const f=document.querySelector('.pf.on'),r=f.getBoundingClientRect(),h=f.contentDocument.querySelector('h1').getBoundingClientRect(),z=r.width/f.clientWidth;return {x:r.left+(h.x+20)*z,y:r.top+(h.y+h.height/2)*z}})()");
  await ui.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await ui.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await ui.until("!!document.querySelector('.inspector.open')");
  remaining=await ui.evaluate(collect);assert.deepEqual(remaining,[],JSON.stringify(remaining));
  assert(!ui.errors.length,ui.errors.join('\n'));
  console.log('English UI: login, home, every settings section, route-preserving switch, overview/editor, narrow chat, English API errors and untouched source/user content passed');
}finally{await ui?.close();if(server&&server.exitCode===null)await new Promise(r=>{server.once('exit',r);server.kill();});if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('centdeck-i18n-'))try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:150});}catch{}}
