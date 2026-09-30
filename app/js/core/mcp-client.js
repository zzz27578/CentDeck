import { uid } from './ui.js';
export function connectWorkbench(app){
  const clientId=crypto.randomUUID();let controls=new Map(),busy=false;const ids=new WeakMap();let sequence=0;
  function snapshot(){
    const next=new Map();let i=0;
    const scope=[...document.querySelectorAll('.modal-mask.show .modal')].at(-1)||document;
    const list=[...scope.querySelectorAll('button,input:not([type=password]),textarea,select,a[href]')].filter(n=>n.offsetParent&&!n.closest('[inert]')&&!n.disabled).slice(0,160).map(n=>{if(!ids.has(n))ids.set(n,'c'+(++sequence));const id=ids.get(n);next.set(id,n);return {id,tag:n.tagName.toLowerCase(),label:(n.getAttribute('aria-label')||n.getAttribute('data-tip')||n.textContent||n.getAttribute('placeholder')||n.name||'').trim().slice(0,110)};});
    controls=next;return {focused:document.hasFocus(),projectId:app.project()?.id||null,projectName:app.project()?.name||null,page:app.state.page,view:app.view(),studio:document.querySelector('.studio h1')?.textContent||null,controls:list};
  }
  async function action(c){
    if(c.action==='open_project')await app.openProject(c.projectId);
    else if(c.action==='open_settings')await app.openSettings(c.section||'general');
    else if(c.action==='close_settings')document.querySelector('.studio [data-close]')?.click();
    else if(c.action==='open_page'){if(!app.project()?.pages.some(p=>p.file===c.page))throw Error('页面不在当前项目中');await app.openPage(c.page);}
    else if(c.action==='set_view'){if(!['overview','edit','present'].includes(c.view))throw Error('视图无效');await app.setView(c.view);}
    else if(c.action==='refresh'){if(app.project()){await app.refreshProject();await app.reloadView();}}
    else if(c.action==='click'||c.action==='fill'){
      const n=controls.get(c.target);if(!n?.isConnected||!n.offsetParent||n.closest('[inert]'))throw Error('控件已变化，请重新 ui_state');
      if(c.action==='click')n.click();else {if(!n.matches('input:not([type=password]),textarea,select'))throw Error('目标不是可填写控件');n.value=c.value||'';n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}
    }else if(c.action==='add_mark'){
      const p=app.project(),page=c.page||app.state.page;if(!p?.pages.some(x=>x.file===page))throw Error('请先打开需要标记的页面');
      const mark=await app.sketch.addRaw({page,type:'note',color:'#e57b48',text:c.text||'请检查此处',pts:[[c.x||120,c.y||120]],done:false});
      await app.bus.flushMeta();await app.reloadView();return {mark,snapshot:snapshot()};
    }else if(c.action==='undo'){await app.bus.undo();await app.bus.flushMeta();}
    else throw Error('不支持的页面操作');
    return snapshot();
  }
  async function poll(){if(busy)return;busy=true;try{
    const {commands}=await app.api.extension('ui/heartbeat',{clientId,state:snapshot()});
    for(const c of commands){let result,error;try{result=await action(c);}catch(e){error=e.message;}await app.api.extension('ui/result',{clientId,id:c.id,result,error});}
  }catch{}finally{busy=false;}}
  poll();const timer=setInterval(poll,800);addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
