/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-external-'));
process.env.CENTDECK_CONFIG_DIR=path.join(tmp,'config');
process.env.CENTDECK_PROJECTS_DIR=path.join(tmp,'projects');
const require=createRequire(import.meta.url), ext=require('../server/extensions'), q=require('../server/external-agent'), providers=require('../server/providers');
const controllers=[];
const request=(think='high',tools=[])=>{const c=new AbortController();controllers.push(c);return {c,p:providers.complete('mcp:external',[{role:'user',content:'test'}],tools,think,c.signal,1024,{taskId:'t',projectId:'p'})};};
try {
  ext.mcpConfig({enabled:true,mode:'create'});
  for (const think of ['low','medium','high','xhigh','max','ultra']) {
    const {p}=request(think);const r=q.list()[0];assert.equal(r.think,think);
    const claimed=q.claim(r.id,'a');assert.equal(claimed.messages[0].content,'test');
    assert.throws(()=>q.claim(r.id,'b'),/其他/);
    assert.throws(()=>q.respond({id:r.id,lease:claimed.lease,message:{role:'assistant',content:'wrong'}},'b'),/租约/);
    const renewed=q.claim(r.id,'a');
    assert.throws(()=>q.respond({id:r.id,lease:claimed.lease,message:{role:'assistant',content:'stale'}},'a'),/租约/);
    q.respond({id:r.id,lease:renewed.lease,model:'test-only',message:{role:'assistant',content:'ok'}},'a');
    const result=await p;assert.equal(result.external.requestedThink,think);assert.equal(result.usage,null);assert.equal(q.list().length,0);
    assert.throws(()=>q.respond({id:r.id},'a'),/不存在/);
  }
  const {p,c}=request('high',[{type:'function',function:{name:'read_page'}}]);
  const r=q.claim(q.list()[0].id,'a');
  assert.throws(()=>q.respond({...r,message:{role:'assistant',tool_calls:[{id:'x',type:'function',function:{name:'write_files',arguments:'{}'}}]}},'a'),/未授权/);
  const rejection=assert.rejects(p,/停止/);c.abort();await rejection;assert.equal(q.list().length,0);
  const revoked=request();const revocation=assert.rejects(revoked.p,/创作模式/);ext.mcpConfig({mode:'plan'});await revocation;
  await assert.rejects(providers.complete('mcp:external',[],[],'high'),/创作模式/);
  console.log('External MCP agent: six reasoning levels, session ownership, lease renewal, stale response, tool authorization, cancellation and revocation passed');
} finally {
  controllers.forEach(c=>c.abort());
  if(path.dirname(tmp)===os.tmpdir()&&path.basename(tmp).startsWith('centdeck-external-'))fs.rmSync(tmp,{recursive:true,force:true});
}
