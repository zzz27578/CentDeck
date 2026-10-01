// Code-level component tests with small DOM doubles; these are not browser QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Events {
  events=new Map();
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
  removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of [...this.events.get(type)||[]])fn({type,...event});}
}
class Element extends Events {
  children=[];selectors=new Map();attrs=new Map();style={setProperty(){}};dataset={};value='';textContent='';isConnected=true;
  constructor(name=''){super();this.name=name;const values=new Set();this.classList={add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x),toggle:(x,v)=>{const on=v??!values.has(x);on?values.add(x):values.delete(x);return on;}};}
  querySelector(selector){if(!this.selectors.has(selector))this.selectors.set(selector,new Element(selector));return this.selectors.get(selector);}
  querySelectorAll(selector){if(selector==='[data-target]')return ['web','app'].map(id=>{const n=this.querySelector(id);n.dataset.target=id;return n;});if(selector==='input')return [this.querySelector('color'),this.querySelector('text')];return [];}
  append(...nodes){nodes.forEach(n=>{n.parent=this;this.children.push(n);});}
  appendChild(node){this.append(node);return node;}
  get firstElementChild(){return this.children[0];}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  contains(node){return this===node||this.children.some(c=>c.contains(node));}
  setAttribute(k,v){this.attrs.set(k,v);}removeAttribute(k){this.attrs.delete(k);}focus(){}
  get offsetLeft(){return parseFloat(this.style.left)||0;}get offsetTop(){return parseFloat(this.style.top)||0;}
  get offsetWidth(){return this.classList.contains('collapsed')?288:parseFloat(this.style.width)||310;}
  get offsetHeight(){return this.classList.contains('collapsed')?138:parseFloat(this.style.height)||240;}
  getBoundingClientRect(){return {left:this.offsetLeft,top:this.offsetTop,width:this.offsetWidth,height:this.offsetHeight,bottom:this.offsetTop+this.offsetHeight};}
}
const document=new Events(),window=new Events();document.body=new Element('body');document.getElementById=()=>null;
const messages=[];
const ui={esc:String,uid:()=>Math.random().toString(36),toast:(t)=>messages.push(t),showMenu:()=>{},el:html=>{const n=new Element(html);if(html.includes('class="agent-float"'))n.append(new Element('af-body'));return n;}};
const context=vm.createContext({document,window,console,structuredClone,innerWidth:1280,innerHeight:900,localStorage:{getItem:()=>null,setItem(){}},setTimeout,clearTimeout,File,Uint8Array,btoa});
async function moduleAt(file,imports){const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context});await m.link(async id=>{const exports=imports[id];assert(exports,'unmocked import '+id);const dep=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});return dep;});await m.evaluate();return m.namespace;}
const created=[];
const session={createSession:(app,mgr,opts)=>{const s={...opts,id:opts.id||'s'+created.length,root:new Element('session'),paintPickers(){},paintChips(){},restore(){},syncTasks(){},focus(){},blur(){},conversation(){return{};}};created.push(s);return s;}};
const {createAgent}=await moduleAt('app/js/agent/agent.js',{'../core/ui.js':ui,'../core/icons.js':{icon:()=>''},'./session.js':session,'./manager.js':{openAssistantManager(){}},'../core/skill-catalog.js':{userSkills:x=>x,selectedUserSkill:()=>null}});
const app={api:{extension:async()=>[],getSettings:async()=>({}),getAssistants:async()=>[{id:'one',name:'First'}],saveAssistants:async()=>{}},bus:{on(){},saveMeta(){}},project:()=>null,state:{project:null}};
const agent=createAgent(app);await agent.ready;
agent.manager.newWindow();const floating=document.body.children.find(n=>n.name.includes('class="agent-float"'));const s=created.at(-1);agent.manager.fold(s);assert(floating.classList.contains('collapsed'));
const anchor=new Element('assistant-name');agent.manager.pickSession(anchor);assert.equal(anchor.attrs.get('aria-expanded'),'true');
agent.manager.pickSession(anchor);assert.equal(anchor.attrs.get('aria-expanded'),'false');assert(!document.body.children.some(n=>n.name.includes('class="assistant-picker"')),'same trigger closes the picker');
const border={closest:selector=>selector==='.agent-float.collapsed'?floating:null};
const startX=floating.offsetLeft,startY=floating.offsetTop;
document.fire('pointerdown',{target:border,button:0,clientX:startX+2,clientY:startY+2});
window.fire('pointermove',{clientX:startX+4,clientY:startY+3,preventDefault(){}});assert.equal(floating.offsetLeft,startX,'small movement remains a click');
window.fire('pointermove',{clientX:startX-98,clientY:startY+42,preventDefault(){}});assert.equal(floating.offsetLeft,startX-100);assert.equal(floating.offsetTop,startY+40,'blank border is draggable without a header ancestor');
window.fire('pointercancel');assert.equal(window.events.get('pointermove').size,0);
const before=floating.offsetLeft,button={closest:selector=>selector==='.agent-float.collapsed'?floating:selector==='button:not(.ag-summary)'?anchor:null};
document.fire('pointerdown',{target:button,button:0,clientX:0,clientY:0});assert.equal(window.events.get('pointermove').size,0);assert.equal(floating.offsetLeft,before);
const {mountHomeComposer}=await moduleAt('app/js/shell/home-composer.js',{'../core/ui.js':ui,'../core/icons.js':{icon:()=>''},'../agent/attachments.js':await import('../app/js/agent/attachments.js'),'../agent/model-options.js':await import('../app/js/agent/model-options.js')});
const root=new Element('home'),box=root.querySelector('.hero-prompt'),ta=box.querySelector('textarea'),send=box.querySelector('[data-a=go]');
const settings={defaultModel:'p:visual',providers:[{id:'p',name:'Provider',enabled:true,models:['visual'],vision:true}]};
let submissions=[],release;const pending=new Promise(r=>release=r);const home={bus:{on:()=>()=>{}},api:{getSettings:async()=>settings}};
const dispose=mountHomeComposer(home,root,async payload=>{submissions.push(payload);await pending;return false;});
ta.value='Build mobile';ta.oninput();box.querySelector('app').onclick();
const fileInput=box.querySelector('[data-attachments]');fileInput.files=[new File(['context'],'brief.md')];fileInput.onchange();
const first=send.onclick();send.onclick();await new Promise(r=>setTimeout(r,0));assert.equal(submissions.length,1,'double submit must not create duplicate projects');
assert.equal(submissions[0].model,'p:visual');assert.equal(submissions[0].target,'app');assert.equal(submissions[0].refs[0].text,'context');release();await first;assert.equal(send.disabled,false);dispose();
console.log('Workbench components: border dragging, drag threshold/cancel, button exclusion, picker toggle and composer draft handoff passed');
const presets=await import('../app/js/panels/style-presets.js');
const {setupTokens}=await moduleAt('app/js/panels/tokens.js',{'../core/ui.js':{...ui,promptDlg:async()=>null},'./token-source.js':await import('../app/js/panels/token-source.js'),'../core/icons.js':{icon:()=>''},'./style-presets.js':presets});
const project={id:'test',pages:[{file:'index.html'},{file:'about.html'}],tokens:structuredClone(presets.PRESETS['现代 SaaS'])};
let panel,mode='edit',presetRequests=0,flushed=true;const commits=[];
const source='<html><head></head><body>Untouched</body></html>';
const tokenApp={state:{page:'index.html'},project:()=>project,view:()=>mode,pageLocked:()=>false,reloadView:async()=>{},bus:{registerPanel:p=>panel=p,flushMeta:async()=>flushed,do:async command=>command.apply(),on:()=>()=>{}},api:{extension:async()=>{presetRequests++;return[];},readFile:async()=>source,commitFiles:async(id,files)=>commits.push(files)}};
setupTokens(tokenApp);const host=new Element('panel');await panel.render(host);
assert.equal(presetRequests,0,'page editor must not load the preset library');assert(!host.children.some(n=>n.name.includes('preset-disclosure')));
assert.notEqual(project.pageTokens['index.html'],project.tokens);project.pageTokens['index.html'].colors.brand='#123456';assert.notEqual(project.tokens.colors.brand,'#123456');
const actions=host.children.find(n=>n.name.includes('data-apply'));await actions.querySelector('[data-apply]').onclick();
assert.deepEqual(Array.from(commits[0],f=>f.path),['index.html']);assert.match(commits[0][0].content,/#123456/);assert.equal(commits[0][0].before,source);
flushed=false;await actions.querySelector('[data-apply]').onclick();assert.equal(commits.length,1,'metadata save failure must stop source writes');
panel.onHide();mode='overview';const overviewHost=new Element('overview');await panel.render(overviewHost);assert.equal(presetRequests,1);
const disclosure=overviewHost.children.find(n=>n.name.includes('preset-disclosure'));assert(disclosure);assert(!/class="preset-disclosure" open/.test(disclosure.name),'overview presets start collapsed');
panel.onHide();console.log('Design settings: collapsed overview library, no editor presets, per-page isolation and save-failure guard passed');
