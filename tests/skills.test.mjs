import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {isPlatformSkill,userSkills,selectedUserSkill} from '../app/js/core/skill-catalog.js';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'centdeck-skills-'));
process.env.CENTDECK_CONFIG_DIR=path.join(tmp,'config');process.env.CENTDECK_PROJECTS_DIR=path.join(tmp,'projects');
const require=createRequire(import.meta.url),ext=require('../server/extensions'),tools=require('../server/tools'),mcp=require('../server/mcp');
try {
  const base=ext.skills().filter(s=>s.internal);
  assert(base.length>=8);
  const legacy=base.map(({internal,official,...s})=>s);
  const custom={id:'my-layout',source:'local',enabled:true,name:'My layout'},disabled={id:'my-disabled',source:'local',enabled:false};
  assert.deepEqual(userSkills([...legacy,custom,disabled]),[custom,disabled]);
  assert.deepEqual(userSkills([...legacy,custom,disabled],true),[custom]);
  assert(base.filter(s=>s.source==='builtin').every(s=>isPlatformSkill({id:s.id})),'known identities stay hidden even without new metadata');
  assert.equal(selectedUserSkill(legacy,'design-system'),null,'restored or internally prefilled skills must not render as user chips');
  assert.equal(selectedUserSkill([custom],custom.id),custom);
  assert.equal(selectedUserSkill([disabled],disabled.id),null);
  assert(isPlatformSkill({id:'future-core',source:'builtin'}));assert(isPlatformSkill({id:'new-official--guide',source:'A plugin',official:true}));
  const overrides={plugins:{},skills:Object.fromEntries(base.map(s=>[s.id,{enabled:false}]))};
  // Legacy content collisions must not replace a reserved base skill.
  overrides.skills['page-edit']={id:'page-edit',content:'override',enabled:false};
  fs.mkdirSync(process.env.CENTDECK_CONFIG_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.CENTDECK_CONFIG_DIR,'extensions.json'),JSON.stringify(overrides));
  assert(ext.skills().filter(s=>s.internal).every(s=>s.enabled));assert.equal(ext.skills().filter(s=>s.id==='page-edit').length,1);
  assert.deepEqual(ext.userSkills(),[]);
  for(const s of base){
    for(const body of [{id:s.id,enabled:false},{id:s.id,action:'remove'},{id:s.id,name:'replacement',content:'---\nname: replacement\ndescription: test\n---\nReplacement'}])assert.throws(()=>ext.updateSkill(body));
  }
  ext.updateSkill({...custom,content:'---\nname: my-layout\ndescription: User layout preferences\n---\nUse compact spacing.'});
  assert.deepEqual(ext.userSkills().map(s=>s.id),['my-layout']);
  ext.updateSkill({id:'my-layout',enabled:false});assert.equal(ext.userSkills()[0].enabled,false);
  const context={mode:'plan'};
  const catalog=await tools.execute('list_skills',{},context);
  assert(base.every(s=>catalog.some(x=>x.id===s.id)));assert(!catalog.some(s=>s.id==='my-layout'));
  for(const s of base){const loaded=await tools.execute('read_skill',{id:s.id},context);assert(/^---\r?\n/.test(loaded.content));assert(loaded.content.length>100);}
  // Follow every read_skill example through the real tool, including the shared guide.
  for(const s of base)for(const match of s.content.matchAll(/read_skill\(\{"id":"([^"]+)"\}\)/g))assert((await tools.execute('read_skill',{id:match[1]},context)).content);
  const init=await mcp.dispatch({method:'initialize',params:{protocolVersion:'2025-03-26'}});
  const listed=await mcp.dispatch({method:'tools/call',params:{name:'list_skills',arguments:{}}},init.sid);
  assert(base.every(s=>JSON.parse(listed.result.content[0].text).some(x=>x.id===s.id)));
  const resources=(await mcp.dispatch({method:'resources/list'},init.sid)).result.resources;
  for(const s of base)assert(resources.some(r=>r.uri==='centdeck://skills/'+s.id));
  console.log('Skills: legacy UI filtering, restored chips, immutable base skills, custom toggles and Agent/MCP discovery passed');
} finally {if(path.dirname(tmp)===os.tmpdir()&&path.basename(tmp).startsWith('centdeck-skills-'))fs.rmSync(tmp,{recursive:true,force:true});}
