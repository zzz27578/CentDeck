import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {createRequire} from 'node:module';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-mcp-wire-'));
process.env.CENTDECK_CONFIG_DIR=path.join(tmp,'config');process.env.CENTDECK_PROJECTS_DIR=path.join(tmp,'projects');process.env.CENTDECK_NO_OPEN='1';
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
process.env.PORT=String(port);process.env.CENTDECK_URL='http://127.0.0.1:'+port;
const require=createRequire(import.meta.url),ext=require('../server/extensions');ext.mcpConfig();
let server,bridge;
try{
  server=spawn(process.execPath,['server/server.js'],{env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.on('data',b=>{if(String(b).includes('本地服务已启动')){clearTimeout(timer);resolve();}});server.once('error',reject);server.once('exit',code=>{if(code)reject(Error('server exit '+code));});});
  const unauthorized=await fetch(process.env.CENTDECK_URL+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(unauthorized.status,401);
  bridge=spawn(process.execPath,['server/mcp-stdio.js'],{env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let id=0;
  const lines=readline.createInterface({input:bridge.stdout});lines.on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id);});
  function rpc(method,params={}){return new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>reject(Error('RPC timeout '+method)),12000);pending.set(n,r=>{clearTimeout(t);r.error?reject(Error(r.error.message)):resolve(r.result);});bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});}
  const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'transport-test',version:'1.0.0'}});assert.equal(init.serverInfo.name,'centdeck');
  bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const list=await rpc('tools/list');assert(list.tools.some(t=>t.name==='start_agent'));assert(list.tools.some(t=>t.name==='ui_action'));
  const project=await rpc('tools/call',{name:'create_project',arguments:{name:'Wire test'}});assert(!project.isError);const pid=JSON.parse(project.content[0].text).id;
  const read=await rpc('tools/call',{name:'read_page',arguments:{projectId:pid,path:'index.html'}});const {baseHash}=JSON.parse(read.content[0].text);
  const write=await rpc('tools/call',{name:'write_files',arguments:{projectId:pid,files:[{path:'index.html',baseHash,content:'<html><h1>Standard MCP</h1></html>'}]}});assert(!write.isError);
  const resources=await rpc('resources/list');assert(resources.resources.some(r=>r.uri==='centdeck://skills/platform-guide'));
  ext.mcpConfig({mode:'plan'});const denied=await rpc('tools/call',{name:'create_project',arguments:{name:'denied'}});assert(denied.isError);
  console.log('MCP wire: bearer rejection, stdio initialize/notification/list/read/write/resources and mode revocation passed');
}finally{bridge?.kill();server?.kill();await new Promise(r=>setTimeout(r,300));if(path.dirname(tmp)===os.tmpdir()&&path.basename(tmp).startsWith('centdeck-mcp-wire-'))fs.rmSync(tmp,{recursive:true,force:true});}
