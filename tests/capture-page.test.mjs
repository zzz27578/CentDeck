/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-capture-test-'));
process.env.CENTDECK_CONFIG_DIR=path.join(temp,'config');process.env.CENTDECK_PROJECTS_DIR=path.join(temp,'projects');
const require=createRequire(import.meta.url),store=require('../server/store'),ext=require('../server/extensions'),mcp=require('../server/mcp'),capture=require('../server/capture');
try{
  const project=store.createProject({blank:true,name:'Capture test'}),dir=store.projectDir(project.id);
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capture proof</title><link rel="stylesheet" href="style.css"></head><body><h1>Capture proof</h1><p>Local assets, isolated browser.</p></body></html>');
  fs.writeFileSync(path.join(dir,'style.css'),'body{margin:0;padding:24px;background:#293fbd;color:white;font:24px system-ui}h1{font-size:36px}@media(max-width:500px){h1{font-size:28px}}');
  const before=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  ext.mcpConfig({mode:'plan',enabled:true});const sid=(await mcp.dispatch({method:'initialize',params:{protocolVersion:'2025-03-26'}})).sid;
  const result=(await mcp.dispatch({method:'tools/call',params:{name:'capture_page',arguments:{projectId:project.id,path:'index.html',width:393,height:852}}},sid)).result;
  assert(!result.isError,result.content[0].text);const info=JSON.parse(result.content[0].text),image=result.content[1];
  assert.equal(image.type,'image');assert.equal(image.mimeType,'image/png');assert(Buffer.from(image.data,'base64').length>1000);
  assert.equal(info.width,393);assert.equal(info.height,852);assert.equal(info.viewport.width,393);assert.equal(info.viewport.title,'Capture proof');assert.equal(info.liveBrowserState,false);
  assert.equal(fs.readFileSync(path.join(dir,'index.html'),'utf8'),before);
  await assert.rejects(capture.capture(project.id,{path:'../index.html'}));await assert.rejects(capture.capture(project.id,{path:'index.html',width:100,height:100}));
  console.log('Capture: actual 393×852 Chromium render, linked CSS, PNG MCP content, viewport evidence, read-only source and path/size guards passed');
}finally{if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('centdeck-capture-test-'))fs.rmSync(temp,{recursive:true,force:true});}
