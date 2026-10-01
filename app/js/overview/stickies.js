/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
import { el, esc, uid, showMenu } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { notePalette, COLORS } from '../core/note-colors.js';
import { nextColorNumber, migrateColorNumbers } from '../core/note-numbers.js';

export function createStickies(app, c) {
  let layer, editor, selected, cleanup = () => {};
  function notes() { const p=app.project();p.canvasNotes ||= [];migrateColorNumbers(p,'canvasNotes');return p.canvasNotes; }
  function position(n) { const p=c.cards().find(p=>!p.popup&&p.file===n.page);return p&&n.offset?{x:p.x+n.offset.x,y:p.y+n.offset.y}:n; }
  function anchor(pt) {
    const distance=p=>Math.hypot(Math.max(p.x-pt.x,0,pt.x-p.x-p.w),Math.max(p.y-pt.y,0,pt.y-p.y-p.h));
    const p=c.cards().filter(p=>!p.popup).sort((a,b)=>distance(a)-distance(b)).find(p=>distance(p)*(c.cam?.().z||1)<100);
    return p?{page:p.file,offset:{x:pt.x-p.x,y:pt.y-p.y}}:{page:null,offset:null};
  }
  async function edit(n,patch,label) { const old=Object.fromEntries(Object.keys(patch).map(k=>[k,n[k]]));await app.bus.doMeta({label,apply:()=>Object.assign(n,patch),revert:()=>Object.assign(n,old)});paint(); }
  async function finish() {
    if(!editor)return;
    const n=selected,text=editor.querySelector('textarea').value.trim();editor.remove();editor=null;selected=null;
    if(n&&notes().includes(n)&&text!==n.text)await edit(n,{text},i18nText('编辑画布便签'));
  }
  async function remove(n) {
    if(selected===n){editor?.remove();editor=null;selected=null;}
    const list=notes(),i=list.indexOf(n);await app.bus.doMeta({label:i18nText('删除画布便签'),apply:()=>list.splice(list.indexOf(n),1),revert:()=>list.splice(i,0,n)});paint();
  }
  async function open(n) {
    await finish();selected=n;
    editor=el(i18nTpl`<section class="ov-note-editor" style="--note-color:${n.color}"><header><b>便签 #${n.no}</b><button class="icon-btn sm" aria-label="删除便签" data-delete>${icon('trash',15)}</button></header><textarea class="ipt" rows="4" aria-label="便签内容" placeholder="添加批注…"></textarea><footer>${notePalette(n.color)}<button class="note-confirm" data-confirm>${icon('check',15)}确认</button></footer></section>`);
    c.world.append(editor);const ta=editor.querySelector('textarea');ta.value=n.text;
    editor.onpointerdown=e=>e.stopPropagation();editor.querySelectorAll('button').forEach(b=>b.onpointerdown=e=>e.preventDefault());
    editor.querySelector('[data-confirm]').onclick=finish;editor.querySelector('[data-delete]').onclick=()=>remove(n);
    editor.querySelectorAll('[data-c]').forEach(b=>b.onclick=async()=>{const color=b.dataset.c,text=ta.value,no=color===n.color?n.no:nextColorNumber(notes(),color,n);editor.remove();editor=null;selected=null;await edit(n,{color,no,text},i18nText('便签换色'));await open(n);});
    ta.onkeydown=e=>{if((e.key==='Enter'&&!e.shiftKey&&!e.isComposing)||e.key==='Escape'){e.preventDefault();e.stopPropagation();finish();}};sync();ta.focus();
  }
  function sync() {
    layer?.querySelectorAll('[data-id]').forEach(node=>{const n=notes().find(n=>n.id===node.dataset.id);if(!n)return;const p=position(n);node.style.left=p.x+'px';node.style.top=p.y+'px';});
    if(editor&&selected){const p=position(selected);editor.style.left=p.x+'px';editor.style.top=p.y+'px';}
  }
  function paint() {
    if(!layer?.isConnected)return;layer.innerHTML='';
    if(selected&&!notes().includes(selected)){editor?.remove();editor=null;selected=null;}
    notes().forEach(n=>{
      const node=el(i18nTpl`<button class="ov-note-pin" data-id="${esc(n.id)}" style="--note-color:${n.color}" aria-label="编辑便签 #${n.no}"><b>${n.no}</b><span>${esc(n.text||i18nText('添加批注'))}</span></button>`);
      node.onclick=()=>open(n);
      node.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();showMenu([{label:i18nText('编辑便签'),icon:'edit',onClick:()=>open(n)},{label:i18nText('引用到助手'),icon:'at',onClick:()=>app.agent.addRef({kind:'canvas-note',id:n.id,no:n.no,color:n.color,text:n.text})},{label:i18nText('删除便签'),icon:'trash',danger:true,onClick:()=>remove(n)}],e.clientX,e.clientY);};
      node.onpointerdown=e=>{
        if(e.button)return;e.stopPropagation();const start=c.toWorld(e.clientX,e.clientY),old=position(n);let next=null;
        const move=ev=>{const p=c.toWorld(ev.clientX,ev.clientY);if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)<4&&!next)return;next={x:old.x+p.x-start.x,y:old.y+p.y-start.y};node.style.left=next.x+'px';node.style.top=next.y+'px';};
        const end=()=>{cleanup();if(next){node.onclick=null;edit(n,{...next,...anchor(next)},i18nText('移动画布便签'));}};
        const cancel=()=>{cleanup();sync();};cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);};
        window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);
      };layer.append(node);
    });sync();
  }
  const outside=e=>{if(editor&&!editor.contains(e.target)&&!e.target.closest('.ov-note-pin'))finish();};
  return {
    mount(){layer=el('<div class="ov-stickies"></div>');c.world.append(layer);document.addEventListener('pointerdown',outside,true);paint();},paint,sync,
    async add(pt,color){const list=notes();color=COLORS.includes(color)?color:COLORS[0];const n={id:uid('note'),no:nextColorNumber(list,color),color,text:'',...pt,...anchor(pt)};await app.bus.doMeta({label:i18nText('添加画布便签'),apply:()=>list.push(n),revert:()=>list.splice(list.indexOf(n),1)});paint();await open(n);},
    erase(target){const n=notes().find(n=>n.id===target.closest('.ov-note-pin')?.dataset.id);if(n)remove(n);return !!n;},
    unmount(){finish();cleanup();document.removeEventListener('pointerdown',outside,true);layer=null;}
  };
}
