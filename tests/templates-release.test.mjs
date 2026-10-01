/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {parse} from '../app/js/vendor/parse5.js';import {browser} from './browser-driver.mjs';
const ids=['qichuan','gewu','northline'],root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-release-'));
const config=path.join(temp,'config'),projects=path.join(temp,'projects');fs.mkdirSync(config);fs.mkdirSync(projects);
const account={username:'tester',password:'template-test-only',mustChange:false};fs.writeFileSync(path.join(config,'account.json'),JSON.stringify(account));
process.env.CENTDECK_CONFIG_DIR=config;process.env.CENTDECK_PROJECTS_DIR=projects;
const require=createRequire(import.meta.url),store=require('../server/store');
store.saveSettings({providers:[{id:'long-provider',name:'A very long provider name for boundary verification',baseUrl:'http://127.0.0.1:9/a-very-long-provider-address-that-must-never-expand-the-sidebar/v1',noKey:true,enabled:true,models:['local-test']} ]});
const nodes=source=>{const result=[];function visit(n){if(n.tagName)result.push({tag:n.tagName,attrs:Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]))});for(const c of n.childNodes||[])visit(c);}visit(parse(source));return result;};
for(const id of ids){
  const dir=path.join(root,'templates',id),meta=JSON.parse(fs.readFileSync(path.join(dir,'project.json'),'utf8'));assert.equal(meta.pages.length,3);new vm.Script(fs.readFileSync(path.join(dir,'script.js'),'utf8'));
  const pages=Object.fromEntries(meta.pages.map(p=>[p.file,nodes(fs.readFileSync(path.join(dir,p.file),'utf8'))]));
  for(const [file,items]of Object.entries(pages)){
    assert.equal(items.filter(n=>n.tag==='h1').length,1,id+'/'+file);const names=items.map(n=>n.attrs.id).filter(Boolean);assert.equal(new Set(names).size,names.length,'duplicate ID');assert(items.some(n=>n.tag==='html'&&n.attrs.lang===(id==='northline'?'en':'zh-CN')));
    for(const n of items)for(const attr of ['href','src']){const url=n.attrs[attr];if(!url)continue;assert(!/^https?:/.test(url),'templates must not need external assets');if(url.startsWith('data:'))continue;const [relative,anchor]=url.split('#'),target=relative||file;assert(fs.existsSync(path.join(dir,target)),id+' missing '+url);if(anchor&&pages[target])assert(pages[target].some(n=>n.attrs.id===anchor),'broken anchor '+url);}
  }
}
assert(!store.listTemplates().some(t=>t.id==='admin'));assert.throws(()=>store.createProject({template:'admin'}),/模板不存在/);assert.equal(store.resetProject,undefined);
let server,cloneServer,ui,adapter;
async function launch(cwd,env){const child=spawn(process.execPath,['server/server.js'],{cwd,env:{...process.env,...env,CENTDECK_NO_OPEN:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.on('data',d=>process.stderr.write(d));const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);child.stdout.on('data',d=>{const m=String(d).match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(+m[1]);}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited'));});});return {child,port};}
async function login(origin){const r=await fetch(origin+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json','X-CentDeck':'1'},body:JSON.stringify(account)});assert(r.ok);return r.headers.get('set-cookie').split(';')[0];}
try{
  const running=await launch(root,{PORT:'8497'});server=running.child;const origin='http://127.0.0.1:'+running.port,cookie=await login(origin),headers={Cookie:cookie,'X-CentDeck':'1','Content-Type':'application/json'};
  const request=async(method,url,body)=>{const r=await fetch(origin+url,{method,headers,body:body?JSON.stringify(body):undefined});const j=await r.json();assert(r.ok,j.error);return j.data;};
  for(const id of ids){const p=await request('POST','/api/projects',{template:id,name:'QA '+id});assert.equal(p.pages.length,3);assert.equal((await fetch(origin+'/preview/'+p.id+'/style.css')).status,200);assert(!fs.existsSync(path.join(projects,p.id,'.centdeck','pristine')));const before=fs.readFileSync(path.join(projects,p.id,'index.html'),'utf8');const r=await fetch(origin+'/api/projects/'+p.id+'/reset',{method:'POST',headers});assert.equal(r.status,404);assert.equal(fs.readFileSync(path.join(projects,p.id,'index.html'),'utf8'),before);}
  ui=await browser(path.join(temp,'browser'));const split=cookie.indexOf('=');await ui.call('Network.setCookie',{url:origin,name:cookie.slice(0,split),value:cookie.slice(split+1)});
  await ui.call('Page.navigate',{url:origin+'/'});await ui.until("!!document.querySelector('.home-bar [data-a=preferences]')");await ui.until("document.documentElement.dataset.style==='noir'");
  assert.equal(await ui.evaluate("document.querySelector('.home-bar-right').lastElementChild.dataset.a"),'preferences');assert(!await ui.evaluate("!!document.querySelector('.home-bar [data-a=plugins]')"));
  await ui.evaluate("localStorage.setItem('cd.style','original')");await ui.call('Page.reload');await ui.until("document.documentElement.dataset.style==='original' && !!document.querySelector('.home-bar')");await ui.evaluate("localStorage.removeItem('cd.style')");await ui.call('Page.reload');await ui.until("document.documentElement.dataset.style==='noir' && !!document.querySelector('.home-bar')");
  const screenshotDir=path.join(root,'artifacts/screenshots/templates');fs.mkdirSync(screenshotDir,{recursive:true});
  await ui.evaluate("document.querySelector('[data-a=preferences]').click()");await ui.until("!!document.querySelector('[data-tab=providers]')");await ui.evaluate("document.querySelector('[data-tab=providers]').click()");await ui.until("!!document.querySelector('.provider-source-row')");
  for(const zoom of [1,1.25,1.5]){await ui.evaluate(`document.documentElement.style.zoom='${zoom}'`);const bounds=await ui.evaluate("(()=>{const s=document.querySelector('.provider-sources').getBoundingClientRect(),r=document.querySelector('.provider-source-row').getBoundingClientRect();return {edge:s.right,row:r.right};})()");assert(bounds.row<bounds.edge-2,JSON.stringify({zoom,bounds}));}await ui.evaluate("document.documentElement.style.zoom='1'");
  await ui.call('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(screenshotDir,'provider-sidebar.png'),Buffer.from(r.data,'base64')));
  await ui.evaluate("document.querySelector('[data-tab=mcp]').click()");await ui.until("!!document.querySelector('.mcp-user-guide')");assert(!/list_skills|read_skill|ui_action|external_claim|已验证/.test(await ui.evaluate("document.querySelector('.mcp-user-guide').textContent")));
  assert.equal(await ui.evaluate("document.querySelector('.mcp-config-details').open"),false);
  await ui.call('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(screenshotDir,'mcp-guide.png'),Buffer.from(r.data,'base64')));
  const loadedConfig=await request('GET','/api/mcp/config');assert.equal(loadedConfig.args[0],path.join(root,'server/mcp-stdio.js'));assert.equal(loadedConfig.env.CENTDECK_CONFIG_DIR,config);assert.equal(loadedConfig.env.CENTDECK_URL,origin);
  for(const id of ids){
    const meta=JSON.parse(fs.readFileSync(path.join(root,'templates',id,'project.json'),'utf8'));
    for(const width of [1440,393]){
      await ui.call('Emulation.setDeviceMetricsOverride',{width,height:width===393?852:1000,deviceScaleFactor:1,mobile:false});
      for(const page of meta.pages){
        const url=origin+'/tpl/'+id+'/'+page.file;await ui.call('Page.navigate',{url});await ui.until(`location.href===${JSON.stringify(url)} && document.readyState==='complete'`);
        await ui.evaluate("document.fonts.ready");const overflow=await ui.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length})");assert(overflow.scroll<=overflow.width+1,JSON.stringify({id,page:page.file,width,overflow}));assert.equal(overflow.h1,1);
        if(page.file==='index.html'){await ui.call('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(screenshotDir,id+'-'+(width===393?'mobile':'desktop')+'.png'),Buffer.from(r.data,'base64')));}
        if(width===393){await ui.evaluate("document.querySelector('.menu-toggle').click()");assert.equal(await ui.evaluate("document.querySelector('.menu-toggle').getAttribute('aria-expanded')"),'true');await ui.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});assert.equal(await ui.evaluate("document.querySelector('.menu-toggle').getAttribute('aria-expanded')"),'false');}
      }
    }
  }
  const visit=async(id,file)=>{await ui.call('Page.navigate',{url:origin+'/tpl/'+id+'/'+file});await ui.until("document.readyState==='complete'");};
  await visit('qichuan','stays.html');await ui.evaluate("document.querySelector('[data-room=\"1280\"]').click();const f=document.querySelector('#booking-form');f.elements.arrival.value='2028-06-10';f.elements.departure.value='2028-06-12';f.requestSubmit()");assert.match(await ui.evaluate("document.querySelector('#booking .form-status').textContent"),/2,560/);assert(await ui.evaluate("document.querySelector('#booking').open"));
  await visit('gewu','collection.html');await ui.evaluate("document.querySelector('[data-filter=ceramic]').click()");assert.equal(await ui.evaluate("document.querySelectorAll('.product:not([hidden])').length"),1);await ui.evaluate("document.querySelector('[data-add=vessel]').click();document.querySelector('[data-cart]').click();document.querySelector('[data-more=vessel]').click();document.querySelector('[data-summary]').click()");assert.match(await ui.evaluate("document.querySelector('.bag-summary').value"),/¥520/);await ui.call('Page.reload');await ui.until("document.readyState==='complete' && document.querySelector('[data-count]')?.textContent==='2'");
  await visit('northline','work.html');await ui.evaluate("document.querySelector('[data-filter=residential]').click()");assert.equal(await ui.evaluate("document.querySelectorAll('.work-card:not([hidden])').length"),1);await ui.evaluate("document.querySelector('[data-project=courtyard]').click()");assert.match(await ui.evaluate("document.querySelector('#detail-title').textContent"),/Courtyard/);await ui.evaluate("document.querySelector('#project-detail').close();document.querySelector('[data-inquire]').click();const f=document.querySelector('#inquiry-form');f.elements.name.value='Test';f.elements.email.value='test@example.com';f.elements.brief.value='A quiet home';f.requestSubmit()");assert.match(await ui.evaluate("document.querySelector('#inquiry .form-status').textContent"),/No message has been sent/);
  assert(!ui.errors.length,ui.errors.join('\n'));
  // A different installation path and unrelated cwd must produce and run its own adapter.
  const relocated=path.join(temp,'另一台电脑 的安装目录');fs.mkdirSync(relocated);fs.cpSync(path.join(root,'server'),path.join(relocated,'server'),{recursive:true});fs.cpSync(path.join(root,'plugins'),path.join(relocated,'plugins'),{recursive:true});fs.mkdirSync(path.join(relocated,'config.local'));fs.writeFileSync(path.join(relocated,'config.local','account.json'),JSON.stringify(account));
  const clone=await launch(relocated,{PORT:'8499',CENTDECK_CONFIG_DIR:'',CENTDECK_PROJECTS_DIR:''});cloneServer=clone.child;const cloneOrigin='http://127.0.0.1:'+clone.port,cloneCookie=await login(cloneOrigin);const connection=await fetch(cloneOrigin+'/api/mcp/config',{headers:{Cookie:cloneCookie}}).then(r=>r.json()).then(j=>j.data);assert.equal(connection.args[0],path.join(relocated,'server','mcp-stdio.js'));assert.equal(connection.command,process.execPath);assert.match(connection.token,/^[a-f0-9]{64}$/);assert(!connection.args[0].startsWith(root));
  adapter=spawn(connection.command,connection.args,{cwd:os.tmpdir(),env:{...process.env,CENTDECK_CONFIG_DIR:'',CENTDECK_PROJECTS_DIR:'',...connection.env},windowsHide:true,stdio:['pipe','pipe','pipe']});
  const initialized=new Promise((resolve,reject)=>{
    let buffer='';const timer=setTimeout(()=>reject(Error('Relocated adapter timeout')),10000);
    adapter.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(buffer.split('\n')[0]));}catch(e){reject(e);}}});
  });
  adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'relocation-test',version:'1'}}})+'\n');assert((await initialized).result);
  console.log('Release QA: nine template pages at desktop/mobile, local assets/links, bookings, product filters/cart, English project/inquiry flow, default noir, sidebar at 100/125/150%, removed reset/admin, product MCP copy and relocated stdio connection passed');
}finally{
  adapter?.kill();await ui?.close();for(const child of [server,cloneServer])if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});
  if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('centdeck-release-'))try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:150});}catch{}
}
