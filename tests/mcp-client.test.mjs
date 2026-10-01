import assert from 'node:assert/strict';
import {collectControls,fillControl,previewText} from '../app/js/core/mcp-dom.js';
import {connectWorkbench} from '../app/js/core/mcp-client.js';
class Element {
  isConnected=true;attrs={};name='';id='';textContent='';innerText='';labels=[];events=[];tagName='BUTTON';visible=true;
  constructor(doc,tag='BUTTON',type=''){this.ownerDocument=doc;this.tagName=tag;this.type=type;}
  getAttribute(k){return this.attrs[k]??null;}hasAttribute(k){return k in this.attrs;}
  closest(selector){if(/private|sensitive/.test(selector)&&this.private)return this;if(/hidden|inert/.test(selector)&&this.hidden)return this;return null;}
  getClientRects(){return this.visible?[{}]:[];}getBoundingClientRect(){return{x:20,y:30,left:20,top:30,right:120,bottom:60,width:100,height:30};}
  matches(selector){return selector.split(',').some(s=>{s=s.trim();if(s==='input[type=password]')return this.type==='password';if(s==='input[type=file]')return this.type==='file';if(s==='input[type=checkbox]')return this.type==='checkbox';if(s==='input[type=radio]')return this.type==='radio';if(s.startsWith('input:not('))return this.tagName==='INPUT'&&!['button','submit'].includes(this.type);return s===this.tagName.toLowerCase();});}
  dispatchEvent(e){this.events.push(e.type);}click(){this.clicked=(this.clicked||0)+1;}
}
class Input extends Element{_value='';_checked=false;get value(){return this._value;}set value(v){this._value=v;}get checked(){return this._checked;}set checked(v){this._checked=v;}}
function doc(){const d={controls:[],texts:[],modal:null,hidden:false,hasFocus:()=>false,addEventListener(){},removeEventListener(){},getElementById:()=>null,querySelector:()=>null,querySelectorAll:selector=>selector.includes('dialog[open]')?(d.modal?[d.modal]:[]):d.controls};d.defaultView={innerWidth:393,innerHeight:852,scrollX:0,scrollY:0,getComputedStyle:()=>({display:'block',visibility:'visible'}),HTMLInputElement:Input,HTMLTextAreaElement:Input,HTMLSelectElement:Input,Event:class{constructor(type){this.type=type;}},NodeFilter:{SHOW_TEXT:4}};d.documentElement={scrollWidth:400,scrollHeight:1200};d.body=new Element(d,'BODY');d.createTreeWalker=()=>{let i=0;return{nextNode:()=>d.texts[i++]||null};};return d;}
const page=doc(),button=new Element(page),field=new Input(page,'INPUT','text'),password=new Input(page,'INPUT','password'),apiKey=new Input(page,'INPUT','text'),file=new Input(page,'INPUT','file'),hidden=new Element(page);
button.attrs['aria-label']='Filter brand';button.attrs['aria-pressed']='true';field.labels=[{textContent:'Your name'}];field.value='Alex';password.value='never-return';apiKey.name='apiKey';apiKey.value='secret';hidden.visible=false;
page.controls=[button,field,password,apiKey,file,hidden];
let sequence=0;const controls=collectControls(page,'preview',()=>String(++sequence));assert.equal(controls.length,2);assert.equal(controls[0].pressed,true);assert.equal(controls[1].value,'Alex');assert.equal(controls[1].label,'Your name');assert(!JSON.stringify(controls).includes('secret'));
fillControl(field,'New name');assert.equal(field.value,'New name');assert.deepEqual(field.events,['input','change']);assert.throws(()=>fillControl(password,'no'));assert.throws(()=>fillControl(file,'no'));assert.throws(()=>fillControl(apiKey,'no'));
const check=new Input(page,'INPUT','checkbox');fillControl(check,'true');assert.equal(check.checked,true);assert.throws(()=>fillControl(check,'yes'));
const publicText=new Element(page,'P'),privateText=new Element(page,'P');privateText.private=true;page.texts=[{parentElement:publicText,textContent:'Visible project copy'},{parentElement:privateText,textContent:'Secret panel'}];assert.equal(previewText(page),'Visible project copy');
page.modal={querySelectorAll:()=>[field]};assert.equal(collectControls(page,'preview',()=>String(++sequence)).length,1);page.modal=null;
const root=doc(),iframe=new Element(root,'IFRAME'),intervals=new Set(),events=new Map(),storage=new Map([['cd.mcpClient','stable-tab']]);
globalThis.document=root;globalThis.sessionStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
Object.defineProperty(globalThis,'performance',{configurable:true,value:{getEntriesByType:()=>[{type:'reload'}]}});
globalThis.addEventListener=(k,f)=>events.set(k,f);globalThis.removeEventListener=(k,f)=>{if(events.get(k)===f)events.delete(k);};globalThis.setInterval=fn=>{intervals.add(fn);return fn;};globalThis.clearInterval=fn=>intervals.delete(fn);
let release,calls=0,beats=0,resultPosts=0,latestState;const hold=new Promise(r=>release=r);
const command={id:'single-command',action:'open_project',projectId:'p',expiresAt:Date.now()+10000};
const app={state:{page:'index.html'},view:()=> 'edit',project:()=>({id:'p',name:'Test'}),editor:{frame:{iframe,doc:page,win:page.defaultView}},openProject:async()=>{calls++;await hold;},api:{extension:async(url,payload)=>{if(url==='ui/heartbeat'){beats++;latestState=payload.state;return{commands:[command]};}if(url==='ui/result'){resultPosts++;if(resultPosts===1)throw Error('retry transport');return{received:true};}}}};
const bridge=connectWorkbench(app);await new Promise(r=>setTimeout(r,0));assert.equal(bridge.clientId,'stable-tab');assert.equal(calls,1);
await [...intervals][0]();assert(beats>=2,'heartbeats continue while an action is awaiting completion');assert.equal(latestState.busy,true);assert.equal(latestState.preview.viewport.horizontalOverflow,true);assert(latestState.controls.some(c=>c.context==='preview'));
assert(latestState.controls.every(c=>c.id.startsWith(bridge.documentId.slice(0,8))));
release();await new Promise(r=>setTimeout(r,130));await [...intervals][0]();assert(resultPosts>=2,'lost acknowledgement is retried');assert.equal(calls,1,'retried receipt must not replay the action');
events.get('pagehide')();assert.equal(intervals.size,0);events.get('pageshow')({persisted:true});assert.equal(intervals.size,1);bridge.dispose();
console.log('MCP browser client: iframe controls/values, privacy filters, native input events, modal scope, stable reload ID, independent heartbeat and receipt retry passed');
