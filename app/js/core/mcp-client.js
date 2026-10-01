/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from './i18n.js';
import {collectControls,activeScope,visibleControl,fillControl,previewText} from './mcp-dom.js';

export function connectWorkbench(app){
  const documentId=crypto.randomUUID();
  let clientId;
  try{const navigation=performance.getEntriesByType('navigation')[0]?.type;clientId=(['reload','back_forward'].includes(navigation)&&sessionStorage.getItem('cd.mcpClient'))||crypto.randomUUID();sessionStorage.setItem('cd.mcpClient',clientId);}catch{clientId=crypto.randomUUID();}
  let controls=new Map(),sequence=0,polling=false,stopped=false,executing=0,chain=Promise.resolve();
  const ids=new WeakMap(),received=new Set(),results=new Map();
  function preview(){
    if(app.view()!=='edit'||!app.editor?.frame?.doc||!visibleControl(app.editor.frame.iframe))return null;
    const frame=app.editor.frame;
    return {doc:frame.doc,win:frame.win,page:app.state.page};
  }
  function snapshot(){
    const next=new Map();
    const identify=(n,context)=>{if(!ids.has(n))ids.set(n,documentId.slice(0,8)+'-c'+(++sequence));const id=ids.get(n);next.set(id,{node:n,context,doc:n.ownerDocument,page:context==='preview'?app.state.page:null});return id;};
    const list=collectControls(document,'workbench',identify),p=preview();let pageState=null;
    if(p){
      const pageControls=collectControls(p.doc,'preview',identify),d=p.doc.documentElement;
      pageState={page:p.page,ready:!app.editor.loading,title:p.doc.title,viewport:{width:p.win.innerWidth,height:p.win.innerHeight,scrollX:p.win.scrollX,scrollY:p.win.scrollY,scrollWidth:d.scrollWidth,scrollHeight:d.scrollHeight,horizontalOverflow:d.scrollWidth>p.win.innerWidth+1},text:previewText(p.doc),controls:pageControls};
      list.push(...pageControls);
    }
    controls=next;
    return {focused:document.hasFocus(),hidden:document.hidden,busy:executing>0,documentId,projectId:app.project()?.id||null,projectName:app.project()?.name||null,page:app.state.page,view:app.view(),studio:document.querySelector('.studio h1')?.textContent||null,controls:list,preview:pageState};
  }
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function settle(){await delay(100);for(let i=0;i<60&&app.view()==='edit'&&app.editor?.loading;i++)await delay(50);}
  function control(c){
    const record=controls.get(c.target),n=record?.node;
    if(!n||!visibleControl(n)||n.disabled)throw Error(i18nText('STALE_CONTROL：控件已变化或不可操作，请重新 ui_state'));
    if(record.context==='preview'&&(preview()?.doc!==record.doc||record.page!==app.state.page))throw Error(i18nText('STALE_CONTROL：网页已切换，请重新 ui_state'));
    const scope=activeScope(n.ownerDocument);if(scope!==n.ownerDocument&&!scope.contains(n))throw Error(i18nText('控件被弹窗遮挡，请先处理当前弹窗'));
    return record;
  }
  async function action(c){
    if(c.expiresAt&&Date.now()>c.expiresAt)throw Error(i18nText('COMMAND_EXPIRED：操作已过期，未执行，请核对当前状态'));
    if(c.documentId&&c.documentId!==documentId)throw Error(i18nText('DOCUMENT_REPLACED：请重新 ui_state 获取刷新后的控件'));
    if(c.projectId&&c.action!=='open_project'&&app.project()?.id!==c.projectId)throw Error(i18nText('PROJECT_CHANGED：当前标签页已切换项目，操作未执行'));
    if(c.action==='open_project')await app.openProject(c.projectId);
    else if(c.action==='open_settings')await app.openSettings(c.section||'general');
    else if(c.action==='close_settings')document.querySelector('.studio [data-close]')?.click();
    else if(c.action==='open_page'){if(!app.project()?.pages.some(p=>p.file===c.page))throw Error(i18nText('页面不在当前项目中'));await app.openPage(c.page);}
    else if(c.action==='set_view'){if(!['overview','edit','present'].includes(c.view))throw Error(i18nText('视图无效'));await app.setView(c.view);}
    else if(c.action==='refresh'){if(app.project()){await app.refreshProject();await app.reloadView();}}
    else if(c.action==='click'||c.action==='fill'){
      const r=control(c),n=r.node;
      if(r.context==='preview')app.editor.setTool('interact');
      if(c.action==='click')n.click();else fillControl(n,c.value);
    }else if(c.action==='scroll'){
      if(c.target)control(c).node.scrollIntoView({block:'center',behavior:'instant'});
      else {const p=preview();if(!p)throw Error(i18nText('请先打开编辑页，或传入控件 target'));const x=c.x??p.win.scrollX,y=c.y??p.win.scrollY;if(![x,y].every(Number.isFinite))throw Error(i18nText('滚动坐标需要数字'));p.win.scrollTo({left:x,top:y,behavior:'instant'});}
    }else if(c.action==='add_mark'){
      const p=app.project(),page=c.page||app.state.page;if(!p?.pages.some(x=>x.file===page))throw Error(i18nText('请先打开需要标记的页面'));
      const mark=await app.sketch.addRaw({page,type:'note',color:'#e5484d',text:c.text||i18nText('请检查此处'),pts:[[c.x??120,c.y??120]],done:false});
      if(await app.bus.flushMeta()===false)throw Error(i18nText('标记保存失败'));await app.reloadView();return {mark,snapshot:snapshot()};
    }else if(c.action==='undo'){await app.bus.undo();if(await app.bus.flushMeta()===false)throw Error(i18nText('撤销保存失败'));}
    else throw Error(i18nText('不支持的页面操作'));
    await settle();return snapshot();
  }
  async function sendResults(){
    for(const [id,payload] of results){try{await app.api.extension('ui/result',payload);results.delete(id);}catch{return;}}
  }
  async function poll(){
    if(polling||stopped)return;polling=true;
    try{
      await sendResults();
      const {commands=[]}=await app.api.extension('ui/heartbeat',{clientId,documentId,state:snapshot()});
      for(const c of commands){
        if(received.has(c.id))continue;received.add(c.id);
        chain=chain.then(async()=>{executing++;let result,error;try{result=await action(c);}catch(e){error=e.message;}finally{executing--;}
          results.set(c.id,{clientId,documentId,id:c.id,result,error});await sendResults();});
      }
    }catch{}finally{polling=false;}
  }
  let timer=setInterval(poll,800);poll();
  const wake=()=>poll();document.addEventListener('visibilitychange',wake);addEventListener('focus',wake);
  const hide=()=>{stopped=true;clearInterval(timer);};
  const show=e=>{if(e.persisted){stopped=false;clearInterval(timer);timer=setInterval(poll,800);poll();}};
  addEventListener('pagehide',hide);addEventListener('pageshow',show);
  return {clientId,documentId,snapshot,dispose(){hide();document.removeEventListener('visibilitychange',wake);removeEventListener('focus',wake);removeEventListener('pagehide',hide);removeEventListener('pageshow',show);}};
}
