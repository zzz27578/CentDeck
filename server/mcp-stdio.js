#!/usr/bin/env node
/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
'use strict';
// Standard MCP stdio transport; keeps credentials in the local configuration.
const readline=require('node:readline');
const extensions=require('./extensions');
const endpoint=process.env.CENTDECK_URL||'http://127.0.0.1:8420';
const url=new URL(endpoint);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('CentDeck MCP requires a loopback URL');
let session='';
async function handle(line){
  let message;try{message=JSON.parse(line);}catch{return;}
  try {
    const config=extensions.mcpConfig();
    const response=await fetch(endpoint+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token,'X-CentDeck':'1',...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify(message),signal:AbortSignal.timeout(45000)});
    if(response.headers.has('Mcp-Session-Id'))session=response.headers.get('Mcp-Session-Id');
    if(message.id===undefined)return;
    const data=await response.json();process.stdout.write(JSON.stringify(data)+'\n');
  }catch(e){if(message.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:e.message}})+'\n');}
}
const rl=readline.createInterface({input:process.stdin});
let queue=Promise.resolve();rl.on('line',line=>{queue=queue.then(()=>handle(line));});
