/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
'use strict';
// Isolated project rendering. Never attaches to a user's browser/profile or desktop.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const store=require('./store');
const {ApiError}=store;
let busy=false;
function browserPath(){
  const candidates=[process.env.CENTDECK_CAPTURE_BROWSER];
  if(process.platform==='win32')for(const root of [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean))candidates.push(path.join(root,'Microsoft/Edge/Application/msedge.exe'),path.join(root,'Google/Chrome/Application/chrome.exe'));
  else candidates.push('/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  const found=candidates.find(p=>p&&path.isAbsolute(p)&&fs.existsSync(p));
  if(!found)throw new ApiError(503,'未找到本机 Edge/Chrome。可通过 CENTDECK_CAPTURE_BROWSER 指定已安装浏览器的完整路径');
  return found;
}
function sourceFile(base,rel){
  if(typeof rel!=='string'||!rel||rel.includes('\\')||rel.includes(':')||rel.split('/').some(p=>!p||p==='..'||p.startsWith('.'))||rel==='project.json')throw new ApiError(400,'截图路径必须是项目内公开资源');
  const full=store.safeJoin(base,rel),real=fs.realpathSync(full),root=fs.realpathSync(base);
  if(!real.toLowerCase().startsWith((root+path.sep).toLowerCase())||path.relative(root,real).split(path.sep).some(p=>p.startsWith('.')))throw new ApiError(400,'截图资源不能越过项目目录或读取隐藏文件');
  if(!fs.statSync(real).isFile())throw new ApiError(400,'截图路径不是文件');
  return real;
}
const mime={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.json':'application/json'};
function devtools(child){
  let sequence=0,buffer=Buffer.alloc(0);const pending=new Map(),events=new Set();
  child.stdio[4].on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);let end;
    while((end=buffer.indexOf(0))>=0){const raw=buffer.subarray(0,end).toString();buffer=buffer.subarray(end+1);let msg;try{msg=JSON.parse(raw);}catch{continue;}
      const entry=pending.get(msg.id);if(entry){pending.delete(msg.id);clearTimeout(entry.timer);msg.error?entry.reject(new ApiError(502,'截图渲染命令失败：'+msg.error.message)):entry.resolve(msg.result);}
      else for(const e of events)if(e.method===msg.method&&e.sessionId===msg.sessionId){events.delete(e);clearTimeout(e.timer);e.resolve(msg.params);}
    }
  });
  const stop=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new ApiError(502,'截图浏览器已退出'));}pending.clear();for(const e of events){clearTimeout(e.timer);e.reject(new ApiError(502,'截图页面加载中断'));}events.clear();};
  child.once('error',stop);child.once('exit',stop);child.stdio[3].on('error',stop);
  return {
    send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new ApiError(408,'截图渲染命令超时'));},12000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});},
    event(method,sessionId){return new Promise((resolve,reject)=>{const e={method,sessionId,resolve,reject};e.timer=setTimeout(()=>{events.delete(e);reject(new ApiError(408,'截图页面加载超时'));},12000);events.add(e);});},stop
  };
}
async function capture(projectId,a){
  const base=store.projectDir(projectId);
  if(!/\.html?$/i.test(a.path||''))throw new ApiError(400,'只能渲染项目内 HTML 页面');
  sourceFile(base,a.path);
  const width=a.width??1440,height=a.height??1000;
  if(![width,height].every(v=>Number.isInteger(v)&&v>=320&&v<=2560))throw new ApiError(400,'截图宽高必须是 320–2560 的整数');
  const browser=browserPath();
  if(busy)throw new ApiError(429,'已有截图正在渲染，请完成后重试');
  busy=true;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-capture-')),nonce=crypto.randomBytes(24).toString('hex');
  let metrics=null,child=null,exited=false,cdp=null;
  const server=http.createServer((req,res)=>{
    try{
      const u=new URL(req.url,'http://127.0.0.1');
      const cookie=(req.headers.cookie||'').split(';').some(x=>x.trim()==='capture='+nonce);
      if(!cookie&&u.searchParams.get('capture')!==nonce){res.writeHead(403);res.end();return;}
      if(!cookie)res.setHeader('Set-Cookie','capture='+nonce+'; HttpOnly; SameSite=Strict; Path=/');
      res.setHeader('Cache-Control','no-store');
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const rel=decodeURIComponent(u.pathname.slice(1)),file=sourceFile(base,rel),type=mime[path.extname(file).toLowerCase()];
      if(!type){res.writeHead(415);res.end();return;}
      res.setHeader('Content-Type',type);
      res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'");
      const content=fs.readFileSync(file);
      res.end(req.method==='HEAD'?undefined:content);
    }catch{res.writeHead(404);res.end('Project resource unavailable');}
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url='http://127.0.0.1:'+server.address().port+'/'+a.path.split('/').map(encodeURIComponent).join('/')+'?capture='+nonce;
    child=spawn(browser,['--headless','--remote-debugging-pipe','--disable-gpu','--disable-extensions','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>;127.0.0.1:'+server.address().port,'--no-first-run','--no-default-browser-check','--hide-scrollbars','--user-data-dir='+path.join(dir,'profile')],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
    child.once('exit',()=>{exited=true;});cdp=devtools(child);
    const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    await cdp.send('Page.enable',{},sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
    const loaded=cdp.event('Page.loadEventFired',sessionId);loaded.catch(()=>{});
    const navigation=await cdp.send('Page.navigate',{url},sessionId);if(navigation.errorText)throw new ApiError(502,'项目页面加载失败');await loaded;
    await cdp.send('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>new Promise(resolve=>setTimeout(resolve,250)))',awaitPromise:true},sessionId);
    const info=await cdp.send('Runtime.evaluate',{expression:'({url:location.href,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,title:document.title})',returnByValue:true},sessionId);metrics=info.result?.value||null;
    if(!metrics?.url||new URL(metrics.url).origin!==new URL(url).origin)throw new ApiError(403,'页面跳转到项目之外，已停止截图');
    const renderedPath=decodeURIComponent(new URL(metrics.url).pathname.slice(1));sourceFile(base,renderedPath);delete metrics.url;
    const captured=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true},sessionId);
    const png=Buffer.from(captured.data,'base64');
    if(png.length>12*1024*1024||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new ApiError(502,'截图结果不是有效大小的 PNG');
    return {info:{projectId,path:a.path,renderedPath,width:png.readUInt32BE(16),height:png.readUInt32BE(20),viewport:metrics,capture:'fresh-project-render',liveBrowserState:false,network:'仅加载项目本地资源与内嵌资源',capturedAt:new Date().toISOString()},data:png.toString('base64')};
  }finally{
    if(cdp)try{await cdp.send('Browser.close');}catch{}
    if(child&&!exited)child.kill();
    server.closeAllConnections();await new Promise(r=>server.close(r));
    const resolved=path.resolve(dir),temp=path.resolve(os.tmpdir());
    if(path.dirname(resolved)===temp&&path.basename(resolved).startsWith('centdeck-capture-'))try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:150});}catch{}
    busy=false;
  }
}
module.exports={capture,browserPath};
