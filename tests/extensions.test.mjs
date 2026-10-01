/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-extensions-'));
process.env.CENTDECK_CONFIG_DIR=path.join(tmp,'config');
process.env.CENTDECK_PROJECTS_DIR=path.join(tmp,'projects');
const require=createRequire(import.meta.url),ext=require('../server/extensions'),store=require('../server/store'),mcp=require('../server/mcp'),tools=require('../server/tools');
try{
  assert.equal(ext.plugins().find(p=>p.manifest.id==='official-styles').enabled,true);
  ext.updatePlugin('official-styles','disable');assert.equal(ext.plugins().find(p=>p.manifest.id==='official-styles').enabled,false);
  const bundle={manifest:{apiVersion:1,id:'test-plugin',name:'Test',version:'1.0.0',permissions:['themes'],themes:[{id:'test-theme',name:'Test',tokens:{'--accent':'#123456'}}]},files:{}};
  ext.install(bundle);assert.equal(ext.plugins().find(p=>p.manifest.id==='test-plugin').enabled,false);
  assert.throws(()=>ext.install({...bundle,files:{'../bad.js':'alert(1)'}}));
  assert.throws(()=>ext.install({...bundle,manifest:{...bundle.manifest,themes:[{id:'bad-theme',tokens:{'--accent':'url(https://evil.test)'}}]}}));
  ext.updatePlugin('official-inspector','configure',{showLocks:false});assert.equal(ext.plugins().find(p=>p.manifest.id==='official-inspector').settings.showLocks,false);
  assert.throws(()=>ext.updatePlugin('official-inspector','configure',{showLocks:'false'}));
  assert.throws(()=>ext.updatePlugin('official-inspector','disable'));assert(tools.list().some(t=>t.name==='plugin_official_inspector_summary'));
  assert.throws(()=>ext.updateSkill({id:'platform-guide',enabled:false}));assert(ext.skills().filter(s=>s.source==='builtin').every(s=>s.enabled&&s.internal));
  const saved=ext.designPresets({name:'My Style',tokens:{colors:{brand:'#123456'},radius:['4px']}});assert.equal(saved.length,1);assert.equal(ext.designPresets()[0].tokens.colors.brand,'#123456');ext.designPresets({action:'remove',id:saved[0].id});assert.equal(ext.designPresets().length,0);
  ext.updateSkill({id:'my-test',content:'---\nname: my-test\ndescription: test\n---\nRead first.',name:'Test'});assert(ext.skills().some(s=>s.id==='my-test'));
  ext.updateSkill({id:'my-test',enabled:false});assert(!ext.skills().find(s=>s.id==='my-test').enabled);
  const prefs=ext.preferences({budget:1000,maxSteps:3});assert.equal(prefs.maxSteps,3);assert.equal('budget' in prefs,false);
  const savedPreferences=JSON.parse(fs.readFileSync(path.join(store.CONFIG_DIR,'extensions.json'),'utf8')).preferences;assert.equal('budget' in savedPreferences,false);
  const before=ext.mcpConfig();const modified=fs.statSync(path.join(store.CONFIG_DIR,'extensions.json')).mtimeMs;ext.mcpConfig();assert.equal(fs.statSync(path.join(store.CONFIG_DIR,'extensions.json')).mtimeMs,modified,'MCP config reads must not write');
  const init=await mcp.dispatch({method:'initialize',params:{protocolVersion:'2025-03-26'}});assert(init.sid);
  const invoke=async(name,args={})=>{const out=await mcp.dispatch({method:'tools/call',params:{name,arguments:args}},init.sid);return out.result;};
  const decode=r=>JSON.parse(r.content[0].text);
  const p=decode(await invoke('create_project',{name:'MCP 测试'}));
  const read=decode(await invoke('read_page',{projectId:p.id,path:'index.html'}));
  const write=await invoke('write_files',{projectId:p.id,files:[{path:'index.html',baseHash:read.baseHash,content:'<!doctype html><html><h1>MCP written</h1></html>'}]});assert(!write.isError);
  assert((await invoke('write_files',{projectId:p.id,files:[{path:'index.html',baseHash:read.baseHash,content:'<h1>stale</h1>'}]})).isError);
  ext.mcpConfig({mode:'plan'});assert((await invoke('create_project',{name:'forbidden'})).isError);assert((await invoke('ui_action',{action:'click',target:'c1'})).isError);assert(!tools.list('plan').some(t=>t.name==='write_files'));
  ext.mcpConfig({mode:'create'});
  let project=store.getProject(p.id);project.locks={pages:['index.html'],elements:[]};store.saveProject(p.id,project);
  const locked=decode(await invoke('read_page',{projectId:p.id,path:'index.html'}));assert((await invoke('patch_text',{projectId:p.id,path:'index.html',before:'MCP written',after:'overwrite'})).isError);
  const zip=require('../server/export').exportProject(p.id);assert.equal(zip.readUInt32LE(0),0x04034b50);assert(!zip.includes(Buffer.from('settings.json')));
  assert.equal(before.token.length,64);
  console.log('Extensions/MCP: plugin lifecycle, permission validation, skill persistence, tool registration, read-only config, MCP initialize/read/write/conflict/plan/lock and ZIP export passed');
}finally{if(path.dirname(tmp)===os.tmpdir()&&path.basename(tmp).startsWith('centdeck-extensions-'))fs.rmSync(tmp,{recursive:true,force:true});}
