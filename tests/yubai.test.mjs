import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from '../app/js/vendor/parse5.js';
const root=path.resolve('examples/yubai'),pages=['index.html','case.html','services.html'];
const scan=source=>{const result=[];const visit=n=>{if(n.tagName)result.push({tag:n.tagName,attrs:Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value])),node:n});for(const c of n.childNodes||[])visit(c);};visit(parse(source));return result;};
const parsed=Object.fromEntries(pages.map(file=>[file,scan(fs.readFileSync(path.join(root,file),'utf8'))]));
for(const file of pages){
  const elements=parsed[file],ids=elements.map(n=>n.attrs.id).filter(Boolean);
  assert.equal(new Set(ids).size,ids.length,file+' duplicate IDs');assert.equal(elements.filter(n=>n.tag==='h1').length,1);
  assert(elements.some(n=>n.tag==='meta'&&n.attrs.name==='viewport'));
  assert(elements.some(n=>n.tag==='button'&&n.attrs['aria-controls']==='site-nav'));
  assert(elements.some(n=>n.tag==='dialog'&&n.attrs.id==='contact-dialog'));
  for(const n of elements)for(const attr of ['href','src']){
    const url=n.attrs[attr];if(!url||/^(https?:|mailto:|data:)/.test(url))continue;
    const [dest,hash]=url.split('#'),target=dest||file;assert(fs.existsSync(path.join(root,target)),file+' missing asset/link '+url);
    if(hash&&parsed[target])assert(parsed[target].some(e=>e.attrs.id===hash),file+' broken anchor '+url);
  }
}
assert.equal(parsed['services.html'].filter(n=>n.tag==='details').length,4);
const tokens=JSON.parse(fs.readFileSync(path.join(root,'design/tokens.json'),'utf8'));assert.equal(tokens.colors.brand,'#293fbd');
class Node {
  listeners={};attrs={};hidden=false;textContent='';dataset={};focused=false;
  constructor(){const set=new Set();this.classList={toggle:(v,on)=>on?set.add(v):set.delete(v),add:v=>set.add(v),remove:v=>set.delete(v),contains:v=>set.has(v)};}
  addEventListener(k,f){this.listeners[k]=f;}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}focus(){this.focused=true;}
  fire(k,e={}){this.listeners[k]?.({target:this,...e});}contains(n){return n===this;}
}
const filters=['all','brand','digital'].map(value=>{const n=new Node();n.dataset.filter=value;return n;});
const cards=['brand','digital'].map(value=>{const n=new Node();n.dataset.category=value;return n;});
const dialog=new Node();dialog.showModal=()=>dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.fire('close');};dialog.getBoundingClientRect=()=>({left:10,right:200,top:10,bottom:200});
const contact=new Node(),toggle=new Node(),navigation=new Node(),form=new Node(),status=new Node(),filterStatus=new Node(),projects=new Node(),navLink=new Node(),body=new Node();
const doc=new Node();doc.body=body;doc.querySelector=s=>({'.nav':navigation,'.menu-toggle':toggle,'.projects':projects,'.filter-status':filterStatus}[s]||null);
doc.querySelectorAll=s=>({'[data-filter]':filters,'[data-category]':cards,'[data-contact]':[contact],'#site-nav a':[navLink]}[s]||[]);
doc.getElementById=id=>({'contact-dialog':dialog,'contact-form':form,'form-status':status}[id]||null);
const media=new Node();const data={name:'<img src=x onerror=alert(1)>',email:'test@example.com',idea:'Refine a website'};
vm.runInNewContext(fs.readFileSync(path.join(root,'script.js'),'utf8'),{document:doc,window:{matchMedia:()=>media},FormData:class{get(k){return data[k];}}});
filters[1].fire('click');assert.equal(cards.filter(c=>!c.hidden).length,1);assert.equal(cards[0].hidden,false);assert.equal(filters[1].attrs['aria-pressed'],'true');
filters[2].fire('click');assert.equal(cards[1].hidden,false);assert.equal(cards[0].hidden,true);
filters[0].fire('click');assert.equal(cards.filter(c=>!c.hidden).length,2);assert.match(filterStatus.textContent,/2/);
toggle.fire('click');assert.equal(toggle.attrs['aria-expanded'],'true');doc.fire('keydown',{key:'Escape'});assert.equal(toggle.attrs['aria-expanded'],'false');assert(toggle.focused);
toggle.fire('click');navLink.fire('click');assert.equal(toggle.attrs['aria-expanded'],'false');
toggle.fire('click');media.fire('change',{matches:true});assert.equal(toggle.attrs['aria-expanded'],'false');
contact.fire('click');assert(dialog.open);assert(body.classList.contains('dialog-open'));
dialog.fire('click',{clientX:50,clientY:50});assert(dialog.open);dialog.fire('click',{clientX:0,clientY:0});assert(!dialog.open);assert(contact.focused);assert(!body.classList.contains('dialog-open'));
form.reportValidity=()=>true;form.fire('submit',{currentTarget:form,preventDefault(){}});assert.equal(status.hidden,false);assert(status.textContent.includes(data.name));assert.match(status.textContent,/未发送或保存/);
console.log('YUBAI: three-page assets/anchors, mobile navigation, work filters, dialog focus/close and local form behavior passed (code-level checks)');
